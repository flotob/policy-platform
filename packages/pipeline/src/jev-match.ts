/**
 * "Known point or new?" as a System One judgment (Jev, TypeSafe).
 *
 * Code builds a lexical shortlist of existing map points; Jev answers one
 * graded question per (candidate, shortlisted point) pair plus one choice over
 * the whole shortlist. The merge policy lives here, in code — "when in doubt,
 * new" is a threshold on the calibrated P(same argument) of the best pair,
 * not a prompt sentence:
 *
 *   P(same) >= MERGE_AT              → matched (more likely same than not)
 *   REVIEW_FROM <= P(same) < MERGE_AT → new, flagged as possible duplicate
 *   P(same) < REVIEW_FROM            → new
 *
 * Thresholds from the WPG replay (2026-10-01, 694 decisions vs the recorded
 * LLM baseline): P(same) separates cleanly — <0.2: 474 new / 11 merged;
 * >=0.5: 119 merged / 9 new; the 0.2–0.5 band (~13 %) is the real grey zone
 * and goes to the editors instead of being decided by either model.
 *
 * The levels restate the established MATCH_SYSTEM definition of "the same
 * point", so Jev and the LLM path judge the same thing.
 */

import { choice, score, type JevJudge, type JudgeProvenance } from "@policy/llm";

export const MERGE_AT = 0.5;
export const REVIEW_FROM = 0.2;
export const DEFAULT_SHORTLIST = 15;

export interface MatchablePoint {
  id: string;
  label: string;
  summary: string | null;
}

// ——— Lexical shortlist (deterministic, no model) ———————————————————————————

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Word-padded character trigrams: robust to German compounds and inflection. */
export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalize(text).split(" ")) {
    if (!word) continue;
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

const trigramCache = new Map<string, Set<string>>();

function pointTrigrams(p: MatchablePoint): Set<string> {
  const key = `${p.id}\u0000${p.label}\u0000${p.summary ?? ""}`;
  let t = trigramCache.get(key);
  if (!t) {
    t = trigrams(`${p.label} ${p.summary ?? ""}`);
    trigramCache.set(key, t);
  }
  return t;
}

export function shortlist<P extends MatchablePoint>(
  candidate: { label: string; summary: string | null },
  existing: P[],
  k = DEFAULT_SHORTLIST,
): P[] {
  const ct = trigrams(`${candidate.label} ${candidate.summary ?? ""}`);
  return existing
    .map((p) => ({ p, s: dice(ct, pointTrigrams(p)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.p);
}

// ——— The judgment ————————————————————————————————————————————————————————

const RELATION_LEVELS = [
  "Different arguments: the two points make different claims, even if they concern the same topic, measure, or actor.",
  "Related but not the same argument: same topic or a neighbouring claim, but a different aspect, a narrower or broader claim with different implications, a different mechanism, or the opposite position. Merging them would lose a nuance someone actually argued.",
  "The same argument: the same claim content in the same direction; the points differ only in wording, tone, or level of detail.",
] as const;

export type MatchBand = "merge" | "review" | "new";

export function matchBand(pSame: number): MatchBand {
  return pSame >= MERGE_AT ? "merge" : pSame >= REVIEW_FROM ? "review" : "new";
}

export interface JevMatchVerdict {
  outcome: "matched" | "new";
  matchedPointId: string | null;
  band: MatchBand;
  /** Expected relation score (0..2) of the best pair. */
  bestScore: number;
  /** Highest P(level "same argument") over the shortlist — the policy input. */
  bestSameProbability: number;
  /** The shortlist choice question's pick (point id or "none"), as a second signal. */
  choicePick: string;
  choiceConfidence: number;
  shortlistIds: string[];
  provenance: JudgeProvenance;
}

export async function jevMatch(
  judge: JevJudge,
  context: { consultationTitle: string },
  candidate: { label: string; summary: string | null },
  shortlisted: MatchablePoint[],
): Promise<JevMatchVerdict | null> {
  if (shortlisted.length === 0) return null;

  const keys = shortlisted.map((_, i) => `p${i + 1}`);
  const existing: Record<string, { label: string; summary: string | null }> = {};
  shortlisted.forEach((p, i) => {
    existing[keys[i]!] = { label: p.label, summary: p.summary };
  });

  const state = {
    context:
      `Argument map of the public consultation "${context.consultationTitle}". ` +
      "Each point is one argument extracted from written submissions; " +
      "repeats of an argument must fold into one point, distinct arguments must stay separate.",
    candidate: { label: candidate.label, summary: candidate.summary },
    existing,
  };

  const questions: Record<string, ReturnType<typeof score> | ReturnType<typeof choice>> = {};
  for (const key of keys) {
    questions[`rel_${key}`] = score(
      `How does the candidate argument \`candidate\` relate to the existing map point \`existing.${key}\`?`,
      RELATION_LEVELS,
    );
  }
  const pickCriteria: Record<string, string> = {};
  for (const key of keys) {
    pickCriteria[key] = `\`existing.${key}\` makes the same argument as \`candidate\` (same claim content in the same direction).`;
  }
  pickCriteria.none =
    "No existing point makes the same argument: the candidate is a new point, or only related to existing points.";
  questions.pick = choice(
    "Which existing map point, if any, makes the same argument as `candidate`?",
    pickCriteria,
  );

  const { answers, provenance } = await judge.judge(state, questions);

  let bestIdx = -1;
  let bestScore = -1;
  let bestSame = -1;
  keys.forEach((key, i) => {
    const a = answers[`rel_${key}`] as { score: number; probabilities: Record<string, number> };
    const pSame = a.probabilities["2"] ?? 0;
    if (pSame > bestSame) {
      bestSame = pSame;
      bestScore = a.score;
      bestIdx = i;
    }
  });
  const pick = answers.pick as { choice: string; confidence: number };

  const band = matchBand(bestSame);
  const matched = band === "merge";
  return {
    outcome: matched ? "matched" : "new",
    /** For "review", the most likely duplicate — what the editors compare against. */
    matchedPointId: band === "new" ? null : shortlisted[bestIdx]!.id,
    band,
    bestScore,
    bestSameProbability: bestSame,
    choicePick:
      pick.choice === "none" ? "none" : (shortlisted[keys.indexOf(pick.choice)]?.id ?? "none"),
    choiceConfidence: pick.confidence,
    shortlistIds: shortlisted.map((p) => p.id),
    provenance,
  };
}
