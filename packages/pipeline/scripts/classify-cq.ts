/**
 * Backfill the critical-question ordering layer (Iteration 2a) onto
 * existing points.
 *
 * Two passes:
 *  1. Deterministic: a point with an outgoing ATTACK edge came through that
 *     door — the edge kind IS the cq (majority wins on conflicts).
 *  2. LLM: everything still unclassified is batch-judged (role +
 *     door / instrument backlink), audit-logged like every AI decision.
 *
 * Idempotent: points that already carry cq/answers_cq are skipped; failed
 * batches simply rerun.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/classify-cq.ts --consultation <ref>
 *     [--batch 25] [--limit 999]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { CLASSIFY_CQ_SYSTEM, classifyCqPrompt } from "../src/prompts.ts";
import { classifyCqOutput, classifyCqJsonSchema } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const batchSize = Number(arg("batch") ?? 25);
  const limit = Number(arg("limit") ?? 999);

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

  // Pass 1 — edges. Majority attack-kind of a point's outgoing edges
  // becomes its door. Questionnaire pseudo-points and instruments
  // (kind=design) are excluded: design points get answers_cq, not cq.
  const edgeRes = await db.execute(sql`
    WITH ranked AS (
      SELECT pe.from_point AS point_id, pe.kind,
             ROW_NUMBER() OVER (PARTITION BY pe.from_point
                                ORDER BY count(*) DESC, pe.kind) AS rn
      FROM point_edges pe
      JOIN points p ON p.id = pe.from_point
      WHERE p.consultation_id = ${consultationId}
        AND p.cq IS NULL AND p.kind <> 'design'
        AND pe.kind <> 'supports'
      GROUP BY pe.from_point, pe.kind
    )
    UPDATE points SET cq = ranked.kind
    FROM ranked
    WHERE points.id = ranked.point_id AND ranked.rn = 1
    RETURNING points.id
  `);
  console.log(`pass 1 (edges): ${edgeRes.rows.length} doors derived deterministically`);

  // Pass 2 — LLM for the remainder: released/draft points that neither
  // carry a door nor an instrument backlink yet.
  const todoRes = await db.execute(sql`
    SELECT id, label, summary, kind FROM points
    WHERE consultation_id = ${consultationId}
      AND status IN ('draft', 'released')
      AND cq IS NULL AND answers_cq IS NULL
      AND created_by <> 'import:questionnaire'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);
  const todo = todoRes.rows as { id: string; label: string; summary: string | null; kind: string }[];
  console.log(`pass 2 (LLM): ${todo.length} points to classify (batch ${batchSize})`);

  const provider = new AgentSdkProvider();
  let classified = 0;
  let claims = 0;
  let objections = 0;
  let instruments = 0;

  for (let offset = 0; offset < todo.length; offset += batchSize) {
    const batch = todo.slice(offset, offset + batchSize);
    try {
      const result = await provider.generateStructured({
        system: CLASSIFY_CQ_SYSTEM,
        prompt: classifyCqPrompt(batch),
        schema: classifyCqJsonSchema,
      });
      const parsed = classifyCqOutput.parse(result.output);
      for (const v of parsed.verdicts) {
        const point = batch[v.index];
        if (!point) continue;
        if (v.role === "objection" && v.cq) {
          await db.execute(sql`UPDATE points SET cq = ${v.cq} WHERE id = ${point.id}`);
          objections++;
        } else if (v.role === "instrument" && v.answers_cq && v.answers_cq.length > 0) {
          // Drizzle's sql template expands JS arrays into parameter lists —
          // pass a PG array literal instead (values are enum-safe).
          const literal = `{${v.answers_cq.join(",")}}`;
          await db.execute(sql`
            UPDATE points SET answers_cq = ${literal}::text[] WHERE id = ${point.id}
          `);
          instruments++;
        } else {
          claims++; // claim or gap: stays NULL — that is its classification
        }
        classified++;
      }
      await db.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
        VALUES (${tenantId}, ${'ai-editor:' + result.provenance.model}, 'point.classify_cq',
                'consultation', ${consultationId},
                ${JSON.stringify({ batchStart: offset, batchSize: batch.length })})
      `);
      console.log(
        `  batch ${offset / batchSize + 1}: ${parsed.verdicts.length} verdicts ` +
          `(${objections} objections, ${instruments} instruments so far)`,
      );
    } catch (err) {
      console.log(`  batch at ${offset} FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `done: ${classified} classified — ${objections} objections (doors), ` +
      `${instruments} instruments (backlinks), ${claims} claims/gaps (no door)`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
