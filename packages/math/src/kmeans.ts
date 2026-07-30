/* This file is a TypeScript port of code from red-dwarf
 * (https://github.com/polis-community/red-dwarf) and is licensed under the
 * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/), unlike the
 * MIT-licensed remainder of this repository. MPL-2.0 is file-scoped.
 */
/**
 * PolisKMeans: Lloyd's k-means with the deterministic "polis" initialization
 * (first k lexicographically-sorted unique data points as centers) and
 * silhouette-based k selection over k = 2..5.
 *
 * Ported from red-dwarf (reddwarf/sklearn/cluster.py, utils/clusterer/*),
 * matching sklearn semantics: tolerance scaled by the mean per-feature
 * variance, strict-convergence detection, final label reassignment after
 * tolerance convergence, and farthest-point relocation for empty clusters.
 *
 * Fully deterministic: no RNG anywhere.
 */

export interface KMeansResult {
  k: number;
  /** Cluster label per input row. */
  labels: number[];
  /** Cluster centers, k × d. */
  centers: number[][];
  inertia: number;
}

function distanceSquared(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return sum;
}

/** np.unique(X, axis=0): unique rows, sorted lexicographically ascending. */
export function sortedUniqueRows(rows: number[][]): number[][] {
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  };
  const sorted = rows.map((r) => [...r]).sort(compare);
  const unique: number[][] = [];
  for (const row of sorted) {
    const last = unique[unique.length - 1];
    if (!last || compare(last, row) !== 0) unique.push(row);
  }
  return unique;
}

/** "polis" init strategy: first k sorted-unique data points. */
export function polisInitCenters(rows: number[][], k: number): number[][] {
  const unique = sortedUniqueRows(rows);
  if (unique.length < k) {
    throw new Error(`not enough unique rows (${unique.length}) for k=${k}`);
  }
  return unique.slice(0, k).map((r) => [...r]);
}

function assignLabels(rows: number[][], centers: number[][]): number[] {
  return rows.map((row) => {
    let best = 0;
    let bestDist = Infinity;
    centers.forEach((center, c) => {
      const d = distanceSquared(row, center);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    });
    return best;
  });
}

/** sklearn scales `tol` by the mean per-feature variance of the data. */
function scaledTolerance(rows: number[][], tol: number): number {
  const n = rows.length;
  const d = rows[0]!.length;
  let meanVariance = 0;
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (const row of rows) mean += row[j]!;
    mean /= n;
    let variance = 0;
    for (const row of rows) variance += (row[j]! - mean) ** 2;
    meanVariance += variance / n;
  }
  return (meanVariance / d) * tol;
}

export function kmeans(
  rows: number[][],
  k: number,
  maxIter = 300,
  tol = 1e-4,
): KMeansResult {
  let centers = polisInitCenters(rows, k);
  const tolScaled = scaledTolerance(rows, tol);
  let labels = assignLabels(rows, centers);
  let strictlyConverged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    // M-step: recompute centers.
    const sums = centers.map(() => new Float64Array(rows[0]!.length));
    const counts = new Array(k).fill(0);
    rows.forEach((row, i) => {
      const c = labels[i]!;
      counts[c] += 1;
      row.forEach((v, j) => (sums[c]![j]! += v));
    });
    const newCenters = sums.map((sum, c) =>
      counts[c] > 0 ? [...sum].map((s) => s / counts[c]) : [...centers[c]!],
    );
    // Empty-cluster relocation: farthest points from their current centers.
    const empty = newCenters
      .map((_, c) => c)
      .filter((c) => counts[c] === 0);
    if (empty.length > 0) {
      const distances = rows.map((row, i) =>
        distanceSquared(row, newCenters[labels[i]!]!),
      );
      const taken = new Set<number>();
      for (const c of empty) {
        let farthest = -1;
        let farthestDist = -Infinity;
        distances.forEach((d, i) => {
          if (!taken.has(i) && d > farthestDist) {
            farthestDist = d;
            farthest = i;
          }
        });
        taken.add(farthest);
        newCenters[c] = [...rows[farthest]!];
      }
    }

    const centerShift = centers.reduce(
      (sum, center, c) => sum + distanceSquared(center, newCenters[c]!),
      0,
    );
    centers = newCenters;

    // E-step: reassign labels.
    const newLabels = assignLabels(rows, centers);
    const labelsUnchanged = newLabels.every((l, i) => l === labels[i]);
    labels = newLabels;

    if (labelsUnchanged) {
      strictlyConverged = true;
      break;
    }
    if (centerShift <= tolScaled) break;
  }

  if (!strictlyConverged) {
    labels = assignLabels(rows, centers);
  }
  const inertia = rows.reduce(
    (sum, row, i) => sum + distanceSquared(row, centers[labels[i]!]!),
    0,
  );
  return { k, labels, centers, inertia };
}

/** Mean silhouette coefficient (euclidean); singleton clusters score 0. */
export function silhouetteScore(rows: number[][], labels: number[]): number {
  const n = rows.length;
  const clusters = [...new Set(labels)];
  const distance = (i: number, j: number) =>
    Math.sqrt(distanceSquared(rows[i]!, rows[j]!));

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = labels[i]!;
    const ownSize = labels.filter((l) => l === own).length;
    if (ownSize === 1) continue; // s = 0
    let a = 0;
    let b = Infinity;
    for (const cluster of clusters) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] !== cluster || j === i) continue;
        sum += distance(i, j);
        count++;
      }
      if (cluster === own) {
        a = sum / count;
      } else if (count > 0) {
        b = Math.min(b, sum / count);
      }
    }
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

/** Silhouette-scored k selection over an inclusive range (ties → lowest k). */
export function findBestKmeans(
  rows: number[][],
  kMin = 2,
  kMax = 5,
): { best: KMeansResult; silhouette: number } {
  let best: KMeansResult | null = null;
  let bestScore = -Infinity;
  for (let k = kMin; k <= kMax; k++) {
    const result = kmeans(rows, k);
    const score = silhouetteScore(rows, result.labels);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }
  if (!best) throw new Error("no k evaluated");
  return { best, silhouette: bestScore };
}
