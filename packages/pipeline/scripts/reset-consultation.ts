/**
 * Reset a consultation's DERIVED data for a fresh pipeline run: points,
 * sources, edges, match decisions, statements, inferred votes and their
 * participants, map points, judgments, analysis runs. Kept: the
 * consultation, its submissions, the extraction cache (marked
 * un-canonicalized, so the next run re-canonicalizes without LLM calls),
 * and the append-only audit log — a 'consultation.reset' entry marks the
 * cut; resume markers older than it are ignored by the stages.
 *
 * Refuses when the consultation has REAL votes (questionnaire answers or
 * participant votes) — those are data, not derivations — unless
 * --include-real-votes says explicitly that they may go (they reference
 * statements the reset deletes, so they cannot survive it).
 *
 * Usage (prints counts only, unless --yes):
 *   DATABASE_URL=... tsx scripts/reset-consultation.ts --consultation <ref> [--yes] [--include-real-votes] [--refine]
 *   ... --map   only the Landkarte layer (map points, their votes, judgments
 *               and camp runs; points.map_point_id cleared) — rerun with
 *               run-pipeline --from condense. Points, relations, measures stay.
 *
 * Kept: extraction cache, window plans, consultation documents (the bill).
 */

import { createDb, sql, type Db } from "@policy/db";

import { resolveConsultation } from "../src/jev-stage.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const yes = process.argv.includes("--yes");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const dbName = ((await db.execute(sql`SELECT current_database() AS d`)).rows[0] as { d: string }).d;

  const real = await db.execute(sql`
    SELECT (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
            WHERE pa.consultation_id = ${cons.id} AND v.method <> 'inferred')
         + (SELECT count(*) FROM map_point_votes v JOIN participants pa ON pa.id = v.participant_id
            WHERE pa.consultation_id = ${cons.id} AND v.method <> 'inferred') AS n
  `);
  const realVotes = Number((real.rows[0] as { n: number | string }).n);
  if (realVotes > 0 && !process.argv.includes("--include-real-votes")) {
    throw new Error(
      `${cons.title} has ${realVotes} real votes — this reset is for pipeline-derived data only ` +
        `(--include-real-votes deletes them too)`,
    );
  }

  if (process.argv.includes("--map")) return resetMap(db, cons, dbName, yes);

  const P = sql`(SELECT id FROM points WHERE consultation_id = ${cons.id})`;
  const counts: Record<string, number> = {};
  const count = async (name: string, q: ReturnType<typeof sql>) => {
    counts[name] = ((await db.execute(q)).rows[0] as { n: number }).n;
  };
  await count("votes", sql`SELECT count(*)::int AS n FROM votes WHERE participant_id IN (SELECT id FROM participants WHERE consultation_id = ${cons.id})`);
  await count("map_point_votes", sql`SELECT count(*)::int AS n FROM map_point_votes WHERE participant_id IN (SELECT id FROM participants WHERE consultation_id = ${cons.id})`);
  await count("participants", sql`SELECT count(*)::int AS n FROM participants WHERE consultation_id = ${cons.id}`);
  await count("statements", sql`SELECT count(*)::int AS n FROM statements WHERE point_id IN ${P}`);
  await count("point_edges", sql`SELECT count(*)::int AS n FROM point_edges WHERE from_point IN ${P} OR to_point IN ${P}`);
  await count("point_sources", sql`SELECT count(*)::int AS n FROM point_sources WHERE point_id IN ${P}`);
  await count("match_decisions", sql`SELECT count(*)::int AS n FROM match_decisions WHERE consultation_id = ${cons.id}`);
  await count("judgments", sql`SELECT count(*)::int AS n FROM judgments WHERE consultation_id = ${cons.id}`);
  await count("points", sql`SELECT count(*)::int AS n FROM points WHERE consultation_id = ${cons.id}`);
  await count("map_points", sql`SELECT count(*)::int AS n FROM map_points WHERE consultation_id = ${cons.id}`);
  await count("analysis_runs", sql`SELECT count(*)::int AS n FROM analysis_runs WHERE consultation_id = ${cons.id}`);
  await count("extractions (kept)", sql`SELECT count(*)::int AS n FROM extractions WHERE consultation_id = ${cons.id}`);

  console.log(`database ${dbName} · ${cons.title} (${cons.id})${realVotes ? ` · includes ${realVotes} REAL votes` : ""}`);
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${n}`);
  if (!yes) {
    console.log("dry run — pass --yes to delete");
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM votes WHERE participant_id IN (SELECT id FROM participants WHERE consultation_id = ${cons.id})`);
    await tx.execute(sql`DELETE FROM map_point_votes WHERE participant_id IN (SELECT id FROM participants WHERE consultation_id = ${cons.id})`);
    await tx.execute(sql`DELETE FROM participants WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM statements WHERE point_id IN ${P}`);
    await tx.execute(sql`DELETE FROM point_edges WHERE from_point IN ${P} OR to_point IN ${P}`);
    await tx.execute(sql`DELETE FROM point_sources WHERE point_id IN ${P}`);
    await tx.execute(sql`DELETE FROM match_decisions WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM judgments WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM points WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM map_points WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM analysis_runs WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`UPDATE extractions SET canonicalized_at = NULL WHERE consultation_id = ${cons.id}`);
    // --refine: also redo the automatic repair (after a refine-policy change); extraction stays cached.
    if (process.argv.includes("--refine")) {
      await tx.execute(sql`UPDATE extractions SET refined = NULL, refined_at = NULL WHERE consultation_id = ${cons.id}`);
    }
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${cons.tenantId}, 'pipeline:reset', 'consultation.reset', 'consultation', ${cons.id},
              ${JSON.stringify(counts)})
    `);
  });
  console.log("reset done");
  process.exit(0);
}

/**
 * --map: only the Landkarte layer, for a rerun from condense. Inferred
 * participants stay (map-stances reuses them); the audit action is not
 * 'consultation.reset', so the earlier stages' resume markers stay valid.
 */
async function resetMap(db: Db, cons: { id: string; tenantId: string; title: string }, dbName: string, yes: boolean) {
  const M = sql`(SELECT id FROM map_points WHERE consultation_id = ${cons.id})`;
  const J = sql`consultation_id = ${cons.id} AND (subject_kind IN ('map_point', 'map_stance', 'map_scope') OR family LIKE 'map-assign.%')`;
  const R = sql`consultation_id = ${cons.id} AND engine LIKE '%:map-points'`;
  const counts: Record<string, number> = {};
  const count = async (name: string, q: ReturnType<typeof sql>) => {
    counts[name] = ((await db.execute(q)).rows[0] as { n: number }).n;
  };
  await count("map_point_votes", sql`SELECT count(*)::int AS n FROM map_point_votes WHERE map_point_id IN ${M}`);
  await count("map_points", sql`SELECT count(*)::int AS n FROM map_points WHERE consultation_id = ${cons.id}`);
  await count("points on a map point", sql`SELECT count(*)::int AS n FROM points WHERE consultation_id = ${cons.id} AND map_point_id IS NOT NULL`);
  await count("judgments (map layer)", sql`SELECT count(*)::int AS n FROM judgments WHERE ${J}`);
  await count("analysis_runs (camps)", sql`SELECT count(*)::int AS n FROM analysis_runs WHERE ${R}`);
  console.log(`database ${dbName} · ${cons.title} (${cons.id}) · Landkarte layer only`);
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(24)} ${n}`);
  if (!yes) {
    console.log("dry run — pass --yes to delete");
    process.exit(0);
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM map_point_votes WHERE map_point_id IN ${M}`);
    await tx.execute(sql`UPDATE points SET map_point_id = NULL WHERE consultation_id = ${cons.id} AND map_point_id IS NOT NULL`);
    await tx.execute(sql`DELETE FROM map_points WHERE consultation_id = ${cons.id}`);
    await tx.execute(sql`DELETE FROM judgments WHERE ${J}`);
    await tx.execute(sql`DELETE FROM analysis_runs WHERE ${R}`);
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${cons.tenantId}, 'pipeline:reset', 'consultation.reset_map', 'consultation', ${cons.id},
              ${JSON.stringify(counts)})
    `);
  });
  console.log("reset of the Landkarte layer done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
