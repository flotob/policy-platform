/**
 * Assign every live point to a measure of the bill (exp/jev): code first
 * (sections named in label, summary, or quote), Jev for the rest, the LLM
 * as second opinion where Jev is unsure (confidence < 0.5). Measures
 * are read from the latest consultation.propose_measures proposal with
 * details (propose-measures-bill.ts). Writes points.measure for points that
 * have none (--overwrite: all).
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/assign-measures.ts --consultation <ref>
 *     [--concurrency 8] [--overwrite]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider, JevJudge } from "@policy/llm";

import { runPool } from "../src/pool.ts";
import { measurePickJsonSchema, measurePickOutput } from "../src/schemas.ts";

import { judgeAll, resolveConsultation, saveJudgment, sinceReset, statsLine } from "../src/jev-stage.ts";
import {
  decideMeasure,
  MEASURE_FAMILY,
  MEASURE_SECOND_OPINION_BELOW,
  measureBySection,
  measureOptionsText,
  measureQuestion,
  type BillMeasure,
} from "../src/measures.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const overwrite = process.argv.includes("--overwrite");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const propRes = await db.execute(sql`
    SELECT payload FROM audit_log a WHERE action = 'consultation.propose_measures' AND subject_id = ${cons.id}
      AND payload ? 'details' AND a.created_at > ${sinceReset(cons.id)}
    ORDER BY created_at DESC LIMIT 1
  `);
  const measures = (propRes.rows[0] as { payload: { details: BillMeasure[] } } | undefined)?.payload.details;
  if (!measures?.length) throw new Error("no measures from the bill — run propose-measures-bill.ts first");

  const pRes = await db.execute(sql`
    SELECT p.id, p.label, p.summary,
      COALESCE((SELECT string_agg(ps.quote, ' ') FROM point_sources ps WHERE ps.point_id = p.id), '') AS quotes
    FROM points p
    WHERE p.consultation_id = ${cons.id} AND p.status IN ('draft','released') AND p.created_by <> 'import:questionnaire'
      AND ${overwrite ? sql`true` : sql`p.measure IS NULL`}
    ORDER BY p.created_at
  `);
  const pts = pRes.rows as { id: string; label: string; summary: string | null; quotes: string }[];
  console.log(`${pts.length} points · ${measures.length} measures from the bill`);

  const dist = new Map<string, number>();
  const count = (m: string) => dist.set(m, (dist.get(m) ?? 0) + 1);
  let bySection = 0;
  const toJudge: typeof pts = [];
  for (const p of pts) {
    const m = measureBySection(`${p.label} ${p.summary ?? ""} ${p.quotes}`, measures);
    if (!m) {
      toJudge.push(p);
      continue;
    }
    await db.execute(sql`UPDATE points SET measure = ${m} WHERE id = ${p.id}`);
    bySection++;
    count(m);
  }

  const unsure: { id: string; label: string; summary: string | null; jev: string }[] = [];
  const judge = new JevJudge();
  const stats = await judgeAll(
    judge,
    toJudge,
    (p) => ({ state: { consultation: cons.title, point: { label: p.label, summary: p.summary } }, questions: measureQuestion(measures) }),
    async (p, answers, provenance) => {
      const a = answers.measure as { choice: string; confidence: number };
      const m = decideMeasure(measures, a);
      if (a.confidence < MEASURE_SECOND_OPINION_BELOW) unsure.push({ id: p.id, label: p.label, summary: p.summary, jev: a.choice });
      await saveJudgment(db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: "point",
        subjectId: p.id,
        family: MEASURE_FAMILY,
        provenance,
        answers,
        decided: { measure: m, confidence: a.confidence },
      });
      await db.execute(sql`UPDATE points SET measure = ${m} WHERE id = ${p.id}`);
      count(m);
    },
    Number(arg("concurrency") ?? 8),
  );
  // Second opinion where Jev is unsure: the LLM picks from the same options.
  const provider = new AgentSdkProvider();
  const options = measureOptionsText(measures);
  let changed = 0;
  await runPool(
    unsure,
    async (p) => {
      const r = await provider.generateStructured({
        system:
          "You assign one point of a public consultation to the measure of the draft law it concerns. Answer with the option key (m1, m2, …, whole, beyond) and a one-sentence reason.",
        prompt: `Consultation: ${cons.title}\n\nOptions:\n${options}\n\nPoint: ${p.label} — ${p.summary ?? ""}`,
        schema: measurePickJsonSchema,
      });
      const pick = measurePickOutput.parse(r.output);
      const m = decideMeasure(measures, { choice: pick.choice, confidence: 1 });
      const before = decideMeasure(measures, { choice: p.jev, confidence: 1 });
      if (m !== before) {
        changed++;
        count(m);
        dist.set(before, dist.get(before)! - 1);
        await db.execute(sql`UPDATE points SET measure = ${m} WHERE id = ${p.id}`);
      }
      await db.execute(sql`
        UPDATE judgments SET decided = decided || ${JSON.stringify({ secondOpinion: { measure: m, reason: pick.reason, model: r.provenance.model } })}::jsonb
        WHERE subject_kind = 'point' AND subject_id = ${p.id} AND family = ${MEASURE_FAMILY}
      `);
    },
    Number(arg("llm-concurrency") ?? 6),
  );
  console.log(
    `by named section: ${bySection} · by Jev: ${toJudge.length} (${statsLine(stats)}) · ` +
      `unsure → LLM second opinion: ${unsure.length}, changed ${changed}`,
  );
  for (const [m, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${m}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
