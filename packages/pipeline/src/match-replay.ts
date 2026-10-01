/**
 * Reconstruct the map state each recorded match decision was made against,
 * so alternative matchers can be replayed on identical inputs. Reads only.
 *
 * Grouping: one group per decomposition call — all candidates of a call share
 * the call's provenance startedAt. runForSubmission snapshots the map AFTER
 * the decomposition call and BEFORE the candidate loop, so siblings never see
 * each other; the first candidate's own point row lands milliseconds before
 * its decision row. Hence: snapshot = every non-questionnaire point created
 * before (first decision of the group − SNAPSHOT_MARGIN), regardless of its
 * current status (rejected/merged points were drafts at the time).
 *
 * This replaces an earlier per-submission reconstruction that broke on
 * submissions decomposed twice (pre-chunking run + --retruncated rerun): it
 * dropped the first run's points from the second run's snapshot.
 */

import { sql, type Db } from "@policy/db";

const SNAPSHOT_MARGIN_MS = 500;

export interface ReplayDecision {
  id: string;
  submission_id: string;
  candidate_label: string;
  candidate_summary: string | null;
  outcome: "matched" | "new";
  matched_point: string | null;
  confidence: number | null;
  method: string;
  chunk_index: number;
  created_at: string;
}

export interface ReplayPoint {
  id: string;
  label: string;
  summary: string | null;
}

export interface ReplayGroup {
  submissionId: string;
  chunkIndex: number;
  decisions: ReplayDecision[];
  existing: ReplayPoint[];
}

export async function* replayGroups(
  db: Db,
  consultationId: string,
  limitGroups = Infinity,
): AsyncGenerator<ReplayGroup> {
  const decRes = await db.execute(sql`
    SELECT id, submission_id, candidate_label, candidate_summary, outcome,
           matched_point, confidence, method,
           COALESCE((provenance->'chunk'->>'index')::int, 0) AS chunk_index,
           provenance->'decomposition'->>'startedAt' AS call_started,
           created_at
    FROM match_decisions
    WHERE consultation_id = ${consultationId}
    ORDER BY created_at ASC
  `);
  const rows = decRes.rows as unknown as (ReplayDecision & { call_started: string | null })[];

  const groups = new Map<string, (ReplayDecision & { call_started: string | null })[]>();
  for (const d of rows) {
    const key = `${d.submission_id}|${d.call_started ?? d.created_at}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  let count = 0;
  for (const decisions of groups.values()) {
    // Matched against an empty map — nothing to replay.
    if (decisions.every((d) => d.method === "auto:first-points")) continue;
    if (++count > limitGroups) break;

    const cutoff = new Date(new Date(decisions[0]!.created_at).getTime() - SNAPSHOT_MARGIN_MS);
    const existingRes = await db.execute(sql`
      SELECT id, label, summary FROM points
      WHERE consultation_id = ${consultationId}
        AND created_at < ${cutoff.toISOString()}
        AND created_by <> 'import:questionnaire'
      ORDER BY created_at ASC
    `);
    const existing = existingRes.rows as unknown as ReplayPoint[];
    if (existing.length === 0) continue;
    yield {
      submissionId: decisions[0]!.submission_id,
      chunkIndex: decisions[0]!.chunk_index,
      decisions,
      existing,
    };
  }
}
