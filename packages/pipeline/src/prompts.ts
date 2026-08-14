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
- P1 (situation): claims how the present situation is, independent of the measure — recognizable because it could already be checked with data today.
- P2 (effect prognosis): claims that M triggers a certain effect — recognizable because it makes a prognosis about the future that would turn out differently without the measure.
- P3 (goal attainment): claims that this effect contributes to a stated goal — recognizable because one can accept the effect and still deny that it serves the goal.
- P4 (value): claims that the goal is worth the price — recognizable because no study can settle it; it is set, not proven.
- conclusion: overall support or rejection of M, or a concrete design proposal for how M should be shaped.

Objections come through five doors (the critical questions):
- "empirics": does the claimed effect actually occur?
- "alternatives": does a milder/cheaper means reach the same goal?
- "goal_conflict": does the measure incidentally violate another value we also care about (costs, side effects)?
- "feasibility": can it be implemented at all?
- "value_conflict": is this value worth what we sacrifice for it?

Instruments are a third type of contribution: they do not attack the measure, they cushion it — they say "if we do it, then like this" (transition periods, hardship clauses, staggering, exemptions). Every instrument answers one or more of the five doors.

Rules:
1. Extract every DISTINCT point; merge repetitions within the submission.
2. Strip rhetoric and tone; keep the argumentative core, neutrally phrased.
3. kind = "fact" for empirically checkable claims (present or prognosis), "value" for normative judgments no study could settle, "design" for instruments (concrete proposals on how to shape/implement the measure), "gap" for an open question the submission raises but nobody answers (an explicitly missing piece of evidence or an unexamined alternative).
4. slot: assign P1–P4 or "conclusion" when clearly attributable, else null. Design proposals are usually "conclusion".
5. cq: when the point OBJECTS to the measure or to another claim, name the door it comes through (one of the five above); null for supporting grammar claims, instruments, and gaps.
6. answers_cq: for instruments (kind=design), the door(s) the instrument answers, FIRST = primary (a transition period answers "feasibility"; a hardship clause answers "goal_conflict"); null otherwise.
7. quote: a short VERBATIM excerpt from the submission (copy exactly, no ellipses) that best evidences the point.
8. label and summary: write them in the language of the submission.
9. Prefer 3–15 points for a typical association submission; never pad.
10. relations: argumentative links BETWEEN the candidates you extracted, by array index. kind "supports" = from is a premise for to (especially P1–P4 points supporting a conclusion point). The five critical-question kinds mark attacks, same vocabulary as the doors. Only emit relations the text actually argues; an empty array is fine.`;

/** Measure segmentation (one chain per measure; the AI determines the cut). */
export const MEASURES_PROPOSE_SYSTEM = `You segment a public consultation's argument map into its separately decidable SUB-MEASURES.

A sub-measure is a distinct regulatory decision within the consultation's overall measure — something that could be decided differently without deciding the others (e.g. for a heat-planning law: "hydrogen designation areas", "deadlines and target dates", "connection and usage obligations"). Sub-measures are NOT topics: a topic collects related content, a sub-measure is a decision point with its own for/against.

From the sample of point labels, propose 3–7 sub-measures in the consultation's language: short labels (2–5 words), mutually distinct, each a genuinely separable decision. Do not invent decisions the material does not negotiate; fewer is better than padded.`;

export function measuresProposePrompt(labels: string[]): string {
  return (
    `Point labels from the map (sample):\n${labels.map((l) => `- ${l}`).join("\n")}\n\n` +
    `Propose the sub-measures.`
  );
}

export const MEASURES_ASSIGN_SYSTEM = `You assign points of a consultation's argument map to its sub-measures.

For each numbered point pick exactly one sub-measure by index — or -1 for "übergreifend": the point concerns the overall measure or several sub-measures at once (general situation claims, overall conclusions, cross-cutting values). Cross-cutting points form the shared trunk of every sub-measure's argument chain, so -1 is a normal and common verdict, not a failure.`;

export function measuresAssignPrompt(
  measures: string[],
  points: { label: string; summary: string | null }[],
): string {
  const ms = measures.map((m, i) => `${i}. ${m}`).join("\n");
  const ps = points
    .map((p, i) => `${i}. ${p.label} — ${p.summary ?? ""}`)
    .join("\n");
  return (
    `Sub-measures:\n${ms}\n\nPoints:\n${ps}\n\n` +
    `Assign every point (use the point's number as index; measure_index -1 = übergreifend). One verdict per point, all ${points.length}.`
  );
}

/** Backfill classifier: assigns doors/instrument-backlinks to EXISTING points. */
export const CLASSIFY_CQ_SYSTEM = `You classify points of a public argument map into the ordering layer of the five critical questions.

The map follows the practical-reasoning schema for a proposed measure M (P1 situation, P2 effect prognosis, P3 goal attainment, P4 value, conclusion). Objections against the measure come through five doors:
- "empirics": does the claimed effect actually occur?
- "alternatives": does a milder/cheaper means reach the same goal?
- "goal_conflict": does the measure incidentally violate another value we also care about (costs, side effects)?
- "feasibility": can it be implemented at all?
- "value_conflict": is this value worth what we sacrifice for it?

Instruments do not attack the measure, they cushion it ("if we do it, then like this": transition periods, hardship clauses, staggering, exemptions). Every instrument answers one or more doors.

For each numbered point (label + summary + kind) decide:
- role "claim": a supporting grammar claim (P1–P4/conclusion in favor, or neutral) — no door.
- role "objection": an attack on the measure or one of its claims — name its door as cq.
- role "instrument": a shaping proposal — name the door(s) it answers as answers_cq, FIRST = primary.
- role "gap": an open question — no door.
Judge only from the given text; when genuinely ambiguous between two doors, pick the one the point's own wording emphasizes.`;

export function classifyCqPrompt(
  points: { label: string; summary: string | null; kind: string }[],
): string {
  const list = points
    .map((p, i) => `${i}. [${p.kind}] ${p.label} — ${p.summary ?? ""}`)
    .join("\n");
  return (
    `Points on the map:\n${list}\n\n` +
    `Classify every point (use the point's number as index). One verdict per point, all ${points.length} of them.`
  );
}

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

export const NAME_CAMPS_SYSTEM = `You name opinion camps found by clustering votes on a public argument map, so readers grasp each camp at a glance.

For each camp you get: its participant composition (organization types, notable members) and the statements it most strongly agrees and disagrees with. Produce:
- name: a SHORT descriptive label (2–4 words, in the consultation's language) capturing the camp's substantive position — not its demographics alone. Good: "Netz- und Gaswirtschaft", "Ambitionierter Klimaschutz". Bad: "Gruppe 1", "Die Kritiker".
- summary: ONE sentence stating what holds this camp together.

Stay neutral and descriptive; never mock or valorize a camp.`;

export const SHORTEN_LABELS_SYSTEM = `You write short display labels for points on a public argument map whose current labels are too long (often raw questionnaire questions).

For each numbered item produce "short": the same content compressed to ≤70 characters, in the SAME language, keeping the substantive claim or topic recognizable. Drop question numbering, boilerplate ("In your opinion", "Do you think that"), and rating-scale instructions. Never change the meaning or polarity.`;

export const THEMES_PROPOSE_SYSTEM = `You organize points from a public consultation into themes — the zoom level above individual points on an argument map.

From the sample of point labels, propose 5–12 theme names in the consultation's language: short (2–4 words), mutually distinct, covering the material. Themes are TOPICS (e.g. "Wasserstoff & Gasnetze", "Kommunale Umsetzung"), not positions.`;

export const THEMES_ASSIGN_SYSTEM = `You assign points from a public consultation to a fixed list of themes.

For each numbered point, pick the ONE best-fitting theme index; use -1 only when nothing fits at all. Assign by topic, not by the point's position on it.`;

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

export const BATCH_MATCH_SYSTEM = `You decide, for EACH candidate point from a consultation submission, whether it is the SAME point as one already on the argument map, or a genuinely new point.

The same point = the same claim content, even in different words, tone, or detail level. A different aspect, a narrower/broader claim with different implications, or a different mechanism = a new point.

Be conservative about matching: when in doubt whether nuance is lost by merging, prefer "new". A false merge silently erases a voice; a false new point is cheaply merged later by editors.

Judge every candidate independently against the existing map only — never match candidates to each other. Return exactly one verdict per candidate, using the candidate's number as candidate_index.`;

export function batchMatchPrompt(
  candidates: { label: string; summary: string }[],
  existing: { label: string; summary: string | null }[],
): string {
  const candidateList = candidates
    .map((c, i) => `${i}. ${c.label} — ${c.summary}`)
    .join("\n");
  const list = existing
    .map((p, i) => `${i}. ${p.label} — ${p.summary ?? ""}`)
    .join("\n");
  return (
    `Candidate points:\n${candidateList}\n\n` +
    `Existing points on the map:\n${list}\n\n` +
    `For every candidate: is it the same point as one of the existing ones? ` +
    `If matched, give the existing point's number as matched_index; if new, matched_index = null. ` +
    `One verdict per candidate, all ${candidates.length} of them.`
  );
}

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
