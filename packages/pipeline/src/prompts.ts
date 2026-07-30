/**
 * Prompt construction for decomposition and matching.
 *
 * The decomposition prompt encodes the concept paper's argument grammar
 * (practical reasoning, P1–P4) so the model fills a structure instead of
 * summarizing freely. Labels/summaries are produced in the submission's own
 * language. Prompt text changes MUST run the eval harness (roadmap §6.1) —
 * every call's prompt hash lands in provenance.
 */

export const DECOMPOSE_SYSTEM = `You decompose consultation submissions into distinct argumentative points for a public argument map.

The debate follows the practical-reasoning schema for a proposed measure M:
- P1 (situation): claims about the present situation.
- P2 (effect prognosis): claims that M will/will not cause some effect.
- P3 (goal attainment): claims that the effect does/does not serve the stated goal.
- P4 (value): claims that a value justifies/outweighs the measure's burdens.
- conclusion: overall support or rejection of M, or a concrete design proposal for how M should be shaped.

Rules:
1. Extract every DISTINCT point; merge repetitions within the submission.
2. Strip rhetoric and tone; keep the argumentative core, neutrally phrased.
3. kind = "fact" for empirically checkable claims (present or prognosis), "value" for normative judgments no study could settle, "design" for concrete proposals on how to shape/implement the measure (transition periods, exemptions, procedures).
4. slot: assign P1–P4 or "conclusion" when clearly attributable, else null. Design proposals are usually "conclusion".
5. quote: a short VERBATIM excerpt from the submission (copy exactly, no ellipses) that best evidences the point.
6. label and summary: write them in the language of the submission.
7. Prefer 3–15 points for a typical association submission; never pad.`;

export function decomposePrompt(text: string, maxChars = 24_000): {
  prompt: string;
  truncated: boolean;
} {
  const truncated = text.length > maxChars;
  const body = truncated ? text.slice(0, maxChars) : text;
  return {
    prompt:
      `Submission text${truncated ? " (truncated)" : ""}:\n\n---\n${body}\n---\n\n` +
      `Decompose it into distinct points per the rules.`,
    truncated,
  };
}

export const MATCH_SYSTEM = `You decide whether a candidate point from a consultation submission is the SAME point as one already on the argument map, or a genuinely new point.

The same point = the same claim content, even in different words, tone, or detail level. A different aspect, a narrower/broader claim with different implications, or a different mechanism = a new point.

Be conservative about matching: when in doubt whether nuance is lost by merging, prefer "new". A false merge silently erases a voice; a false new point is cheaply merged later by editors.`;

export function matchPrompt(
  candidate: { label: string; summary: string },
  existing: { label: string; summary: string | null }[],
): string {
  const list = existing
    .map((p, i) => `${i}. ${p.label} — ${p.summary ?? ""}`)
    .join("\n");
  return (
    `Candidate point:\n${candidate.label} — ${candidate.summary}\n\n` +
    `Existing points on the map:\n${list}\n\n` +
    `Is the candidate the same point as one of the existing ones? ` +
    `If matched, give its number as matched_index; if new, matched_index = null.`
  );
}
