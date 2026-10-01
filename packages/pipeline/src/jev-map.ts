/**
 * Jev questions on the Landkarte level (exp/jev): which Landkarten-Punkt an
 * extraction point belongs to and whether two proposed Landkarten-Punkte ask
 * the same question (condense.ts), and the false-bridge question recorded
 * next to the LLM reasons check (diagnose-map.ts).
 */

import { choice, noul } from "@policy/llm";

export const MAP_ASSIGN_FAMILY = "map-assign.v2";

/** A Landkarten-Punkt stands for one question; its statement answers it in one direction. */
export function mapAssignQuestion(mapPoints: { label: string; question?: string | null }[]) {
  const criteria: Record<string, string> = {};
  mapPoints.forEach((m, i) => {
    const q = m.question ? ` — the question "${m.question}"` : "";
    criteria[`k${i + 1}`] =
      `\`point\` takes a position on the question of "${m.label}" (\`map_points.k${i + 1}\`)${q}: it agrees or disagrees with that statement, wants it stricter or looser, or gives a fact or reason for one side of it.`;
  });
  criteria.none = "`point` takes a position on none of these questions.";
  return {
    map_point: choice(
      "Which question of this measure does `point` take a position on? Every Landkarten-Punkt in `map_points` stands for one question; its `text` answers it in one direction, and a point that holds the OPPOSITE answer belongs to the same Landkarten-Punkt.",
      criteria,
    ),
  };
}

export const MAP_DEDUPE_FAMILY = "map-dedupe.v1";
/** At or above this P(same question) two proposed Landkarten-Punkte merge. */
export const SAME_QUESTION_MIN = 0.5;

export function sameQuestion(a: string, b: string) {
  return noul(
    `Do the Landkarten-Punkte \`points.${a}\` and \`points.${b}\` ask the same question, so that a vote on one already decides the other — also when one is the mirror image ("too strict" / "too lax") or a variant ("delete it" / "loosen it") of the other?`,
    {
      true: `\`points.${a}\` and \`points.${b}\` ask the same question; one Landkarten-Punkt is enough.`,
      false: `\`points.${a}\` and \`points.${b}\` ask different questions; someone could agree with one and hold a separate view on the other.`,
    },
  );
}

/**
 * Merge groups from pairwise same-question probabilities (union-find): each
 * index maps to the earliest index of its group, which survives.
 */
export function mergeGroups(n: number, pairs: { i: number; j: number; p: number }[], min = SAME_QUESTION_MIN): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const root = (x: number): number => (parent[x] === x ? x : (parent[x] = root(parent[x]!)));
  for (const { i, j, p } of pairs) {
    if (p < min) continue;
    const [a, b] = [root(i), root(j)];
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  return parent.map((_, i) => root(i));
}

/** Recorded next to the LLM reasons check (no longer a gate: it let 53/53 WPG bridges through). */
export const REASONS_SCREEN = noul(
  "Do the points in `members` and the quotes in `quotes` back the claim in `claim` for DIVERGING reasons that cannot both be satisfied — e.g. one side wants a transition period so that the obligation arrives cleanly, the other so that it never arrives?",
  {
    true: "The supporters agree with the claim but want different, ultimately incompatible things from it; the agreement would break at the first design question.",
    false: "The supporters agree for the same or compatible reasons, or the material shows no sign of diverging motives.",
  },
);
