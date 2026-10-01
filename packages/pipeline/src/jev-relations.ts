/**
 * Relations across submissions (exp/jev): who supports whom, who attacks
 * whom — through which critical question. Pairwise judgments were
 * unaffordable with the LLM; with Jev every point is judged against its
 * closest neighbours (same measure or the bill as a whole, any submission)
 * in one request. Edges are directed: `others.oN` → `point`.
 */

import { choice } from "@policy/llm";

export const RELATIONS_FAMILY = "relations.v2";
/** Neighbours judged per point (lexical shortlist). */
export const RELATION_SHORTLIST = 15;
/** An edge is written when the chosen relation has at least this probability. */
export const EDGE_MIN = 0.7;

// Both directions are explicit options: asked "how does X relate to the
// point?", Jev otherwise reads a premise and its conclusion either way round.
const RELATION = {
  x_supports: "`others.X` is a REASON for `point`: it states a fact, effect, or value from which `point` follows or that makes `point` more plausible.",
  point_supports: "The reverse: `point` is a reason for `others.X` (`others.X` is the demand or conclusion, `point` the premise).",
  empirics: "`others.X` argues against `point` by disputing that a claimed effect or fact actually holds.",
  alternatives: "`others.X` argues against `point` by naming a milder, cheaper, or different means that reaches the same goal.",
  goal_conflict: "`others.X` argues against `point` because it harms another goal we also care about — costs, affordability, side effects.",
  feasibility: "`others.X` argues against `point` because it cannot be implemented as proposed — capacity, data, deadlines, administration.",
  value_conflict: "`others.X` argues against `point` by disputing that the value behind it is worth what it sacrifices.",
  point_attacks: "The reverse: `point` argues against `others.X`.",
  same_direction: "Both argue in the same direction (e.g. two demands with the same aim, two criticisms of the same provision), but neither is a reason for the other.",
  restates: "`others.X` says essentially the same as `point` (a duplicate).",
  unrelated: "No argumentative relation — they may share the topic, but neither supports nor attacks the other.",
} as const;

export type RelationKind = keyof typeof RELATION;
const ATTACKS = new Set(["empirics", "alternatives", "goal_conflict", "feasibility", "value_conflict"]);

export function relationRequest(
  consultation: string,
  point: { label: string; summary: string | null },
  others: { label: string; summary: string | null }[],
) {
  const state: Record<string, { label: string; summary: string | null }> = {};
  const questions: Record<string, ReturnType<typeof choice>> = {};
  others.forEach((o, i) => {
    const key = `o${i + 1}`;
    state[key] = { label: o.label, summary: o.summary };
    const criteria: Record<string, string> = {};
    for (const [k, v] of Object.entries(RELATION)) criteria[k] = v.replaceAll("others.X", `others.${key}`);
    questions[key] = choice(`How does \`others.${key}\` relate to \`point\` in the debate?`, criteria);
  });
  return { state: { consultation, point, others: state }, questions };
}

/**
 * The edge to write, if any: x_supports / an attack door → other → point;
 * point_supports → point → other. A reverse attack has no door here; it is
 * written from the other point's own request (when it shortlists this one).
 */
export function decideRelation(a: { choice: string; probabilities: Record<string, number> }): {
  kind: RelationKind;
  p: number;
  edge: { kind: string; reverse: boolean } | null;
} {
  const kind = a.choice as RelationKind;
  const p = a.probabilities[kind] ?? 0;
  if (p < EDGE_MIN) return { kind, p, edge: null };
  if (kind === "x_supports") return { kind, p, edge: { kind: "supports", reverse: false } };
  if (kind === "point_supports") return { kind, p, edge: { kind: "supports", reverse: true } };
  if (ATTACKS.has(kind)) return { kind, p, edge: { kind, reverse: false } };
  return { kind, p, edge: null };
}
