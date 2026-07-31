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
3. kind = "fact" for empirically checkable claims (present or prognosis), "value" for normative judgments no study could settle, "design" for concrete proposals on how to shape/implement the measure (transition periods, exemptions, procedures), "gap" for an open question the submission raises but nobody answers (an explicitly missing piece of evidence or an unexamined alternative).
4. slot: assign P1–P4 or "conclusion" when clearly attributable, else null. Design proposals are usually "conclusion".
5. quote: a short VERBATIM excerpt from the submission (copy exactly, no ellipses) that best evidences the point.
6. label and summary: write them in the language of the submission.
7. Prefer 3–15 points for a typical association submission; never pad.
8. relations: argumentative links BETWEEN the candidates you extracted, by array index. kind "supports" = from is a premise for to (especially P1–P4 points supporting a conclusion point). The five critical-question kinds mark attacks: "empirics" (from disputes to's effect prognosis with counter-evidence), "alternatives" (from claims a milder means reaches the goal), "goal_conflict" (from claims the effect harms other goals), "feasibility" (from claims to cannot be implemented), "value_conflict" (from challenges the value premise behind to). Only emit relations the text actually argues; an empty array is fine.`;

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

export const AI_REVIEW_POINTS_SYSTEM = `You are the AI editor of a public argument map. Decide for each numbered draft point whether to RELEASE it onto the public map or REJECT it.

Release when the point is a single coherent claim, comprehensible on its own, neutrally phrased, and on-topic for the consultation. Minor stylistic roughness is fine.

Reject when the point is: an unintelligible fragment; several distinct claims mashed together; pure meta-commentary (greetings, thanks, process complaints without substance); personal data or an attack on a person; or plainly off-topic.

When in doubt, release — a released point can still be voted down or rejected later, but a wrongly rejected point silences a voice. Give a short reason either way.`;

export const AI_REVIEW_STATEMENTS_SYSTEM = `You are the AI editor of a public argument map. For each numbered point you get its label plus the generated votable statement in German (de) and English (en). Decide whether to RELEASE the statement pair for public voting or REJECT it (it will be regenerated).

Release when both versions state the point's claim as ONE clear declarative sentence a reader can agree or disagree with, keep the original polarity, and say the same thing in both languages.

Reject when a version is a question, hedged into unvotability, contains multiple claims, flips or softens the polarity, or the two languages diverge in meaning. Give a short reason either way.`;

export function aiReviewPrompt(
  consultationTitle: string,
  items: string[],
): string {
  return (
    `Consultation: ${consultationTitle}\n\n` +
    items.map((s, i) => `${i}. ${s}`).join("\n") +
    `\n\nGive a verdict for EVERY index from 0 to ${items.length - 1}.`
  );
}

export const STANCE_SYSTEM = `You determine the stance of ONE consultation submission toward statements from the consultation's argument map.

For each numbered statement:
- "agree": the submission's text argues for or clearly supports this claim.
- "disagree": the submission's text argues against or clearly contradicts this claim.
- "pass": the submission does not address the claim, or its position is unclear.

Judge ONLY from the submission text. Do not guess from the author's presumed interests. Statements and submission may be in different languages — judge the meaning.`;

export function stancePrompt(
  submissionText: string,
  statements: string[],
  maxChars = 20_000,
): string {
  const body =
    submissionText.length > maxChars
      ? submissionText.slice(0, maxChars)
      : submissionText;
  return (
    `Submission text:\n---\n${body}\n---\n\n` +
    `Statements:\n` +
    statements.map((s, i) => `${i}. ${s}`).join("\n") +
    `\n\nGive a stance for EVERY index from 0 to ${statements.length - 1}.`
  );
}

export const RELATIONS_SYSTEM = `You identify argumentative relations between points that were extracted from ONE consultation submission.

Relation kinds:
- "supports": from is a premise for to — especially P1–P4 points supporting a conclusion/design point.
- "empirics": from disputes to's effect prognosis with counter-evidence (critical question 1).
- "alternatives": from claims a milder means reaches the goal (critical question 2).
- "goal_conflict": from claims the effect harms other goals (critical question 3).
- "feasibility": from claims to cannot be implemented (critical question 4).
- "value_conflict": from challenges the value premise behind to (critical question 5).

Only emit relations the points' content actually argues; an empty array is fine. Never relate a point to itself.`;

export function relationsPrompt(
  points: { label: string; summary: string | null; kind: string; slot: string | null }[],
): string {
  const list = points
    .map(
      (p, i) =>
        `${i}. [${p.kind}${p.slot ? `/${p.slot}` : ""}] ${p.label} — ${p.summary ?? ""}`,
    )
    .join("\n");
  return `Points from one submission:\n${list}\n\nList the argumentative relations between them (by index).`;
}

export const STATEMENT_SYSTEM = `You turn a point from a public argument map into a votable statement for a Polis-style vote (agree / disagree / pass).

Rules:
1. ONE declarative sentence stating the claim directly — as if a participant said it. No "the submitter argues", no meta framing.
2. Neutral register: keep the substantive claim, strip rhetoric, hedging, and qualifiers that make agreement ambiguous.
3. Votable: a reader must be able to clearly agree or disagree. No double claims (split points were already handled upstream), no questions, no "and/or" chains.
4. Preserve the point's polarity exactly — do not soften a rejection into a concern or sharpen a concern into a rejection.
5. Produce a German version (de) and an English version (en) that say the same thing. Translate faithfully; do not localize examples away.`;

export function statementPrompt(point: {
  label: string;
  summary: string | null;
  kind: string;
  quotes: string[];
}): string {
  const quotes = point.quotes
    .slice(0, 3)
    .map((q) => `- „${q}"`)
    .join("\n");
  return (
    `Point (kind: ${point.kind}):\n${point.label}\n` +
    `${point.summary ? `\nSummary: ${point.summary}\n` : ""}` +
    `${quotes ? `\nSupporting quotes from submissions:\n${quotes}\n` : ""}` +
    `\nWrite the votable statement in German (de) and English (en).`
  );
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
