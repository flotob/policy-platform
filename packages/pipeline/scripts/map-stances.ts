/**
 * Votes on Landkarten-Punkte (exp/jev): every submission is judged against
 * every map point — does its text agree with the canonical claim, disagree,
 * or not address it? Same calibrated stance questions as jev-stances
 * (claim in the question, submission window as state, windows merged on
 * probabilities, weak evidence abstains), but the target is the map point
 * itself: the numbers on the Landkarte are direct, not averaged up from
 * extraction-point statements.
 *
 * One participant per submission (source_ref inferred:<submission>).
 * Recomputes: the consultation's inferred map-point votes are replaced.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/map-stances.ts --consultation <ref> [--concurrency 8]
 */

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import { STANCE_BATCH, decideStance, stanceQuestion, type StanceProbs } from "../src/jev-stance.ts";
import { judgeAll, resolveConsultation, statsLine } from "../src/jev-stage.ts";
import { chunkText } from "../src/pipeline.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

export const MAP_STANCE_FAMILY = "map-stance.v1";

interface Sub {
  id: string;
  author_org: string | null;
  author_type: string | null;
  language: string | null;
  text: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const mpRes = await db.execute(sql`
    SELECT id, text FROM map_points WHERE consultation_id = ${cons.id} AND typ <> 'luecke' ORDER BY scope, ord
  `);
  const mps = mpRes.rows as { id: string; text: string }[];
  const subRes = await db.execute(sql`
    SELECT id, author_org, author_type, language, text FROM submissions
    WHERE consultation_id = ${cons.id} AND text IS NOT NULL ORDER BY length(text) DESC
  `);
  const subs = subRes.rows as unknown as Sub[];
  if (mps.length === 0) throw new Error("no map points — run condense first");

  const reqs: { sub: Sub; window: number; text: string; mps: typeof mps }[] = [];
  for (const sub of subs) {
    chunkText(sub.text, 20_000).forEach((text, window) => {
      for (let o = 0; o < mps.length; o += STANCE_BATCH) reqs.push({ sub, window, text, mps: mps.slice(o, o + STANCE_BATCH) });
    });
  }
  console.log(`${subs.length} submissions × ${mps.length} map points → ${reqs.length} requests`);

  const probs = new Map<string, StanceProbs[]>();
  const models = new Map<string, { model: string; requestId: string | null }>();
  const stats = await judgeAll(
    new JevJudge(),
    reqs,
    (r) => {
      const questions: Record<string, ReturnType<typeof stanceQuestion>> = {};
      r.mps.forEach((m, i) => (questions[`s${i}`] = stanceQuestion(m.text)));
      return { state: { submission: r.text }, questions };
    },
    async (r, answers, provenance) => {
      r.mps.forEach((m, i) => {
        const key = `${r.sub.id}:${m.id}`;
        if (!probs.has(key)) probs.set(key, []);
        probs.get(key)![r.window] = (answers[`s${i}`] as { probabilities: StanceProbs }).probabilities;
        models.set(key, { model: provenance.model, requestId: provenance.requestId ?? null });
      });
    },
    Number(arg("concurrency") ?? 8),
  );
  console.log(`\n${statsLine(stats)}`);
  if (stats.failed > 0) throw new Error(`${stats.failed} requests failed — rerun`);

  let agree = 0;
  let disagree = 0;
  let abstain = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM map_point_votes WHERE method = 'inferred'
        AND map_point_id IN (SELECT id FROM map_points WHERE consultation_id = ${cons.id})
    `);
    for (const sub of subs) {
      const p = await tx.execute(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language)
        VALUES (${cons.tenantId}, ${cons.id}, ${`inferred:${sub.id}`}, ${sub.author_org}, ${sub.author_type}, ${sub.language})
        ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org
        RETURNING id
      `);
      const pid = (p.rows[0] as { id: string }).id;
      for (const m of mps) {
        const key = `${sub.id}:${m.id}`;
        const d = decideStance(probs.get(key)!);
        const prov = models.get(key)!;
        await tx.execute(sql`
          INSERT INTO judgments (tenant_id, consultation_id, subject_kind, subject_id, family, model, request_id, answers, decided)
          VALUES (${cons.tenantId}, ${cons.id}, 'map_stance', ${key}, ${MAP_STANCE_FAMILY}, ${prov.model}, ${prov.requestId},
                  ${JSON.stringify({ windows: probs.get(key) })}, ${JSON.stringify(d)})
          ON CONFLICT (subject_kind, subject_id, family) DO UPDATE SET answers = excluded.answers, decided = excluded.decided,
            model = excluded.model, request_id = excluded.request_id, created_at = now()
        `);
        if (d.value === null) {
          abstain++;
          continue;
        }
        if (d.value === 1) agree++;
        else disagree++;
        await tx.execute(sql`
          INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, value, method, confidence)
          VALUES (${cons.tenantId}, ${pid}, ${m.id}, ${d.value}, 'inferred', ${d.confidence})
        `);
      }
    }
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${cons.tenantId}, 'jev:stance', 'consultation.map_stances', 'consultation', ${cons.id},
              ${JSON.stringify({ family: MAP_STANCE_FAMILY, agree, disagree, abstain })})
    `);
  });
  const pairs = subs.length * mps.length;
  console.log(
    `votes: ${agree + disagree} of ${pairs} pairs (${Math.round(((agree + disagree) / pairs) * 100)}%) · ` +
      `agree ${agree} · disagree ${disagree} · not addressed ${abstain}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
