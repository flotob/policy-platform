/**
 * Backfill argumentative relations for submissions decomposed BEFORE the
 * pipeline emitted edges: one relations-only LLM pass per submission over
 * its extracted points → point_edges (idempotent via unique constraint).
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/backfill-relations.ts \
 *     --consultation <source_ref|uuid> [--limit 50]
 */

import { createDb, pointEdges, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { RELATIONS_SYSTEM, relationsPrompt } from "../src/prompts.ts";
import { relationsJsonSchema, relationsOutput } from "../src/schemas.ts";

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

  const db = createDb(url);
  // Submissions whose points (≥2) have no edges among them yet.
  const subs = await db.execute(sql`
    SELECT s.id, s.author_org, count(DISTINCT ps.point_id)::int AS n_points
    FROM submissions s
    JOIN consultations c ON c.id = s.consultation_id
    JOIN point_sources ps ON ps.submission_id = s.id
    JOIN points p ON p.id = ps.point_id AND p.status IN ('draft', 'released')
    WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
    GROUP BY s.id, s.author_org
    HAVING count(DISTINCT ps.point_id) >= 2
       AND NOT EXISTS (
         SELECT 1 FROM point_edges e
         WHERE e.from_point IN (
           SELECT ps2.point_id FROM point_sources ps2 WHERE ps2.submission_id = s.id
         )
       )
    ORDER BY n_points DESC
    LIMIT ${limit}
  `);
  console.log(`${subs.rows.length} submissions without relations`);

  const provider = new AgentSdkProvider();
  let totalEdges = 0;
  for (const sub of subs.rows as { id: string; author_org: string | null; n_points: number }[]) {
    const pts = await db.execute(sql`
      SELECT DISTINCT p.id, p.tenant_id, p.kind, p.slot, p.label, p.summary, min(ps.created_at) AS first_seen
      FROM points p JOIN point_sources ps ON ps.point_id = p.id
      WHERE ps.submission_id = ${sub.id} AND p.status IN ('draft', 'released')
      GROUP BY p.id ORDER BY first_seen
    `);
    const points = pts.rows as {
      id: string; tenant_id: string; kind: string; slot: string | null;
      label: string; summary: string | null;
    }[];
    console.log(`→ ${sub.author_org ?? sub.id} (${points.length} points)…`);
    const started = Date.now();
    try {
      const result = await provider.generateStructured({
        system: RELATIONS_SYSTEM,
        prompt: relationsPrompt(points),
        schema: relationsJsonSchema,
      });
      const parsed = relationsOutput.parse(result.output);
      let inserted = 0;
      for (const rel of parsed.relations) {
        const from = points[rel.from];
        const to = points[rel.to];
        if (!from || !to || from.id === to.id) continue;
        await db
          .insert(pointEdges)
          .values({
            tenantId: from.tenant_id,
            fromPoint: from.id,
            toPoint: to.id,
            kind: rel.kind,
          })
          .onConflictDoNothing();
        inserted++;
      }
      totalEdges += inserted;
      console.log(`  ${inserted} edges [${Math.round((Date.now() - started) / 1000)}s]`);
    } catch (err) {
      console.log(`  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${totalEdges} edges inserted`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
