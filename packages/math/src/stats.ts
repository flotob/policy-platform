/* This file is a TypeScript port of code from red-dwarf
 * (https://github.com/polis-community/red-dwarf) and is licensed under the
 * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/), unlike the
 * MIT-licensed remainder of this repository. MPL-2.0 is file-scoped.
 */
/**
 * Comment statistics, group-informed consensus, and representative-statement
 * selection — ported from red-dwarf (reddwarf/utils/stats.py, consensus.py),
 * which reproduces the Polis statistics (Small et al. 2021, §4.3–4.4).
 *
 * Conventions carried over exactly:
 *   - Laplace smoothing via pseudo-count 1 (the ubiquitous `+1`s).
 *   - One- and two-proportion z-tests as in Polis (not textbook form).
 *   - Significance is one-tailed at the given confidence (default 90%).
 *   - "pass" votes (0) count toward n_seen but neither agree nor disagree.
 */

import type { VoteMatrix } from "./matrix.ts";

export interface GroupStatementStats {
  groupId: number;
  statementId: number;
  na: number;
  nd: number;
  ns: number;
  pa: number;
  pd: number;
  pat: number;
  pdt: number;
  ra: number;
  rd: number;
  rat: number;
  rdt: number;
}

export interface FormattedStatement {
  tid: number;
  "n-success": number;
  "n-trials": number;
  "p-success": number;
  "p-test": number;
  repness?: number;
  "repness-test"?: number;
  "repful-for"?: "agree" | "disagree";
  "cons-for"?: "agree" | "disagree";
  "n-agree"?: number;
  "best-agree"?: boolean;
}

/** Inverse standard-normal CDF (Acklam's algorithm, ~1e-9 relative error). */
export function normPpf(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0, 1)");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

export function probability(count: number, total: number, pseudoCount = 1): number {
  return (pseudoCount + count) / (pseudoCount * 2 + total);
}

export function onePropTest(succ: number, n: number): number {
  const s = succ + 1;
  const total = n + 1;
  return 2 * Math.sqrt(total) * (s / total - 0.5);
}

export function twoPropTest(
  succIn: number,
  succOut: number,
  nIn: number,
  nOut: number,
): number {
  const si = succIn + 1;
  const so = succOut + 1;
  const ni = nIn + 1;
  const no = nOut + 1;
  const pi1 = si / ni;
  const pi2 = so / no;
  const piHat = (si + so) / (ni + no);
  if (piHat === 1) return 0;
  return (pi1 - pi2) / Math.sqrt(piHat * (1 - piHat) * (1 / ni + 1 / no));
}

export function isSignificant(z: number, confidence = 0.9): boolean {
  return z > normPpf(confidence);
}

/**
 * Per-group, per-statement statistics over a vote matrix restricted to the
 * clustered participants, plus group-aware consensus (product of per-group
 * smoothed agree/disagree probabilities).
 */
export function commentStatistics(
  matrix: VoteMatrix,
  labels: number[],
  pseudoCount = 1,
): {
  grouped: GroupStatementStats[];
  groupAwareConsensusAgree: Map<number, number>;
  groupAwareConsensusDisagree: Map<number, number>;
} {
  if (labels.length !== matrix.participantIds.length) {
    throw new Error("labels must align with matrix participants");
  }
  const groupCount = new Set(labels).size;
  const grouped: GroupStatementStats[] = [];
  const gacAgree = new Map<number, number>();
  const gacDisagree = new Map<number, number>();

  matrix.statementIds.forEach((statementId, j) => {
    let productAgree = 1;
    let productDisagree = 1;
    for (let gid = 0; gid < groupCount; gid++) {
      let na = 0, nd = 0, ns = 0;
      let naOut = 0, ndOut = 0, nsOut = 0;
      matrix.values.forEach((row, i) => {
        const v = row[j]!;
        if (Number.isNaN(v)) return;
        const inGroup = labels[i] === gid;
        if (inGroup) {
          ns++;
          if (v === 1) na++;
          else if (v === -1) nd++;
        } else {
          nsOut++;
          if (v === 1) naOut++;
          else if (v === -1) ndOut++;
        }
      });
      const pa = probability(na, ns, pseudoCount);
      const pd = probability(nd, ns, pseudoCount);
      const paOut = probability(naOut, nsOut, pseudoCount);
      const pdOut = probability(ndOut, nsOut, pseudoCount);
      grouped.push({
        groupId: gid,
        statementId,
        na,
        nd,
        ns,
        pa,
        pd,
        pat: onePropTest(na, ns),
        pdt: onePropTest(nd, ns),
        ra: pa / paOut,
        rd: pd / pdOut,
        rat: twoPropTest(na, naOut, ns, nsOut),
        rdt: twoPropTest(nd, ndOut, ns, nsOut),
      });
      productAgree *= pa;
      productDisagree *= pd;
    }
    gacAgree.set(statementId, productAgree);
    gacDisagree.set(statementId, productDisagree);
  });

  return {
    grouped,
    groupAwareConsensusAgree: gacAgree,
    groupAwareConsensusDisagree: gacDisagree,
  };
}

function formatCommentStats(
  row: GroupStatementStats,
  style: "group-repness" | "consensus",
): FormattedStatement {
  const scoreAgree = style === "group-repness" ? row.rat : row.pat;
  const scoreDisagree = style === "group-repness" ? row.rdt : row.pdt;
  const useAgree = scoreAgree > scoreDisagree;
  const result: FormattedStatement = {
    tid: row.statementId,
    "n-success": useAgree ? row.na : row.nd,
    "n-trials": row.ns,
    "p-success": useAgree ? row.pa : row.pd,
    "p-test": useAgree ? row.pat : row.pdt,
  };
  if (style === "group-repness") {
    result.repness = useAgree ? row.ra : row.rd;
    result["repness-test"] = useAgree ? row.rat : row.rdt;
    result["repful-for"] = useAgree ? "agree" : "disagree";
  } else {
    result["cons-for"] = useAgree ? "agree" : "disagree";
  }
  return result;
}

function isStatementSignificant(row: GroupStatementStats, confidence: number): boolean {
  const agreeSig = isSignificant(row.pat, confidence) && isSignificant(row.rat, confidence);
  const disagreeSig = isSignificant(row.pdt, confidence) && isSignificant(row.rdt, confidence);
  return agreeSig || disagreeSig;
}

function beatsBestByRepnessTest(
  row: GroupStatementStats,
  best: GroupStatementStats | null,
): boolean {
  if (best === null) return true;
  return Math.max(row.rat, row.rdt) > Math.max(best.rat, best.rdt);
}

function beatsBestOfAgrees(
  row: GroupStatementStats,
  best: GroupStatementStats | null,
  confidence: number,
): boolean {
  if (row.na === 0 && row.nd === 0) return false;
  if (best !== null) {
    if (best.ra > 1.0) {
      const metric = (r: GroupStatementStats) => r.ra * r.rat * r.pa * r.pat;
      return metric(row) > metric(best);
    }
    const metric = (r: GroupStatementStats) => r.pa * r.pat;
    return metric(row) > metric(best);
  }
  return isSignificant(row.pat, confidence) || (row.ra > 1.0 && row.pa > 0.5);
}

const repnessMetric = (s: FormattedStatement) =>
  s.repness! * s["repness-test"]! * s["p-success"] * s["p-test"];

/** Per-group representative statements (Polis repness selection). */
export function selectRepresentativeStatements(
  grouped: GroupStatementStats[],
  modOutStatementIds: number[] = [],
  pickMax = 5,
  confidence = 0.9,
): Record<number, FormattedStatement[]> {
  const modOut = new Set(modOutStatementIds);
  const rows = grouped.filter((r) => !modOut.has(r.statementId));
  const groupIds = [...new Set(rows.map((r) => r.groupId))].sort((a, b) => a - b);
  const repness: Record<number, FormattedStatement[]> = {};

  for (const gid of groupIds) {
    const groupRows = rows.filter((r) => r.groupId === gid);

    let bestAgree: GroupStatementStats | null = null;
    for (const row of groupRows) {
      if (beatsBestOfAgrees(row, bestAgree, confidence)) bestAgree = row;
    }

    const sufficient = groupRows.filter((r) => isStatementSignificant(r, confidence));
    let bestOverall: GroupStatementStats | null = null;
    if (sufficient.length === 0) {
      for (const row of groupRows) {
        if (beatsBestByRepnessTest(row, bestOverall)) bestOverall = row;
      }
    }
    // Stable sort by descending repness metric (pandas sort_values is stable).
    const sufficientFormatted = sufficient
      .map((r) => formatCommentStats(r, "group-repness"))
      .map((s, i) => ({ s, i, m: repnessMetric(s) }))
      .sort((a, b) => b.m - a.m || a.i - b.i)
      .map(({ s }) => s);

    let bestHead: FormattedStatement[] = [];
    if (bestAgree !== null) {
      const formatted = formatCommentStats(bestAgree, "group-repness");
      formatted["n-agree"] = formatted["n-success"];
      formatted["best-agree"] = true;
      bestHead = [formatted];
    } else if (bestOverall !== null) {
      bestHead = [formatCommentStats(bestOverall, "group-repness")];
    }

    let selected = [
      ...bestHead,
      ...sufficientFormatted.filter(
        (s) => bestHead.length > 0 && bestHead[0]!.tid !== s.tid,
      ),
    ];
    selected = selected.slice(0, pickMax);
    // Python sorted() is stable; 'agree' < 'disagree' lexicographically.
    selected = selected
      .map((s, i) => ({ s, i }))
      .sort(
        (a, b) =>
          (a.s["repful-for"]! < b.s["repful-for"]! ? -1
            : a.s["repful-for"]! > b.s["repful-for"]! ? 1 : 0) || a.i - b.i,
      )
      .map(({ s }) => s);
    repness[gid] = selected;
  }
  return repness;
}

/** Overall consensus statements over the full raw matrix (no groups). */
export function selectConsensusStatements(
  matrix: VoteMatrix,
  modOutStatementIds: number[] = [],
  pickMax = 5,
  probThreshold = 0.5,
  confidence = 0.9,
): { agree: FormattedStatement[]; disagree: FormattedStatement[] } {
  const labels = new Array(matrix.participantIds.length).fill(0);
  const { grouped } = commentStatistics(matrix, labels);
  const modOut = new Set(modOutStatementIds);
  const rows = grouped.filter((r) => !modOut.has(r.statementId));

  const pick = (direction: "agree" | "disagree"): FormattedStatement[] => {
    const candidates = rows.filter((r) =>
      direction === "agree"
        ? r.pa > probThreshold && isSignificant(r.pat, confidence)
        : r.pd > probThreshold && isSignificant(r.pdt, confidence),
    );
    const metric = (r: GroupStatementStats) =>
      direction === "agree" ? r.pa * r.pat : r.pd * r.pdt;
    // Dense rank on descending metric, stable sort by rank (pandas semantics).
    const sorted = candidates
      .map((r, i) => ({ r, i, m: metric(r) }))
      .sort((a, b) => b.m - a.m || a.i - b.i)
      .slice(0, pickMax)
      .map(({ r }) => {
        const formatted = formatCommentStats(r, "consensus");
        delete formatted["cons-for"];
        return formatted;
      });
    return sorted;
  };

  return { agree: pick("agree"), disagree: pick("disagree") };
}
