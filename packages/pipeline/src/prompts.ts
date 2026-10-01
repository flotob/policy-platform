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

/**
 * Extraction (exp/jev two-phase decomposition): the LLM writes the points of
 * ONE text window; it no longer labels them — kind, slot, door, and release
 * are Jev judgments at canonicalization, relations a Jev stage across
 * submissions. The grammar stays in the prompt because it defines what
 * counts as a point.
 */
export function extractSystem(withQuote: boolean): string {
  return `You extract the distinct argumentative points from a consultation submission, for a public argument map.

What counts as a point — in the debate about a proposed measure, contributions are:
- claims about the present situation, about what the measure will cause, about whether that effect serves a goal, and about whether the goal is worth its price;
- support for or rejection of the measure or one of its provisions;
- objections: the claimed effect will not occur; a milder or cheaper means would reach the goal; the measure harms another goal (costs, side effects); it cannot be implemented as proposed; the value is not worth what it sacrifices;
- shaping proposals ("if we do it, then like this"): transition periods, hardship clauses, exemptions, staggering, concrete changes to a provision;
- open questions the submission raises that nobody answers (missing evidence, an unexamined alternative).

Long submissions are shown IN FULL for context with one section marked between ⟦SECTION START⟧ and ⟦SECTION END⟧. Extract only the points made in the marked section — use the rest to understand what the section refers to. An argument that begins inside the section belongs to it even if it runs past the end marker; one that began before the start marker belongs to the previous section — skip it. Without markers, the whole text is yours.

Rules:
1. Extract every DISTINCT point; merge repetitions.
2. One point = one claim. Premises are points of their own: a factual claim that supports a demand or a judgment — figures, the current state, an observed development, an expected effect — is extracted SEPARATELY from the demand or judgment it supports (e.g. "the building sector has repeatedly missed its climate targets" and "emissions must fall immediately" are two points). Keep facts and value judgments apart: a point is either something evidence could settle or a judgment no study can settle, not both.
3. Extract factual premises and open questions even when the submission uses them only as support or in passing — they are points on the map.
4. Strip rhetoric and tone; keep the argumentative core, neutrally phrased. A point must be understandable on its own: name what it refers to (the provision, the instrument, the actor) instead of "this" or "the regulation".
5. label: a short editorial label (at most 80 characters). summary: one neutral sentence stating the claim. Write both in the language of the submission.
${withQuote ? '6. quote: a short VERBATIM excerpt from the text (copy exactly, no ellipses) that best evidences the point. The text comes from PDFs: repair broken word spacing and line-break hyphens while copying ("Ein e Quo- te" → "Eine Quote"), change nothing else.\n7.' : "6."} Skip greetings, thanks, self-descriptions of the submitting organisation, and procedural remarks without a substantive claim.
${withQuote ? "8." : "7."} A dense section often holds 15–25 points; never pad. An empty list is fine for a section without substantive content.`;
}

/** The automatic editor: repairs points Jev flagged (exp/jev refine). */
export const EDITOR_SYSTEM = `You are the editor of a public argument map. An automatic check flagged a point that was extracted from a consultation submission. Repair it so it can stand on the map, using the submission passage for context.

What the flags mean and how to repair:
- several_claims: the point combines claims a reader could accept or reject independently → split: one point per claim.
- mixed_fact_value: a checkable fact and a value judgment are mixed → split into the factual claim and the judgment.
- not_standalone: the point cannot be understood without the submission → rewrite it naming what it refers to (provision, instrument, actor).
- not_neutral: polemic or loaded wording → rewrite it neutrally, keeping the claim and its direction.
- personal_data: personal data about a private individual or an attack on a person → rewrite without it, or drop if nothing substantive remains.
- meta / off_topic: possibly greetings, procedure, or another subject → drop if there is no substantive claim about the consultation's subject; otherwise keep or rewrite.

Actions: "keep" (false alarm; points empty), "rewrite" (exactly one point), "split" (two to four points), "drop" (points empty).
Each point: label (at most 80 characters), summary (one neutral sentence), quote (a short VERBATIM excerpt from the passage that evidences this point; repair broken PDF word spacing and line-break hyphens while copying, change nothing else). Write in the language of the submission. Never add a claim the passage does not make; never soften or sharpen its direction.`;

export function editorPrompt(input: {
  consultation: string;
  flags: string[];
  point: { label: string; summary: string; quote?: string };
  passage: string;
}): string {
  return (
    `Consultation: ${input.consultation}\nFlags: ${input.flags.join(", ")}\n\n` +
    `Point:\n  label: ${input.point.label}\n  summary: ${input.point.summary}\n` +
    (input.point.quote ? `  quote: ${input.point.quote}\n` : "") +
    `\nSubmission passage:\n---\n${input.passage}\n---\n\nRepair the point.`
  );
}

/** Measures from the bill (exp/jev): the deciding structure comes from the draft law itself. */
export const BILL_MEASURES_SYSTEM = `You read a draft law and name its separately decidable MEASURES — the units a parliament or council could adopt, change, or reject on their own. Each measure gets its own argument map, so the cut must follow what is decided, not how the law is ordered.

Per measure:
- name: short German name (e.g. "Pflicht zur Wärmeplanung", "Quoten für Wärmenetze").
- description: one or two German sentences — what exactly is decided (who must do what, by when, with which exceptions).
- paragraphs: the section numbers (§) of the main law that make up the measure.
- other: provisions outside the main law that belong to it (e.g. "Artikel 2: Änderung des BauGB"), else empty.

Cover the substantive provisions. Definitions, goals, transitional and final provisions are no measure of their own: list their sections under the measure whose obligations they shape (e.g. the definition of unavoidable waste heat belongs to the measures that set renewable shares for heat networks; a section may appear under several measures). Name 4 to 10 measures. Do not create a measure for the law as a whole — that bucket exists already.`;

/** Above this many characters, the context around a marked section is clipped. */
export const EXTRACT_CONTEXT_MAX = 300_000;

export function extractPrompt(text: string, window: { index: number; count: number; start: number; end: number }): string {
  if (window.count === 1) {
    return `Submission:\n\n---\n${text}\n---\n\nExtract the distinct points per the rules.`;
  }
  const half = Math.floor((EXTRACT_CONTEXT_MAX - (window.end - window.start)) / 2);
  const from = Math.max(0, window.start - Math.max(0, half));
  const to = Math.min(text.length, window.end + Math.max(0, half));
  const marked =
    (from > 0 ? "[…]\n" : "") +
    text.slice(from, window.start) +
    "⟦SECTION START⟧" +
    text.slice(window.start, window.end) +
    "⟦SECTION END⟧" +
    text.slice(window.end, to) +
    (to < text.length ? "\n[…]" : "");
  return (
    `Submission (shown in full for context; section ${window.index + 1} of ${window.count} is marked):\n\n---\n${marked}\n---\n\n` +
    `Extract the distinct points made in the marked section per the rules.`
  );
}

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
3. Votable: a reader must be able to clearly agree or disagree with the sentence AS A WHOLE. No double claims (split points were already handled upstream), no questions, no "and/or" chains — and no justification clause ("…, because …", "…, um …", "…, da …", "…, sodass …"): a voter may share the claim but reject the reason, which makes the vote ambiguous. State the claim; the reason stays in the point's summary.
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

/** Condensation: extraction-grain points → canonical Landkarten-Punkte
 *  (map grain, the unit of the concept paper's prototype). */
export const CONDENSE_SYSTEM = `You condense the extraction-grain points of one measure of a public consultation into canonical MAP POINTS (Landkarten-Punkte).

A map point is ONE argument a reader can hold in mind and a citizen can vote on: a single, neutral, declarative German sentence. The extraction points underneath are formulations, details, and repetitions of these few real arguments — the map grows by insight, not by paper. Merge aggressively: every variant, sub-aspect, and restatement of the same argument belongs to the same map point. Target 10–20 map points; never exceed 25. Fewer, sharper points beat many small ones.

Per map point:
- "text": the canonical claim, German, one sentence, votable (someone can agree or disagree), neutral phrasing, no rhetoric.
- "label": a short German chip label for the map, <= 45 characters.
- "typ": "T" if evidence could settle it (facts, prognoses, costs, legal effect), "W" if it is a pure value judgment no study can decide, "verfahren" if it is a design/implementation instrument ("if we do it, then like this": transition periods, hardship clauses, exemptions, staggering, procedural safeguards).
- "bezirk": the district on the map — "wirkung" (does the measure work; effect prognosis and goal attainment), "machbarkeit" (can it be implemented), "kosten" (costs and side effects on other goals), "alternativen" (would another means do), "wert" (the value question itself — political, for the council), "ausgestaltung" (design instruments; always for typ "verfahren").
- "members": the indices of ALL input points this map point condenses. Each input index may appear under at most one map point. Cover as many input points as you honestly can; leave an index unassigned only if it genuinely is noise or off-topic.

Consistency: typ "W" belongs in bezirk "wert"; typ "verfahren" belongs in "ausgestaltung"; typ "T" belongs in one of wirkung/machbarkeit/kosten/alternativen.`;

export function condensePrompt(
  points: {
    label: string;
    summary: string | null;
    kind: string;
    cq: string | null;
  }[],
  scope: string,
): string {
  const list = points
    .map(
      (p, i) =>
        `${i}. [${p.kind}${p.cq ? "/" + p.cq : ""}] ${p.label}${p.summary ? " — " + p.summary : ""}`,
    )
    .join("\n");
  return (
    `Measure under decision: ${scope}\n\nExtraction points (index. [kind/door] label — summary):\n${list}\n\n` +
    `Condense these ${points.length} extraction points into canonical map points.`
  );
}

/**
 * Condensation proposal (exp/jev): the LLM writes the canonical Landkarten-
 * Punkte of one measure; Jev assigns every extraction point afterwards
 * (no index lists in the LLM output).
 */
export const CONDENSE_PROPOSE_SYSTEM = `You condense the extraction-grain points of one measure of a public consultation into canonical MAP POINTS (Landkarten-Punkte).

A map point is ONE argument a reader can hold in mind and a citizen can vote on: a single, neutral, declarative German sentence. The extraction points underneath are formulations, details, sub-aspects, and repetitions of these few real arguments — the map grows by insight, not by paper. Merge aggressively: every variant, sub-aspect, example, and restatement of the same argument belongs to the same map point. Aim for roughly one map point per three extraction points (a list of 30 → about 10); never more than 25. Fewer, sharper points beat many small ones.

A map point is voted on as a whole: it states ONE claim at the level of the argument — no justification or purpose clause ("…, weil …", "…, da …", "…, um … zu …"), no "X und Y" of two separable claims. Keep facts and value judgments in separate map points.

Per map point:
- "text": the canonical claim, German, one sentence, votable (someone can agree or disagree), neutral phrasing, no rhetoric.
- "label": a short German chip label for the map, <= 45 characters.
- "typ": "T" if evidence could settle it (facts, prognoses, costs, legal effect), "W" if it is a pure value judgment no study can decide, "verfahren" if it is a design/implementation instrument ("if we do it, then like this": transition periods, hardship clauses, exemptions, staggering, procedural safeguards).
- "bezirk": the district on the map — "wirkung" (does the measure work; effect prognosis and goal attainment), "machbarkeit" (can it be implemented), "kosten" (costs and side effects on other goals), "alternativen" (would another means do), "wert" (the value question itself), "ausgestaltung" (design instruments; always for typ "verfahren").

Cover every substantive argument, usually by a map point that bundles it with related extraction points — another step assigns each extraction point to the map point it belongs to.`;

export function condenseTopUpPrompt(
  scope: string,
  existing: { label: string; text: string }[],
  uncovered: { label: string; summary: string | null; kind: string; cq: string | null }[],
): string {
  return (
    `Measure under decision: ${scope}\n\nMap points that already exist:\n` +
    existing.map((m) => `- ${m.text}`).join("\n") +
    `\n\nThese extraction points fit none of them:\n` +
    uncovered.map((p) => `- [${p.kind}${p.cq ? "/" + p.cq : ""}] ${p.label}${p.summary ? " — " + p.summary : ""}`).join("\n") +
    `\n\nPropose ADDITIONAL map points for the real arguments among these (none for noise or for points an existing map point already covers).`
  );
}

export const CONDENSE_ASSIGN_SYSTEM = `You assign leftover extraction points of a consultation measure to its existing canonical map points.

For each numbered extraction point pick the map point (by index) whose canonical claim it expresses, supports, details, or restates — or -1 if it genuinely fits none (off-topic or noise). Prefer assignment over -1: the map should account for the material.`;

export function condenseAssignPrompt(
  mapPoints: { label: string; text: string }[],
  points: { label: string; summary: string | null }[],
): string {
  const ms = mapPoints.map((m, i) => `${i}. ${m.label} — ${m.text}`).join("\n");
  const ps = points
    .map((p, i) => `${i}. ${p.label}${p.summary ? " — " + p.summary : ""}`)
    .join("\n");
  return (
    `Map points:\n${ms}\n\nExtraction points:\n${ps}\n\n` +
    `Assign every extraction point (map_index; -1 = fits none). One verdict per point, all ${points.length}.`
  );
}

/** Befund: the machine computes the verdict, the model only phrases it. */
export const BEFUND_SYSTEM = `You write the BEFUND (finding) for one canonical point of a Landkarte des Streits — the annex of a consultation report read by the deciding body and the public.

The verdict was computed deterministically and is BINDING. You verbalize it; you must not change, soften, invert, or second-guess it. The diagnosis vocabulary:
- "bruecke" (Brücke der Gründe): both camps carry the claim (>= 60 % each). Say what that makes possible.
- "klaerbar" (klärbar durch Gutachten): a fact question divides the camps — evidence could settle it. Name what kind of evidence (Kurzgutachten, Messdaten, juristische Kurzstellungnahme) and recommend clearing it before the council decides.
- "wert" (Wertdifferenz): a value judgment divides the camps. No study can settle it; it belongs to the council as an explicit value decision.
- "kern" (Kernkonflikt): THE central value conflict of this measure — the largest camp gap on a value point. Make its weight clear.
- "warnung" (Scheinbrücke / Brücke der Ergebnisse): both camps agree, but for diverging reasons. Warn that a decision leaning on this number alone will crack at the first design question.
- "offen": no sufficient vote data or mid-range profiles — the point is neither carried nor settled; say what would firm it up.
- "luecke": an unanswered critical question — nobody in the consultation addressed it. Recommend actively closing it before the decision.

Write 2–5 German sentences, plain language a first-time reader understands, confident report tone, no hedging about the computed numbers, no jargon, no meta-talk about AI. When counts of organisations are given, prefer them to percentages — the votes are inferred from a small number of written statements, and "3 von 4" says honestly what "75 %" overstates. Refer to the deciding body neutrally as "die Entscheidungsebene" or "der Gesetzgeber" for federal/EU material — never invent a concrete body (Stadtrat, Gemeinderat) the material does not name. Ground the text in the material you are given (member points, quotes); mention concrete actors or mechanisms where the material carries them. Do not invent numbers beyond the given percentages.`;

/** Raw vote counts per camp (direct votes on Landkarten-Punkte). */
export interface VoteCounts {
  a: { agree: number; disagree: number; size: number };
  b: { agree: number; disagree: number; size: number };
}

export function befundPrompt(input: {
  scope: string;
  text: string;
  typ: string;
  diag: string;
  pa: number | null;
  pb: number | null;
  campA: string;
  campB: string;
  votes?: VoteCounts;
  memberLabels: string[];
  quotes: { quelle: string; text: string }[];
  reasonsRationale?: string;
}): string {
  const count = (c: { agree: number; disagree: number; size: number }) =>
    `${c.agree} von ${c.agree + c.disagree} Organisationen, die sich dazu äußern, stimmen zu; das Lager hat ${c.size}`;
  const profile =
    input.pa !== null && input.pb !== null
      ? input.votes
        ? `${input.campA}: ${input.pa} % Zustimmung (${count(input.votes.a)}) · ${input.campB}: ${input.pb} % Zustimmung (${count(input.votes.b)})`
        : `${input.campA}: ${input.pa} % Zustimmung · ${input.campB}: ${input.pb} % Zustimmung`
      : input.votes
        ? `keine belastbaren Abstimmungsdaten (${input.campA}: ${count(input.votes.a)} · ${input.campB}: ${count(input.votes.b)})`
        : "keine belastbaren Abstimmungsdaten";
  const quotes = input.quotes
    .map((q) => `- ${q.quelle}: "${q.text}"`)
    .join("\n");
  return (
    `Measure: ${input.scope}\nCanonical claim: ${input.text}\nTyp: ${input.typ}\n` +
    `Computed diagnosis (binding): ${input.diag}\nCamp profile: ${profile}\n` +
    (input.reasonsRationale
      ? `Reasons check (machine-flagged, editorial review pending): ${input.reasonsRationale}\n`
      : "") +
    `Underlying extraction points:\n${input.memberLabels.map((l) => `- ${l}`).join("\n")}\n` +
    (quotes ? `Original quotes:\n${quotes}\n` : "") +
    `\nWrite the Befund.`
  );
}

/** Scheinbrücken check: do both camps back a bridge for the same reasons? */
export const REASONS_CHECK_SYSTEM = `You check ONE bridge point of a consultation map for the Scheinbrücke pattern (Brücke der Ergebnisse): both camps agree with the claim — but for diverging, ultimately incompatible reasons (e.g. both want transition periods: one side so the obligation arrives cleanly, the other so it never arrives).

From the underlying material (member points, quotes), judge:
- "same_reasons": the visible reasons point in the same direction; the bridge carries.
- "diverging_reasons": the material shows clearly conflicting purposes behind the agreement.
- "unclear": the material does not show the reasons; no verdict possible.

Be conservative: "diverging_reasons" only when the material actually shows it. Give a one-sentence German rationale.`;

export function reasonsCheckPrompt(input: {
  text: string;
  memberLabels: string[];
  quotes: { quelle: string; text: string }[];
}): string {
  const quotes = input.quotes
    .map((q) => `- ${q.quelle}: "${q.text}"`)
    .join("\n");
  return (
    `Bridge claim: ${input.text}\n` +
    `Underlying extraction points:\n${input.memberLabels.map((l) => `- ${l}`).join("\n")}\n` +
    (quotes ? `Original quotes:\n${quotes}\n` : "") +
    `\nJudge the reasons.`
  );
}
