/**
 * Camps from the votes on Landkarten-Punkte (exp/jev) — the analyze.ts math
 * (PCA → k-means, k by silhouette → per-group statistics) over the matrix
 * participants × map points instead of participants × statements. Stored in
 * analysis_runs (engine …:map-points) in the shape name-camps, diagnose-map
 * and render-landkarte read: clustering, statements[] (here: map points,
 * pointId = map point id) with perGroup stats, participantGroups.
 *
 * Usage: DATABASE_URL=... tsx scripts/camps.ts --consultation <uuid|source_ref> [--min-votes 7]
 */

import {
  buildRawMatrix,
  clusterableParticipantIds,
  commentStatistics,
  DEFAULT_THRESHOLDS,
  findBestKmeans,
  runPca,
  selectParticipants,
  type VoteRecord,
} from "@policy/math";
import pg from "pg";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const minVotes = Number(arg("min-votes") ?? 7);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cons = await client.query(
    `SELECT id, tenant_id, title FROM consultations WHERE id::text = $1 OR source_ref = $1 ORDER BY created_at DESC LIMIT 1`,
    [consultation],
  );
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId, title } = cons.rows[0];

  const mps = await client.query(
    `SELECT id, label, scope FROM map_points WHERE consultation_id = $1 AND typ <> 'luecke' ORDER BY scope, ord`,
    [consultationId],
  );
  const votes = await client.query(
    `SELECT v.participant_id, v.map_point_id, v.value FROM map_point_votes v
     JOIN map_points m ON m.id = v.map_point_id WHERE m.consultation_id = $1`,
    [consultationId],
  );
  const parts = await client.query(
    `SELECT id, author_org, author_type FROM participants WHERE consultation_id = $1 ORDER BY created_at, id`,
    [consultationId],
  );
  const pIndex = new Map<string, number>(parts.rows.map((r, i) => [r.id, i]));
  const mIndex = new Map<string, number>(mps.rows.map((r, i) => [r.id, i]));
  const records: VoteRecord[] = votes.rows
    .filter((v) => pIndex.has(v.participant_id) && mIndex.has(v.map_point_id))
    .map((v) => ({ participantId: pIndex.get(v.participant_id)!, statementId: mIndex.get(v.map_point_id)!, vote: v.value, modified: 1 }));
  if (records.length === 0) throw new Error("no map-point votes — run map-stances first");

  const matrix = buildRawMatrix(records);
  console.log(`${title}: ${matrix.participantIds.length} participants × ${matrix.statementIds.length} map points, ${records.length} votes`);
  const pca = runPca(matrix);
  const clusterable = clusterableParticipantIds(matrix, minVotes);
  const rowIndex = new Map(matrix.participantIds.map((id, i) => [id, i]));
  const rows = clusterable.map((pid) => pca.participantProjections[rowIndex.get(pid)!]! as unknown as number[]);
  // k ≤ participants/3 — with a dozen participants, five camps would be noise.
  const kMax = Math.max(2, Math.min(5, Math.floor(clusterable.length / 3)));
  const { best, silhouette } = findBestKmeans(rows, 2, kMax);
  console.log(`k=${best.k} (silhouette ${silhouette.toFixed(3)}), ${clusterable.length} clusterable participants`);

  const stats = commentStatistics(selectParticipants(matrix, clusterable), best.labels);
  const groupSizes: Record<number, number> = {};
  for (const l of best.labels) groupSizes[l] = (groupSizes[l] ?? 0) + 1;
  const colOf = new Map(matrix.statementIds.map((sid, j) => [sid, j]));

  const result = {
    engine: "map-points",
    matrix: { participants: matrix.participantIds.length, mapPoints: matrix.statementIds.length, votes: records.length },
    clustering: { k: best.k, silhouette, groupSizes, clusterableCount: clusterable.length },
    statements: mps.rows.map((m, i) => ({
      id: m.id,
      pointId: m.id,
      label: m.label,
      scope: m.scope,
      perGroup: colOf.has(i)
        ? stats.grouped.filter((g) => g.statementId === i).map((g) => ({ group: g.groupId, pa: g.pa, pd: g.pd, ns: g.ns }))
        : [],
    })),
    participantGroups: clusterable.map((pid, i) => ({
      participant: parts.rows[pid]?.id,
      group: best.labels[i],
      authorOrg: parts.rows[pid]?.author_org,
      authorType: parts.rows[pid]?.author_type,
    })),
  };
  await client.query(
    `INSERT INTO analysis_runs (tenant_id, consultation_id, engine, thresholds, result) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, consultationId, "@policy/math@0.1.0:map-points", JSON.stringify(DEFAULT_THRESHOLDS), JSON.stringify(result)],
  );
  for (const g of Object.keys(groupSizes)) {
    const members = result.participantGroups.filter((p) => String(p.group) === g).map((p) => p.authorOrg ?? "?");
    console.log(`  G${g} (${groupSizes[Number(g)]}): ${members.join(" · ")}`);
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
