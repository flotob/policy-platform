/**
 * The diagnosis layer — policy's own contribution on top of the ported Polis
 * math. Computes, deterministically, the concept paper's conflict diagnoses:
 *
 *   bridge_of_reasons   Camps agree on a conclusion AND on the premises
 *                       feeding it — consensus that will hold.
 *   bridge_of_results   Camps agree on the conclusion but from divergent,
 *                       conflicting premises — a false consensus that breaks
 *                       at the first implementation question (demo point P17).
 *   value_conflict      The fact base is settled or quiet; one or more value
 *                       points split the camps — no further evidence helps,
 *                       the decision belongs to the political body.
 *   pseudo_fact_fight   Values are shared; the camps split on fact points —
 *                       resolvable for the price of an expert opinion.
 *
 * Everything here is a pure function of vote statistics + the argument graph.
 * No LLM, no RNG. Same inputs → same outputs, always.
 *
 * ⚠ Thresholds below are PROVISIONAL v0 defaults, exported and documented so
 * they can be tuned (and eventually validated against real consultations).
 * The *shapes* of the diagnoses come from the concept paper; the numeric
 * cutoffs are engineering choices to be reviewed.
 */

import type { GroupStatementStats } from "./stats.ts";
import { isSignificant } from "./stats.ts";

export type PointKind = "fact" | "value" | "design" | "gap";

export interface DiagnosisPoint {
  id: string;
  kind: PointKind;
  /** Statement carrying this point's votes (v0: one statement per point). */
  statementId: number;
  /** Points this one supports (edges toward conclusions). */
  supports?: string[];
}

export interface DiagnosisThresholds {
  /** Smoothed within-group agree probability ≥ this ⇒ the group agrees. */
  groupAgree: number;
  /** Smoothed within-group disagree probability ≥ this ⇒ the group disagrees. */
  groupDisagree: number;
  /** Confidence for significance tests (matches the stats layer). */
  confidence: number;
}

export const DEFAULT_THRESHOLDS: DiagnosisThresholds = {
  groupAgree: 0.6,
  groupDisagree: 0.6,
  confidence: 0.9,
};

/** Vote-profile classification of a single statement across groups. */
export type StatementProfile =
  | "bridged" // every group majority-agrees, significantly
  | "divisive" // at least one group agrees while another disagrees
  | "open"; // anything else — not enough signal either way

export interface PointDiagnosis {
  pointId: string;
  kind: PointKind;
  profile: StatementProfile;
  /** Per-group smoothed agree probabilities, indexed by group id. */
  groupAgreeProbability: number[];
}

export type ConclusionDiagnosis =
  | "bridge_of_reasons"
  | "bridge_of_results"
  | "contested"
  | "open";

export interface ConsultationDiagnosis {
  points: PointDiagnosis[];
  /** For every point with incoming support edges. */
  conclusions: Record<string, ConclusionDiagnosis>;
  /** Consultation-level pattern per the concept paper (may be null). */
  overall: "value_conflict" | "pseudo_fact_fight" | null;
  thresholds: DiagnosisThresholds;
}

/** Classify one statement's cross-group vote profile. */
export function classifyStatement(
  stats: GroupStatementStats[],
  thresholds: DiagnosisThresholds = DEFAULT_THRESHOLDS,
): StatementProfile {
  if (stats.length === 0) return "open";
  const agrees = stats.map(
    (s) =>
      s.pa >= thresholds.groupAgree && isSignificant(s.pat, thresholds.confidence),
  );
  const disagrees = stats.map(
    (s) =>
      s.pd >= thresholds.groupDisagree &&
      isSignificant(s.pdt, thresholds.confidence),
  );
  if (agrees.every(Boolean)) return "bridged";
  if (agrees.some(Boolean) && disagrees.some(Boolean)) return "divisive";
  return "open";
}

export function diagnose(
  points: DiagnosisPoint[],
  groupedStats: GroupStatementStats[],
  thresholds: DiagnosisThresholds = DEFAULT_THRESHOLDS,
): ConsultationDiagnosis {
  const byStatement = new Map<number, GroupStatementStats[]>();
  for (const s of groupedStats) {
    const list = byStatement.get(s.statementId) ?? [];
    list.push(s);
    byStatement.set(s.statementId, list);
  }

  const pointDiagnoses: PointDiagnosis[] = points.map((p) => {
    const stats = (byStatement.get(p.statementId) ?? []).sort(
      (a, b) => a.groupId - b.groupId,
    );
    return {
      pointId: p.id,
      kind: p.kind,
      profile: classifyStatement(stats, thresholds),
      groupAgreeProbability: stats.map((s) => s.pa),
    };
  });
  const profileOf = new Map(pointDiagnoses.map((d) => [d.pointId, d.profile]));

  // Conclusion diagnoses: examine each point that receives support edges.
  const supporters = new Map<string, string[]>();
  for (const p of points) {
    for (const target of p.supports ?? []) {
      supporters.set(target, [...(supporters.get(target) ?? []), p.id]);
    }
  }
  const conclusions: Record<string, ConclusionDiagnosis> = {};
  for (const [conclusionId, premiseIds] of supporters) {
    const conclusionProfile = profileOf.get(conclusionId);
    if (conclusionProfile === undefined) continue;
    const premiseProfiles = premiseIds.map((id) => profileOf.get(id)!);
    if (conclusionProfile === "bridged") {
      // The paper's crucial distinction: does the agreement rest on shared
      // premises (reasons) or does it only coincide at the result?
      conclusions[conclusionId] = premiseProfiles.some((p) => p === "divisive")
        ? "bridge_of_results"
        : "bridge_of_reasons";
    } else if (conclusionProfile === "divisive") {
      conclusions[conclusionId] = "contested";
    } else {
      conclusions[conclusionId] = "open";
    }
  }

  // Consultation-level pattern over fact/value points (design/gap excluded).
  const facts = pointDiagnoses.filter((d) => d.kind === "fact");
  const values = pointDiagnoses.filter((d) => d.kind === "value");
  const settled = (d: PointDiagnosis) => d.profile !== "divisive";
  let overall: ConsultationDiagnosis["overall"] = null;
  if (values.some((d) => d.profile === "divisive") && facts.every(settled)) {
    overall = "value_conflict";
  } else if (
    facts.some((d) => d.profile === "divisive") &&
    values.length > 0 &&
    values.every(settled)
  ) {
    overall = "pseudo_fact_fight";
  }

  return { points: pointDiagnoses, conclusions, overall, thresholds };
}
