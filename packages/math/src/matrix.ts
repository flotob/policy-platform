/* This file is a TypeScript port of code from red-dwarf
 * (https://github.com/polis-community/red-dwarf) and is licensed under the
 * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/), unlike the
 * MIT-licensed remainder of this repository. MPL-2.0 is file-scoped.
 */
/**
 * Vote matrix construction and Polis-style filtering.
 *
 * Ported from red-dwarf (reddwarf/utils/matrix.py, MPL-2.0) — see the license
 * header note in this package's README. Semantics verified by the
 * differential suite against committed red-dwarf reference outputs.
 */

import type { VoteRecord } from "./loader.ts";

export interface VoteMatrix {
  /** Sorted ascending. */
  participantIds: number[];
  /** Sorted ascending. */
  statementIds: number[];
  /** Row-major [participant][statement]; NaN = no vote. */
  values: Float64Array[];
}

export function buildRawMatrix(votes: VoteRecord[]): VoteMatrix {
  const participantIds = [...new Set(votes.map((v) => v.participantId))].sort(
    (a, b) => a - b,
  );
  const statementIds = [...new Set(votes.map((v) => v.statementId))].sort(
    (a, b) => a - b,
  );
  const pIndex = new Map(participantIds.map((id, i) => [id, i]));
  const sIndex = new Map(statementIds.map((id, i) => [id, i]));
  const values = participantIds.map(() => {
    const row = new Float64Array(statementIds.length);
    row.fill(NaN);
    return row;
  });
  for (const v of votes) {
    values[pIndex.get(v.participantId)!]![sIndex.get(v.statementId)!] = v.vote;
  }
  return { participantIds, statementIds, values };
}

/** Zero out moderated-out statement columns (Polis `simple_filter_matrix`). */
export function zeroOutStatements(
  matrix: VoteMatrix,
  statementIds: number[],
): VoteMatrix {
  const toZero = new Set(statementIds);
  const values = matrix.values.map((row, _) => {
    const copy = new Float64Array(row);
    matrix.statementIds.forEach((sid, j) => {
      if (toZero.has(sid)) copy[j] = 0;
    });
    return copy;
  });
  return { ...matrix, values };
}

/** Number of actual votes (non-NaN cells) per participant row. */
export function votesPerParticipant(matrix: VoteMatrix): number[] {
  return matrix.values.map(
    (row) => row.reduce((n, v) => n + (Number.isNaN(v) ? 0 : 1), 0),
  );
}

/** Participants with at least `threshold` votes (Polis in-conv filter). */
export function clusterableParticipantIds(
  matrix: VoteMatrix,
  threshold = 7,
): number[] {
  const counts = votesPerParticipant(matrix);
  return matrix.participantIds.filter((_, i) => counts[i]! >= threshold);
}

/** Row-subset of the matrix for the given participant ids (order preserved). */
export function selectParticipants(
  matrix: VoteMatrix,
  participantIds: number[],
): VoteMatrix {
  const index = new Map(matrix.participantIds.map((id, i) => [id, i]));
  return {
    participantIds: [...participantIds],
    statementIds: matrix.statementIds,
    values: participantIds.map((id) => {
      const i = index.get(id);
      if (i === undefined) throw new Error(`unknown participant ${id}`);
      return matrix.values[i]!;
    }),
  };
}
