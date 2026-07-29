/* This file is a TypeScript port of code from red-dwarf
 * (https://github.com/polis-community/red-dwarf) and is licensed under the
 * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/), unlike the
 * MIT-licensed remainder of this repository. MPL-2.0 is file-scoped.
 */
/**
 * Polis-style PCA: mean imputation → PCA → sparsity-aware scaling.
 *
 * Ported from red-dwarf (reddwarf/utils/reducer/*, sklearn/transformers.py,
 * MPL-2.0), which in turn reproduces Polis (Small et al. 2021, §4.1).
 * Faithfulness is enforced by the differential suite against committed
 * red-dwarf reference outputs.
 *
 * Pipeline (matching sklearn semantics exactly):
 *   1. Impute missing votes (NaN) with the column mean of observed votes.
 *   2. PCA(n=2): center by column means, eigendecompose the covariance
 *      matrix (denominator n-1), take the top-2 components.
 *   3. Scale each participant's projection by sqrt(n_statements / n_votes) —
 *      participants with few votes are pushed outward so sparsity doesn't
 *      bunch them at the origin.
 *
 * Determinism: eigenvectors have arbitrary sign; we normalize so each
 * component's largest-magnitude entry is positive. All computation is exact
 * floating point — no RNG anywhere in this module.
 */

import { EigenvalueDecomposition, Matrix } from "ml-matrix";

import type { VoteMatrix } from "./matrix.ts";
import { votesPerParticipant } from "./matrix.ts";

export interface PcaResult {
  /** Column means of the imputed matrix (== imputation means). */
  mean: number[];
  /** 2 × n_statements principal components (rows are components). */
  components: [number[], number[]];
  /** Eigenvalues of the covariance matrix for the two components. */
  explainedVariance: [number, number];
  /** Scaled xy projection per participant, aligned with matrix.participantIds. */
  participantProjections: [number, number][];
  /** Scaled xy projection per statement, aligned with matrix.statementIds. */
  statementProjections: [number, number][];
}

/** Column means over observed (non-NaN) values; 0 for all-NaN columns. */
export function columnMeans(matrix: VoteMatrix): number[] {
  const p = matrix.statementIds.length;
  const sums = new Float64Array(p);
  const counts = new Float64Array(p);
  for (const row of matrix.values) {
    for (let j = 0; j < p; j++) {
      const v = row[j]!;
      if (!Number.isNaN(v)) {
        sums[j]! += v;
        counts[j]! += 1;
      }
    }
  }
  return [...sums].map((s, j) => (counts[j]! > 0 ? s / counts[j]! : 0));
}

export function runPca(matrix: VoteMatrix): PcaResult {
  const n = matrix.participantIds.length;
  const p = matrix.statementIds.length;
  if (n < 2) throw new Error("PCA requires at least 2 participants");

  const mean = columnMeans(matrix);

  // Imputed + centered matrix (missing → column mean → centered to exactly 0).
  const centered = Matrix.zeros(n, p);
  for (let i = 0; i < n; i++) {
    const row = matrix.values[i]!;
    for (let j = 0; j < p; j++) {
      const v = row[j]!;
      centered.set(i, j, Number.isNaN(v) ? 0 : v - mean[j]!);
    }
  }

  // Covariance (p × p), denominator n-1 like sklearn.
  const cov = centered.transpose().mmul(centered).div(n - 1);
  const evd = new EigenvalueDecomposition(cov, { assumeSymmetric: true });
  const eigenvalues = evd.realEigenvalues; // ascending
  const vectors = evd.eigenvectorMatrix;

  const components: [number[], number[]] = [[], []];
  const explainedVariance: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const col = p - 1 - c; // largest first
    explainedVariance[c] = eigenvalues[col]!;
    let component = Array.from({ length: p }, (_, j) => vectors.get(j, col));
    // Deterministic sign: largest-magnitude entry positive.
    let maxAbs = 0;
    let maxVal = 0;
    for (const value of component) {
      if (Math.abs(value) > maxAbs) {
        maxAbs = Math.abs(value);
        maxVal = value;
      }
    }
    if (maxVal < 0) component = component.map((value) => -value);
    components[c] = component;
  }

  // Participant projections: centered · componentᵀ, sparsity-scaled.
  const nVotes = votesPerParticipant(matrix);
  const participantProjections: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const scale = Math.sqrt(p / Math.max(1, nVotes[i]!));
    let x = 0;
    let y = 0;
    for (let j = 0; j < p; j++) {
      const v = centered.get(i, j);
      x += v * components[0][j]!;
      y += v * components[1][j]!;
    }
    participantProjections.push([x * scale, y * scale]);
  }

  // Statement projections: virtual participant agreeing only with statement j.
  // Imputed-centered virtual row = (1 - mean_j)·e_j; one vote → scale √p.
  const statementScale = Math.sqrt(p);
  const statementProjections: [number, number][] = [];
  for (let j = 0; j < p; j++) {
    const weight = (1 - mean[j]!) * statementScale;
    statementProjections.push([
      components[0][j]! * weight,
      components[1][j]! * weight,
    ]);
  }

  return {
    mean,
    components,
    explainedVariance,
    participantProjections,
    statementProjections,
  };
}
