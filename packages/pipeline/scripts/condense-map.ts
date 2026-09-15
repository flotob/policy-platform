/**
 * Verdichtung (decision 2026-09-15): condense extraction-grain points into
 * canonical LANDKARTEN-Punkte — the map-grain unit of the concept paper's
 * prototype (~10-20 per measure). The extraction layer stays untouched as
 * evidence underneath; every extraction point links up via map_point_id.
 *
 * Two passes per scope (measure or 'übergreifend'):
 *  1. Propose: one call over the scope's full point list → canonical points
 *     with member assignments. Skipped when the scope already has map points.
 *  2. Sweep: unassigned extraction points → batched assignment to the
 *     existing canonical points (-1 = off-map noise, stays unassigned).
 *
 * Idempotent: rerun completes coverage without touching existing rows.
 * Audit-logged like every AI decision.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/condense-map.ts --consultation <ref>
 *     [--scope <measure name>] [--batch 25]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import {
  CONDENSE_ASSIGN_SYSTEM,
  CONDENSE_SYSTEM,
  condenseAssignPrompt,
  condensePrompt,
} from "../src/prompts.ts";
import {
  condenseAssignJsonSchema,
  condenseAssignOutput,
  condenseJsonSchema,
  condenseOutput,
} from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const BEZIRK_ORDER = [
  "wirkung",
  "machbarkeit",
  "kosten",
  "alternativen",
  "wert",
  "ausgestaltung",
];

interface ExtractionPoint {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  cq: string | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const onlyScope = arg("scope");
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

  const scopesRes = await db.execute(sql`
    SELECT DISTINCT measure FROM points
    WHERE consultation_id = ${consultationId} AND measure IS NOT NULL
    ORDER BY measure
  `);
  let scopes = (scopesRes.rows as { measure: string }[]).map((r) => r.measure);
  if (onlyScope) {
    if (!scopes.includes(onlyScope)) throw new Error(`scope "${onlyScope}" not found`);
    scopes = [onlyScope];
  }

  const provider = new AgentSdkProvider();

  for (const scope of scopes) {
    console.log(`\n=== scope: ${scope} ===`);
    try {
    const pointsRes = await db.execute(sql`
      SELECT id, label, summary, kind, cq FROM points
      WHERE consultation_id = ${consultationId}
        AND measure = ${scope}
        AND status IN ('draft', 'released')
        AND kind <> 'gap'
        AND created_by <> 'import:questionnaire'
      ORDER BY created_at ASC
    `);
    const points = pointsRes.rows as unknown as ExtractionPoint[];
    if (points.length < 4) {
      console.log(`  only ${points.length} points — skipped`);
      continue;
    }

    const existingRes = await db.execute(sql`
      SELECT id, ord, label, text FROM map_points
      WHERE consultation_id = ${consultationId} AND scope = ${scope}
        AND typ <> 'luecke'
      ORDER BY ord
    `);
    let mapPoints = existingRes.rows as {
      id: string; ord: number; label: string; text: string;
    }[];

    // Pass 1: propose (only when the scope has no canonical points yet).
    if (mapPoints.length === 0) {
      const result = await provider.generateStructured({
        system: CONDENSE_SYSTEM,
        prompt: condensePrompt(points, scope),
        schema: condenseJsonSchema,
      });
      const parsed = condenseOutput.parse(result.output);

      // Server-side consistency: typ wins over bezirk where they conflict.
      const proposals = parsed.map_points.map((mp) => {
        let bezirk = mp.bezirk;
        if (mp.typ === "W") bezirk = "wert";
        else if (mp.typ === "verfahren") bezirk = "ausgestaltung";
        else if (bezirk === "wert" || bezirk === "ausgestaltung") bezirk = "kosten";
        return { ...mp, bezirk };
      });
      proposals.sort(
        (a, b) =>
          BEZIRK_ORDER.indexOf(a.bezirk) - BEZIRK_ORDER.indexOf(b.bezirk) ||
          b.members.length - a.members.length,
      );

      const seen = new Set<number>();
      let ord = 1;
      for (const mp of proposals) {
        const members = mp.members.filter(
          (i) => i >= 0 && i < points.length && !seen.has(i),
        );
        for (const i of members) seen.add(i);
        if (members.length === 0) continue;
        const ins = await db.execute(sql`
          INSERT INTO map_points (tenant_id, consultation_id, scope, ord, typ, bezirk, text, label, created_by)
          VALUES (${tenantId}, ${consultationId}, ${scope}, ${ord}, ${mp.typ}, ${mp.bezirk},
                  ${mp.text}, ${mp.label}, ${'ai-condense:' + result.provenance.model})
          RETURNING id
        `);
        const mapPointId = (ins.rows[0] as { id: string }).id;
        for (const i of members) {
          await db.execute(
            sql`UPDATE points SET map_point_id = ${mapPointId} WHERE id = ${points[i]!.id}`,
          );
        }
        mapPoints.push({ id: mapPointId, ord, label: mp.label, text: mp.text });
        ord++;
      }
      await db.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
        VALUES (${tenantId}, ${'ai-editor:' + result.provenance.model}, 'consultation.condense_map',
                'consultation', ${consultationId},
                ${JSON.stringify({ scope, proposed: mapPoints.length, covered: seen.size, of: points.length })})
      `);
      console.log(
        `  proposed ${mapPoints.length} map points, covered ${seen.size}/${points.length} extraction points`,
      );
    } else {
      console.log(`  ${mapPoints.length} map points exist — sweep only`);
    }

    // Pass 2: sweep — assign leftovers to the existing canonical points.
    const leftoverRes = await db.execute(sql`
      SELECT id, label, summary FROM points
      WHERE consultation_id = ${consultationId}
        AND measure = ${scope}
        AND status IN ('draft', 'released')
        AND kind <> 'gap'
        AND created_by <> 'import:questionnaire'
        AND map_point_id IS NULL
      ORDER BY created_at ASC
    `);
    const leftovers = leftoverRes.rows as {
      id: string; label: string; summary: string | null;
    }[];
    if (leftovers.length === 0) {
      console.log(`  sweep: nothing left`);
      continue;
    }
    console.log(`  sweep: ${leftovers.length} unassigned`);
    let swept = 0;
    let offMap = 0;
    for (let offset = 0; offset < leftovers.length; offset += batchSize) {
      const batch = leftovers.slice(offset, offset + batchSize);
      try {
        const result = await provider.generateStructured({
          system: CONDENSE_ASSIGN_SYSTEM,
          prompt: condenseAssignPrompt(mapPoints, batch),
          schema: condenseAssignJsonSchema,
        });
        const parsed = condenseAssignOutput.parse(result.output);
        for (const v of parsed.verdicts) {
          const point = batch[v.index];
          if (!point) continue;
          if (v.map_index >= 0 && v.map_index < mapPoints.length) {
            await db.execute(sql`
              UPDATE points SET map_point_id = ${mapPoints[v.map_index]!.id}
              WHERE id = ${point.id}
            `);
            swept++;
          } else {
            offMap++;
          }
        }
        await db.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
          VALUES (${tenantId}, ${'ai-editor:' + result.provenance.model}, 'point.assign_map_point',
                  'consultation', ${consultationId},
                  ${JSON.stringify({ scope, batchStart: offset, batchSize: batch.length })})
        `);
      } catch (err) {
        console.log(`  sweep batch at ${offset} FAILED: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`  sweep done: ${swept} assigned, ${offMap} off-map`);
    } catch (err) {
      console.log(`  scope FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Coverage summary.
  const summary = await db.execute(sql`
    SELECT scope, count(*)::int AS map_points,
      (SELECT count(*) FROM points p WHERE p.consultation_id = ${consultationId}
        AND p.measure = mp.scope AND p.map_point_id IS NOT NULL)::int AS covered,
      (SELECT count(*) FROM points p WHERE p.consultation_id = ${consultationId}
        AND p.measure = mp.scope AND p.status IN ('draft','released')
        AND p.kind <> 'gap' AND p.created_by <> 'import:questionnaire')::int AS total
    FROM map_points mp
    WHERE mp.consultation_id = ${consultationId} AND mp.typ <> 'luecke'
    GROUP BY scope ORDER BY scope
  `);
  console.log(`\ncoverage:`);
  for (const r of summary.rows as { scope: string; map_points: number; covered: number; total: number }[])
    console.log(`  ${r.scope}: ${r.map_points} map points · ${r.covered}/${r.total} extraction points`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
