/**
 * Maßnahmen-Zuschnitt (decision 2026-08-14): segment a consultation's map
 * into separately decidable sub-measures — one argument chain per measure.
 *
 * Two passes, mirroring cluster-themes:
 *  1. Propose: one call over a label sample → 3–7 sub-measure labels.
 *  2. Assign: batches; every point gets exactly one measure or
 *     'übergreifend' (cross-cutting = the shared trunk of every chain).
 *
 * Idempotent: points with measure IS NOT NULL are skipped; rerun picks up
 * failures. Audit-logged like every AI decision.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/segment-measures.ts --consultation <ref>
 *     [--batch 25]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import {
  MEASURES_ASSIGN_SYSTEM,
  MEASURES_PROPOSE_SYSTEM,
  measuresAssignPrompt,
  measuresProposePrompt,
} from "../src/prompts.ts";
import {
  measuresAssignOutput,
  measuresAssignJsonSchema,
  measuresProposeOutput,
  measuresProposeJsonSchema,
} from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const GENERAL = "übergreifend";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const batchSize = Number(arg("batch") ?? 25);

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

  const provider = new AgentSdkProvider();

  // Measures already on the map (from a previous run) are reused so reruns
  // stay consistent; otherwise propose fresh.
  const existingRes = await db.execute(sql`
    SELECT DISTINCT measure FROM points
    WHERE consultation_id = ${consultationId}
      AND measure IS NOT NULL AND measure <> ${GENERAL}
  `);
  let measures = (existingRes.rows as { measure: string }[]).map((r) => r.measure);

  if (measures.length === 0) {
    const labelRes = await db.execute(sql`
      SELECT label FROM points
      WHERE consultation_id = ${consultationId}
        AND status IN ('draft','released')
        AND created_by <> 'import:questionnaire'
      ORDER BY created_at ASC
    `);
    const labels = (labelRes.rows as { label: string }[]).map((r) => r.label);
    const proposed = await provider.generateStructured({
      system: MEASURES_PROPOSE_SYSTEM,
      prompt: measuresProposePrompt(labels),
      schema: measuresProposeJsonSchema,
    });
    measures = measuresProposeOutput.parse(proposed.output).measures;
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, ${'ai-editor:' + proposed.provenance.model}, 'consultation.propose_measures',
              'consultation', ${consultationId}, ${JSON.stringify({ measures })})
    `);
  }
  console.log(`sub-measures (${measures.length}):`);
  for (const m of measures) console.log(`  - ${m}`);

  const todoRes = await db.execute(sql`
    SELECT id, label, summary FROM points
    WHERE consultation_id = ${consultationId}
      AND status IN ('draft','released')
      AND measure IS NULL
      AND created_by <> 'import:questionnaire'
    ORDER BY created_at ASC
  `);
  const todo = todoRes.rows as { id: string; label: string; summary: string | null }[];
  console.log(`assigning ${todo.length} points (batch ${batchSize})`);

  let assigned = 0;
  let general = 0;
  for (let offset = 0; offset < todo.length; offset += batchSize) {
    const batch = todo.slice(offset, offset + batchSize);
    try {
      const result = await provider.generateStructured({
        system: MEASURES_ASSIGN_SYSTEM,
        prompt: measuresAssignPrompt(measures, batch),
        schema: measuresAssignJsonSchema,
      });
      const parsed = measuresAssignOutput.parse(result.output);
      for (const v of parsed.verdicts) {
        const point = batch[v.index];
        if (!point) continue;
        const label =
          v.measure_index >= 0 && v.measure_index < measures.length
            ? measures[v.measure_index]!
            : GENERAL;
        if (label === GENERAL) general++;
        await db.execute(sql`UPDATE points SET measure = ${label} WHERE id = ${point.id}`);
        assigned++;
      }
      await db.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
        VALUES (${tenantId}, ${'ai-editor:' + result.provenance.model}, 'point.assign_measure',
                'consultation', ${consultationId},
                ${JSON.stringify({ batchStart: offset, batchSize: batch.length })})
      `);
      console.log(`  batch ${offset / batchSize + 1}: ${parsed.verdicts.length} verdicts`);
    } catch (err) {
      console.log(`  batch at ${offset} FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${assigned} assigned (${general} übergreifend)`);

  const dist = await db.execute(sql`
    SELECT measure, count(*) FROM points
    WHERE consultation_id = ${consultationId} AND measure IS NOT NULL
    GROUP BY measure ORDER BY count(*) DESC
  `);
  for (const r of dist.rows as { measure: string; count: string }[])
    console.log(`  ${r.measure}: ${r.count}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
