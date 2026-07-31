/**
 * Stance inference: turn free-form submissions into a vote matrix. For each
 * submission, an LLM judges its stance (agree/disagree/pass) toward every
 * released canonical statement; agree/disagree become votes by an inferred
 * participant (source_ref "inferred:<submission-id>"), pass stays silent —
 * a submission that never mentions a point did not abstain, it said nothing.
 *
 * This is how consultations WITHOUT native voting (German free-form
 * Stellungnahmen) get camps/bridges/diagnosis: the existing deterministic
 * math runs unchanged on the inferred matrix. Votes are machine-inferred
 * and marked as such via the participant's source_ref prefix.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/infer-stances.ts \
 *     --consultation <source_ref|uuid> [--limit 50] [--chunk 30]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

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

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, tenant_id, title FROM consultations
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
    SELECT s.id, s.author_org, s.author_type, s.language, s.text
    FROM submissions s
    WHERE s.consultation_id = ${consultationId} AND s.text IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM participants pa
        WHERE pa.consultation_id = ${consultationId}
          AND pa.source_ref = 'inferred:' || s.id::text
      )
    ORDER BY length(s.text) DESC
    LIMIT ${limit}
  `);
  console.log(
    `${subs.rows.length} submissions × ${statements.length} statements (chunk ${chunkSize})`,
  );

  const provider = new AgentSdkProvider();
  for (const sub of subs.rows as {
    id: string; author_org: string | null; author_type: string | null;
    language: string | null; text: string;
  }[]) {
    const started = Date.now();
    const votes: { statementId: string; value: 1 | -1 }[] = [];
    let passes = 0;
    let failed = false;
    for (let offset = 0; offset < statements.length; offset += chunkSize) {
      const chunk = statements.slice(offset, offset + chunkSize);
      try {
        const result = await provider.generateStructured({
          system: STANCE_SYSTEM,
          prompt: stancePrompt(sub.text, chunk.map((s) => s.text)),
          schema: stanceJsonSchema,
        });
        const parsed = stanceOutput.parse(result.output);
        for (const s of parsed.stances) {
          const statement = chunk[s.index];
          if (!statement) continue;
          if (s.stance === "agree") votes.push({ statementId: statement.id, value: 1 });
          else if (s.stance === "disagree") votes.push({ statementId: statement.id, value: -1 });
          else passes++;
        }
      } catch (err) {
        console.log(`  chunk FAILED: ${err instanceof Error ? err.message : err}`);
        failed = true;
        break;
      }
    }
    if (failed) continue; // no participant row — submission retried on rerun

    const pRes = await db.execute(sql`
      INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language)
      VALUES (${tenantId}, ${consultationId}, ${`inferred:${sub.id}`},
              ${sub.author_org}, ${sub.author_type}, ${sub.language})
      ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org
      RETURNING id
    `);
    const participantId = (pRes.rows[0] as { id: string }).id;
    for (const v of votes) {
      await db.execute(sql`
        INSERT INTO votes (tenant_id, participant_id, statement_id, value)
        VALUES (${tenantId}, ${participantId}, ${v.statementId}, ${v.value})
        ON CONFLICT (participant_id, statement_id) DO UPDATE SET value = excluded.value
      `);
    }
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, 'ai-editor:stance-inference', 'participant.infer_stances',
              'submission', ${sub.id},
              ${JSON.stringify({ votes: votes.length, passes, statements: statements.length })})
    `);
    const agree = votes.filter((v) => v.value === 1).length;
    console.log(
      `→ ${sub.author_org ?? sub.id}: ${agree} agree, ${votes.length - agree} disagree, ` +
        `${passes} pass [${Math.round((Date.now() - started) / 1000)}s]`,
    );
  }
  console.log("done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
