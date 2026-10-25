/**
 * Z4 — known or new? — and Z5 — routing.
 *
 * Code shortlists the campaign's nodes lexically; Jev judges every
 * (move, node) pair on the established three-level relation scale (the WPG
 * matcher's, replay-calibrated) plus one question the federal matcher did
 * not need: does the move claim the OPPOSITE of the node? In a vote, one
 * statement serves both sides — "Die Netze reichen" and "Die Netze reichen
 * nicht" are one node with agree and disagree, not two.
 *
 * Routing is a pure rule over those probabilities (Gesamtmodell Z5, I3):
 *   same claim, P ≥ matchThreshold, shortlist pick agrees  → auto
 *   same claim otherwise                                    → unsicher (editors)
 *   opposite claim                                          → gegenteil (editors)
 *   related claim (narrower, broader, another aspect)       → praezisierung (new node, editors)
 *   nothing close                                           → neu (new node, editors)
 * There is no automatic merge of nodes; a new node always waits for release.
 */

import { choice, noul, score, type JevJudge, type JudgeProvenance } from "@policy/llm";

import { MERGE_AT, RELATION_LEVELS, trigrams } from "../jev-match.ts";

export const KERN_MATCH_FAMILY = "kern-match.v1";
export const KERN_SHORTLIST = 8;
/** Nodes on the move's own step are compared first: same words are not needed for the same claim. */
export const KERN_SAME_STEP = 8;
/** An opposite claim counts from here on (more likely than not). */
const LIKELY = 0.5;
/**
 * "Related" only as a hint worth showing: in a one-measure procedure nearly
 * everything is related to something (first Musterstadt run: P 0.52–0.94 for
 * plainly different claims), so the bar is higher.
 */
const CLOSELY = 0.75;
/** How many of the compared nodes are kept for the editors. */
const CANDIDATES = 3;
const round = (p: number) => Math.round(p * 1000) / 1000;

export interface MatchNode {
  id: string;
  text: string;
  einwand: string | null;
  schritt: string | null;
}

export type MatchOutcome = "treffer" | "gegenteil" | "praezisierung" | "neu";
export type Route = "auto" | "unsicher" | "gegenteil" | "praezisierung" | "neu";

export interface MoveMatch {
  outcome: MatchOutcome;
  /** The node the move is attached or compared to; null for "neu". */
  node: string | null;
  pSame: number;
  pOpposite: number;
  pRelated: number;
  /** The shortlist choice (node id or "none") — a second opinion on "same". */
  pick: string;
  pickConfidence: number;
  shortlist: string[];
  /** The closest nodes the move was compared with — what the editors check before releasing a new point. */
  candidates: { node: string; pSame: number; pOpposite: number; pRelated: number }[];
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Which nodes Jev compares a move with: the closest ones on the move's own
 * step of the justification (where its claim lives — "kein Netzengpass" and
 * "Die Netze haben Reserven" share almost no words), plus the closest
 * wording anywhere (a move filed under the wrong step still finds its twin).
 */
export function shortlistNodes(move: { aussage: string; kern: string; schritt: string }, nodes: MatchNode[]): MatchNode[] {
  const mt = trigrams(`${move.aussage} ${move.kern}`);
  const scored = nodes
    .map((n) => ({ n, s: dice(mt, trigrams(`${n.text} ${n.einwand ?? ""}`)) }))
    .sort((a, b) => b.s - a.s);
  // The measure itself ("Musterstadt soll …") has no step; "Ich bin für die Pflicht" belongs to it.
  const root = scored.filter((x) => x.n.schritt === null);
  const sameStep = scored.filter((x) => x.n.schritt === move.schritt).slice(0, KERN_SAME_STEP);
  const anywhere = scored.slice(0, KERN_SHORTLIST);
  const seen = new Set<string>();
  return [...root, ...sameStep, ...anywhere].map((x) => x.n).filter((n) => !seen.has(n.id) && seen.add(n.id));
}

type Question = ReturnType<typeof score> | ReturnType<typeof choice> | ReturnType<typeof noul>;

/** The state and questions of one match judgment; `extra` questions ride along in the same request. */
export function matchRequest(
  context: { town: string; measure: string },
  candidate: { statement: string; claim: string },
  shortlisted: MatchNode[],
  extra: Record<string, Question> = {},
) {
  const keys = shortlisted.map((_, i) => `p${i + 1}`);
  const existing: Record<string, { statement: string; objection: string | null }> = {};
  shortlisted.forEach((n, i) => (existing[keys[i]!] = { statement: n.text, objection: n.einwand }));
  const state = {
    context:
      `Public participation procedure of ${context.town} on the measure: "${context.measure}". ` +
      "Each existing point is one statement citizens vote on (agree / disagree). Repeats of a claim must fold into one point; " +
      "distinct claims must stay separate.",
    candidate,
    existing,
  };
  const questions: Record<string, Question> = { ...extra };
  for (const key of keys) {
    questions[`rel_${key}`] = score(`How does the candidate claim \`candidate\` relate to the existing point \`existing.${key}\`?`, RELATION_LEVELS);
    questions[`opp_${key}`] = noul(
      `Does \`candidate\` assert the opposite of \`existing.${key}.statement\` on the same matter — so that someone who agrees with one must disagree with the other?`,
      {
        true: "Opposite answers to the same question (e.g. 'the grid can absorb the extra power' vs 'the grid cannot absorb it').",
        false: "Not opposite: the same direction, a different matter, or claims both could hold at once.",
      },
    );
  }
  if (keys.length) {
    const pickCriteria: Record<string, string> = {};
    for (const key of keys) pickCriteria[key] = `\`existing.${key}\` makes the same claim as \`candidate\` (same content, same direction).`;
    pickCriteria.none = "No existing point makes the same claim: the candidate is new, only related, or the opposite of an existing point.";
    questions.pick = choice("Which existing point, if any, makes the same claim as `candidate`?", pickCriteria);
  }
  return { state, questions, keys };
}

/** The policy over the answers: same claim, opposite claim, related, or new. */
export function decideMatch(answers: Record<string, unknown>, keys: string[], shortlisted: MatchNode[]): MoveMatch {
  const pairs = keys.map((key, i) => {
    const rel = answers[`rel_${key}`] as { probabilities: Record<string, number> };
    const opp = answers[`opp_${key}`] as { noul: number };
    return { node: shortlisted[i]!, pSame: rel.probabilities["2"] ?? 0, pRelated: rel.probabilities["1"] ?? 0, pOpposite: opp.noul };
  });
  const pick = answers.pick as { choice: string; confidence: number };
  const pickId = pick.choice === "none" ? "none" : (shortlisted[keys.indexOf(pick.choice)]?.id ?? "none");

  const bySame = [...pairs].sort((a, b) => b.pSame - a.pSame)[0]!;
  const byOpp = [...pairs].sort((a, b) => b.pOpposite - a.pOpposite)[0]!;
  const byRel = [...pairs].sort((a, b) => b.pRelated - a.pRelated)[0]!;

  let outcome: MatchOutcome;
  let best: (typeof pairs)[number] | null;
  if (bySame.pSame >= MERGE_AT) [outcome, best] = ["treffer", bySame];
  else if (byOpp.pOpposite >= LIKELY) [outcome, best] = ["gegenteil", byOpp];
  else if (byRel.pRelated >= CLOSELY) [outcome, best] = ["praezisierung", byRel];
  else [outcome, best] = ["neu", null];

  return {
    outcome,
    node: best?.node.id ?? null,
    pSame: bySame.pSame,
    pOpposite: best?.pOpposite ?? byOpp.pOpposite,
    pRelated: best?.pRelated ?? byRel.pRelated,
    pick: pickId,
    pickConfidence: pick.confidence,
    shortlist: shortlisted.map((n) => n.id),
    candidates: [...pairs]
      .sort((a, b) => b.pSame + b.pOpposite - (a.pSame + a.pOpposite) || b.pRelated - a.pRelated)
      .slice(0, CANDIDATES)
      .map((p) => ({ node: p.node.id, pSame: round(p.pSame), pOpposite: round(p.pOpposite), pRelated: round(p.pRelated) })),
  };
}

export async function matchMove(
  judge: JevJudge,
  context: { town: string; measure: string },
  move: { aussage: string; kern: string },
  shortlisted: MatchNode[],
): Promise<{ match: MoveMatch; answers: Record<string, unknown>; provenance: JudgeProvenance } | null> {
  if (shortlisted.length === 0) return null;
  const { state, questions, keys } = matchRequest(context, { statement: move.aussage, claim: move.kern }, shortlisted);
  const { answers, provenance } = await judge.judge(state, questions);
  return { match: decideMatch(answers, keys, shortlisted), answers, provenance };
}

/** Z5: the asymmetry rule — "im Zweifel neu" — as code over the judgment. */
export function route(match: MoveMatch | null, matchThreshold: number): Route {
  if (!match) return "neu";
  switch (match.outcome) {
    case "treffer":
      // A disagreeing second opinion is a doubt too (I3).
      return match.pSame >= matchThreshold && match.pick === match.node ? "auto" : "unsicher";
    case "gegenteil":
      return "gegenteil";
    case "praezisierung":
      return "praezisierung";
    case "neu":
      return "neu";
  }
}
