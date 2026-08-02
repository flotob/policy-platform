/**
 * Stance inference: turn free-form submissions into votes. For each
 * submission, an LLM judges its stance (agree/disagree/pass) toward every
 * released canonical statement the author has not already REALLY voted on;
 * agree/disagree become votes with method='inferred', pass stays silent.
 *
 * Participant identity: if a participant with the submission's source_ref
 * already exists (e.g. OPC questionnaire respondents who also wrote free
 * text), the inferred votes attach to that SAME participant — one person,
 * one matrix row, real + inferred votes side by side (distinguished by
 * votes.method). Otherwise an `inferred:<submission-id>` participant is
 * created.
 *
 * Resume semantics: a submission is done when its `participant.infer_stances`
 * audit entry exists; failed submissions retry on rerun. `--concurrency N`
 * parallelizes across submissions (throughput plan O3) — submissions are
 * independent; keep N modest on subscription auth.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/infer-stances.ts \
 *     --consultation <source_ref|uuid> [--limit 50] [--chunk 30] [--concurrency 1]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { chunkText } from "../src/pipeline.ts";
import { runPool } from "../src/pool.ts";
import { STANCE_SYSTEM, stancePrompt } from "../src/prompts.ts";
import { stanceJsonSchema, stanceOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const limit = Number(arg("limit") ?? 50);
  const chunkSize = Number(arg("chunk") ?? 30);
  const concurrency = Number(arg("concurrency") ?? 1);

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, tenant_id FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId } = cons.rows[0] as {
    id: string; tenant_id: string;
  };

  // Canonical released statement per point (same rule as vote page/analyze).
  const stRes = await db.execute(sql`
    SELECT DISTINCT ON (st.point_id) st.id, st.text
    FROM statements st JOIN points p ON p.id = st.point_id
    WHERE p.consultation_id = ${consultationId} AND st.status = 'released'
      AND p.kind <> 'gap'
    ORDER BY st.point_id, st.locale
  `);
  const statements = stRes.rows as { id: string; text: string }[];
  if (statements.length === 0) throw new Error("no released statements to judge against");

  const subs = await db.execute(sql`
    SELECT s.id, s.source_ref, s.author_org, s.author_type, s.language, s.text
    FROM submissions s
    WHERE s.consultation_id = ${consultationId} AND s.text IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.action = 'participant.infer_stances'
          AND a.subject_kind = 'submission' AND a.subject_id = s.id::text
      )
    ORDER BY length(s.text) DESC
    LIMIT ${limit}
  `);
  console.log(
    `${subs.rows.length} submissions × up to ${statements.length} statements ` +
      `(chunk ${chunkSize}, concurrency ${concurrency})`,
  );

  const provider = new AgentSdkProvider();

  const processOne = async (sub: {
    id: string; source_ref: string | null; author_org: string | null;
    author_type: string | null; language: string | null; text: string;
  }) => {
    const started = Date.now();

    // Resolve identity FIRST: reuse an existing participant with the same
    // source_ref (questionnaire respondent who also wrote free text).
    let participantId: string | null = null;
    if (sub.source_ref) {
      const existing = await db.execute(sql`
        SELECT id FROM participants
        WHERE consultation_id = ${consultationId} AND source_ref = ${sub.source_ref}
      `);
      participantId = (existing.rows[0] as { id: string } | undefined)?.id ?? null;
    }

    // Only judge statements this participant has not already voted on.
    let targets = statements;
    if (participantId) {
      const votedRes = await db.execute(sql`
        SELECT statement_id FROM votes WHERE participant_id = ${participantId}
      `);
      const votedIds = new Set(
        (votedRes.rows as { statement_id: string }[]).map((r) => r.statement_id),
      );
      targets = statements.filter((s) => !votedIds.has(s.id));
    }

    const agreeSet = new Set<string>();
    const disagreeSet = new Set<string>();
    if (targets.length > 0) {
      const textWindows = chunkText(sub.text, 20_000);
      for (const window of textWindows) {
        for (let offset = 0; offset < targets.length; offset += chunkSize) {
          const chunk = targets.slice(offset, offset + chunkSize);
          const result = await provider.generateStructured({
            system: STANCE_SYSTEM,
            prompt: stancePrompt(window, chunk.map((s) => s.text)),
            schema: stanceJsonSchema,
          });
          const parsed = stanceOutput.parse(result.output);
          for (const s of parsed.stances) {
            const statement = chunk[s.index];
            if (!statement) continue;
            if (s.stance === "agree") agreeSet.add(statement.id);
            else if (s.stance === "disagree") disagreeSet.add(statement.id);
          }
        }
      }
    }

    const votes: { statementId: string; value: 1 | -1 }[] = [];
    for (const st of targets) {
      const a = agreeSet.has(st.id);
      const d = disagreeSet.has(st.id);
      if (a && !d) votes.push({ statementId: st.id, value: 1 });
      else if (d && !a) votes.push({ statementId: st.id, value: -1 });
    }
    const passes = targets.length - votes.length;

    if (!participantId) {
      const pRes = await db.execute(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language)
        VALUES (${tenantId}, ${consultationId}, ${`inferred:${sub.id}`},
                ${sub.author_org}, ${sub.author_type}, ${sub.language})
        ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org
        RETURNING id
      `);
      participantId = (pRes.rows[0] as { id: string }).id;
    }
    for (const v of votes) {
      // DO NOTHING: an existing (real) vote must never be overwritten by an
      // inferred one.
      await db.execute(sql`
        INSERT INTO votes (tenant_id, participant_id, statement_id, value, method)
        VALUES (${tenantId}, ${participantId}, ${v.statementId}, ${v.value}, 'inferred')
        ON CONFLICT (participant_id, statement_id) DO NOTHING
      `);
    }
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, 'ai-editor:stance-inference', 'participant.infer_stances',
              'submission', ${sub.id},
              ${JSON.stringify({ votes: votes.length, passes, judged: targets.length, attached: sub.source_ref ?? null })})
    `);
    const agree = votes.filter((v) => v.value === 1).length;
    console.log(
      `→ ${sub.author_org ?? sub.id}: ${agree} agree, ${votes.length - agree} disagree, ` +
        `${passes} pass (${targets.length} judged) [${Math.round((Date.now() - started) / 1000)}s]`,
    );
  };

  const { ok, failed } = await runPool(
    subs.rows as Parameters<typeof processOne>[0][],
    processOne,
    concurrency,
  );
  console.log(`done: ${ok} submissions, ${failed} failed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
