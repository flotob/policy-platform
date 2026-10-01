/**
 * Closed-set classification as System One choices (exp/jev step 3).
 *
 * Replaces four LLM batch stages that returned verdicts keyed by array
 * index (classify-cq pass 2, segment-measures assign, cluster-themes assign,
 * condense-map sweep): a skipped index left an item silently unprocessed, a
 * shifted index assigned a valid but wrong label. Here every point is its own
 * request, every answer is keyed by question name, and every option is
 * explicit — including the no-match outcomes ("übergreifend", "none").
 */

import { choice } from "@policy/llm";

export const CLASSIFY_FAMILY = "classify.v2";

export const DOORS = {
  empirics:
    "Empirics: disputes whether the claimed effect actually occurs (e.g. 'the grid cannot absorb the power', 'the heat pumps will not reach the efficiency assumed').",
  alternatives:
    "Alternatives: argues that a milder, cheaper, or different means reaches the same goal (e.g. 'tenders instead of an obligation', 'incentives instead of compulsion').",
  goal_conflict:
    "Goal conflict: the measure incidentally harms another goal we also care about — costs, affordability, competition, side effects (e.g. 'rents rise', 'monopoly prices').",
  feasibility:
    "Feasibility: the measure cannot be implemented as proposed — capacity, skilled workers, data, deadlines, administrative effort (e.g. 'the municipalities lack staff').",
  value_conflict:
    "Value conflict: disputes whether the underlying value is worth what is sacrificed for it (e.g. 'climate protection does not justify restricting property rights').",
} as const;

const ROLES = {
  claim:
    "A premise in favour of the measure or a neutral statement: the situation the measure responds to, an effect it achieves, a goal it serves, a value that carries it, or approval of the measure or one of its provisions.",
  objection:
    "Bears against the measure or one of its premises: rejection of a provision, criticism, or a plain statement of fact that counts against the measure in this debate (e.g. 'planning offices lack staff' is a feasibility objection; 'district heating emissions are underestimated' is an empirics objection).",
  instrument:
    "A shaping proposal ('if we do it, then like this'): a concrete change to a provision, a transition period, hardship clause, exemption, staggering, funding, or procedural safeguard.",
  gap: "An open question the point raises that nobody answers: missing evidence or an unexamined alternative.",
} as const;

export interface ClassifyContext {
  measures: string[];
  themes: string[];
  /** Canonical map points of the point's measure (empty: no map-point question). */
  mapPoints: { id: string; label: string; text: string }[];
}

export function classifyQuestions(ctx: ClassifyContext) {
  const measureCriteria: Record<string, string> = {};
  ctx.measures.forEach((m, i) => {
    measureCriteria[`m${i + 1}`] = `The point is specific to the sub-decision "${m}".`;
  });
  measureCriteria.general =
    "Only if the point is not specific to any one sub-decision: it concerns the proposal as a whole or several sub-decisions at once (general situation, overall verdict, cross-cutting values).";

  const themeCriteria: Record<string, string> = {};
  ctx.themes.forEach((t, i) => {
    themeCriteria[`t${i + 1}`] = `The point's topic is "${t}".`;
  });
  themeCriteria.none = "None of the themes fits the point's topic.";

  const questions: Record<string, ReturnType<typeof choice>> = {
    role: choice("What role does `point` play in the debate about the proposed measure?", ROLES),
    door_objection: choice(
      "Assume `point` is an objection. Through which critical question does it attack the measure?",
      DOORS,
    ),
    door_instrument: choice(
      "Assume `point` is a shaping proposal. Which critical question does it primarily answer — which concern does it cushion?",
      DOORS,
    ),
    measure: choice("Which sub-decision of the proposal does `point` concern?", measureCriteria),
    theme: choice("Which theme does `point` belong to, by topic (not by its position on it)?", themeCriteria),
  };
  if (ctx.mapPoints.length > 0) {
    const mpCriteria: Record<string, string> = {};
    ctx.mapPoints.forEach((m, i) => {
      mpCriteria[`k${i + 1}`] = `\`point\` expresses, supports, details, or restates the canonical point "${m.label}" (\`map_points.k${i + 1}\`).`;
    });
    mpCriteria.none = "`point` fits none of the canonical map points.";
    questions.map_point = choice(
      "Which canonical map point of this sub-decision does `point` belong to?",
      mpCriteria,
    );
  }
  return questions;
}

export function classifyState(
  consultation: string,
  ctx: ClassifyContext,
  point: { label: string; summary: string | null; kind: string },
) {
  const measures: Record<string, string> = {};
  ctx.measures.forEach((m, i) => (measures[`m${i + 1}`] = m));
  const themes: Record<string, string> = {};
  ctx.themes.forEach((t, i) => (themes[`t${i + 1}`] = t));
  const map_points: Record<string, { label: string; text: string }> = {};
  ctx.mapPoints.forEach((m, i) => (map_points[`k${i + 1}`] = { label: m.label, text: m.text }));
  return {
    consultation,
    point,
    measures,
    themes,
    ...(ctx.mapPoints.length > 0 ? { map_points } : {}),
  };
}

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

export interface ClassifyDecision {
  role: keyof typeof ROLES;
  cq: string | null;
  answersCq: string[] | null;
  measure: string;
  theme: string | null;
  mapPointId: string | null | undefined;
  confidence: { role: number; door: number | null; measure: number; theme: number; mapPoint: number | null };
}

export function decideClassify(ctx: ClassifyContext, a: Record<string, unknown>): ClassifyDecision {
  const role = a.role as ChoiceAnswer;
  const doorO = a.door_objection as ChoiceAnswer;
  const doorI = a.door_instrument as ChoiceAnswer;
  const measure = a.measure as ChoiceAnswer;
  const theme = a.theme as ChoiceAnswer;
  const mp = a.map_point as ChoiceAnswer | undefined;
  const r = role.choice as keyof typeof ROLES;
  return {
    role: r,
    cq: r === "objection" ? doorO.choice : null,
    answersCq: r === "instrument" ? [doorI.choice] : null,
    measure: measure.choice === "general" ? "übergreifend" : ctx.measures[Number(measure.choice.slice(1)) - 1]!,
    theme: theme.choice === "none" ? null : ctx.themes[Number(theme.choice.slice(1)) - 1]!,
    mapPointId: mp === undefined ? undefined : mp.choice === "none" ? null : ctx.mapPoints[Number(mp.choice.slice(1)) - 1]!.id,
    confidence: {
      role: role.confidence,
      door: r === "objection" ? doorO.confidence : r === "instrument" ? doorI.confidence : null,
      measure: measure.confidence,
      theme: theme.confidence,
      mapPoint: mp ? mp.confidence : null,
    },
  };
}

/** Role as encoded in the existing columns (for comparison). */
export function existingRole(p: { kind: string; cq: string | null; answers_cq: string[] | null }): string {
  if (p.kind === "gap") return "gap";
  if (p.cq) return "objection";
  if ((p.answers_cq?.length ?? 0) > 0) return "instrument";
  return "claim";
}
