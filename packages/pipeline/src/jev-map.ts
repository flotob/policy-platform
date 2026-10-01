/**
 * Jev questions on the Landkarte level (exp/jev): which Landkarten-Punkt an
 * extraction point belongs to (condense.ts), and the pre-screen for false
 * bridges before the LLM reasons check (diagnose-map.ts).
 */

import { choice, noul } from "@policy/llm";

export const MAP_ASSIGN_FAMILY = "map-assign.v1";

export function mapAssignQuestion(mapPoints: { label: string }[]) {
  const criteria: Record<string, string> = {};
  mapPoints.forEach((m, i) => {
    criteria[`k${i + 1}`] = `\`point\` expresses, supports, details, or restates the canonical point "${m.label}" (\`map_points.k${i + 1}\`).`;
  });
  criteria.none = "`point` fits none of the canonical map points.";
  return { map_point: choice("Which canonical map point of this measure does `point` belong to?", criteria) };
}

/** Below this P(diverging reasons) the LLM reasons check is skipped. */
export const REASONS_SCREEN_MIN = 0.25;

export const REASONS_SCREEN = noul(
  "Do the points in `members` and the quotes in `quotes` back the claim in `claim` for DIVERGING reasons that cannot both be satisfied — e.g. one side wants a transition period so that the obligation arrives cleanly, the other so that it never arrives?",
  {
    true: "The supporters agree with the claim but want different, ultimately incompatible things from it; the agreement would break at the first design question.",
    false: "The supporters agree for the same or compatible reasons, or the material shows no sign of diverging motives.",
  },
);
