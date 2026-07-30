/**
 * Run the full analysis over a consultation's real votes and store the result:
 * PCA → clustering (k by silhouette) → group stats → group-aware consensus →
 * repness/consensus selections → diagnosis layer. Deterministic; stored with
 * engine version + thresholds in analysis_runs.
 *
 * Usage: DATABASE_URL=... tsx scripts/analyze.ts --consultation <uuid|source_ref>
 */

import {
  buildRawMatrix,
  clusterableParticipantIds,
  commentStatistics,
  DEFAULT_THRESHOLDS,
  diagnose,
  findBestKmeans,
  runPca,
  selectConsensusStatements,
  selectParticipants,
  selectRepresentativeStatements,
  type DiagnosisPoint,
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
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cons = await client.query(
    `SELECT id, tenant_id, title FROM consultations
     WHERE id::text = $1 OR source_ref = $1 ORDER BY created_at DESC LIMIT 1`,
    [consultation],
  );
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId, title } = cons.rows[0];

  const participants = await client.query(
    `SELECT id, author_type, country FROM participants WHERE consultation_id = $1 ORDER BY created_at`,
    [consultationId],
  );
  // One matrix column per point: multilingual statements share votes via the
  // canonical row (lowest locale) — same rule as the vote page.
  const statementsRes = await client.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (p.id) st.id, st.text, st.created_at,
         p.id AS point_id, p.kind, p.label
       FROM statements st JOIN points p ON p.id = st.point_id
       WHERE p.consultation_id = $1 AND st.status = 'released'
       ORDER BY p.id, st.locale
     ) canonical ORDER BY created_at, id`,
    [consultationId],
  );
  const votesRes = await client.query(
    `SELECT v.participant_id, v.statement_id, v.value
     FROM votes v JOIN participants pa ON pa.id = v.participant_id
     WHERE pa.consultation_id = $1`,
    [consultationId],
  );

  // uuid → dense numeric ids for the math package.
  const pIndex = new Map<string, number>(participants.rows.map((r, i) => [r.id, i]));
  const sIndex = new Map<string, number>(statementsRes.rows.map((r, i) => [r.id, i]));
  const votes: VoteRecord[] = votesRes.rows
    .filter((v) => sIndex.has(v.statement_id))
    .map((v) => ({
      participantId: pIndex.get(v.participant_id)!,
      statementId: sIndex.get(v.statement_id)!,
      vote: v.value,
      modified: 1,
    }));

  const matrix = buildRawMatrix(votes);
  console.log(`${title}: ${matrix.participantIds.length} participants × ${matrix.statementIds.length} statements, ${votes.length} votes`);

  const pca = runPca(matrix);
  const clusterable = clusterableParticipantIds(matrix, 7);
  const rowIndex = new Map(matrix.participantIds.map((id, i) => [id, i]));
  const clusterRows = clusterable.map((pid) => pca.participantProjections[rowIndex.get(pid)!]! as unknown as number[]);
  const { best, silhouette } = findBestKmeans(clusterRows, 2, 5);
  console.log(`k=${best.k} (silhouette ${silhouette.toFixed(3)}), ${clusterable.length} clusterable participants`);

  const clusterableMatrix = selectParticipants(matrix, clusterable);
  const stats = commentStatistics(clusterableMatrix, best.labels);
  const repness = selectRepresentativeStatements(stats.grouped, []);
  const consensus = selectConsensusStatements(matrix, []);

  const diagnosisPoints: DiagnosisPoint[] = statementsRes.rows.map((r, i) => ({
    id: r.point_id,
    kind: r.kind,
    statementId: i,
  }));
  const diagnosis = diagnose(diagnosisPoints, stats.grouped);

  const groupSizes: Record<number, number> = {};
  for (const l of best.labels) groupSizes[l] = (groupSizes[l] ?? 0) + 1;

  const statementIdByIndex = statementsRes.rows.map((r) => ({
    id: r.id, pointId: r.point_id, label: r.label,
  }));
  const result = {
    matrix: { participants: matrix.participantIds.length, statements: matrix.statementIds.length, votes: votes.length },
    clustering: { k: best.k, silhouette, groupSizes, clusterableCount: clusterable.length },
    statements: statementIdByIndex.map((s, i) => ({
      ...s,
      groupAwareConsensusAgree: stats.groupAwareConsensusAgree.get(i),
      perGroup: stats.grouped.filter((g) => g.statementId === i)
        .map((g) => ({ group: g.groupId, pa: g.pa, pd: g.pd, ns: g.ns })),
      profile: diagnosis.points.find((p) => p.pointId === s.pointId)?.profile,
    })),
    repness,
    consensus,
    diagnosisOverall: diagnosis.overall,
    participantGroups: clusterable.map((pid, i) => ({
      participant: participants.rows[pid]?.id, group: best.labels[i],
      authorType: participants.rows[pid]?.author_type,
    })),
  };

  await client.query(
    `INSERT INTO analysis_runs (tenant_id, consultation_id, engine, thresholds, result)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, consultationId, "@policy/math@0.1.0", JSON.stringify(DEFAULT_THRESHOLDS), JSON.stringify(result)],
  );

  // Console digest: the demo-relevant findings.
  const bridged = result.statements.filter((s) => s.profile === "bridged");
  const divisive = result.statements.filter((s) => s.profile === "divisive");
  console.log(`\nBRIDGES (${bridged.length}):`);
  for (const s of bridged.slice(0, 5)) console.log(`  ✓ ${s.label.slice(0, 90)}`);
  console.log(`DIVISIVE (${divisive.length}):`);
  for (const s of divisive.slice(0, 5)) {
    const groups = result.statements.find((x) => x.id === s.id)!.perGroup
      .map((g) => `G${g.group}:${Math.round(g.pa * 100)}%`).join(" ");
    console.log(`  ⚡ ${s.label.slice(0, 80)} [agree: ${groups}]`);
  }
  console.log(`overall diagnosis: ${result.diagnosisOverall ?? "mixed"}`);
  const byType: Record<string, Record<number, number>> = {};
  for (const pg of result.participantGroups) {
    const t = pg.authorType ?? "?";
    byType[t] = byType[t] ?? {};
    byType[t][pg.group!] = (byType[t][pg.group!] ?? 0) + 1;
  }
  console.log("\ncamps by participant type:");
  for (const [t, groups] of Object.entries(byType)) {
    console.log(`  ${t}: ${Object.entries(groups).map(([g, n]) => `G${g}=${n}`).join(" ")}`);
  }
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
