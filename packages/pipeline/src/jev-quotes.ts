/**
 * Quotes as selection, not generation (exp/jev step 6).
 *
 * The argument maps show "Originalzitate" — they must be verbatim and they
 * should be the best evidence, not the shortest string. Two judgments:
 *
 *  - SOURCE: when an extracted quote cannot be located even after
 *    normalization (a paraphrase), code shortlists sentences of the
 *    submission and Jev picks the passage the quote came from — the
 *    verbatim passage replaces the paraphrase.
 *  - EVIDENCE: for a canonical map point, Jev rates each candidate quote on
 *    one ordered scale (how directly it states the claim, and whether it
 *    stands on its own); code picks the best, one per organisation.
 */

import { choice, score } from "@policy/llm";

import { textSimilarity } from "./jev-match.ts";
import { sentences } from "./quote-span.ts";

export const SOURCE_FAMILY = "quote-source.v1";
export const EVIDENCE_FAMILY_QUOTES = "quote-evidence.v1";

/** Pick the passage only when Jev is this sure. */
export const SOURCE_MIN_CONFIDENCE = 0.6;
export const SOURCE_SHORTLIST = 10;

export function sourceCandidates(text: string, quote: string, k = SOURCE_SHORTLIST) {
  return sentences(text)
    .map((s) => ({ ...s, sim: textSimilarity(quote, s.text) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
}

export function sourceRequest(
  point: { label: string; summary: string | null },
  quote: string,
  candidates: { text: string }[],
) {
  const cands: Record<string, string> = {};
  const criteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    cands[`c${i + 1}`] = c.text;
    criteria[`c${i + 1}`] = `\`candidates.c${i + 1}\` is the passage the quote was taken or paraphrased from.`;
  });
  criteria.none = "None of the passages is the source of the quote.";
  return {
    state: { point, quote, candidates: cands },
    questions: {
      source: choice(
        "Which passage in `candidates` is the original source of the extracted quote in `quote` — the passage it was taken or paraphrased from?",
        criteria,
      ),
    },
  };
}

const EVIDENCE_LEVELS = [
  "Does not state or support the claim: another topic, or only loosely related.",
  "Related: touches the claim but does not clearly state or support it.",
  "States or clearly supports the claim, but is hard to understand without the surrounding text.",
  "States or clearly supports the claim and is understandable on its own as a quotation.",
] as const;

/** A quote is shown only from this level up (clearly supports the claim). */
export const EVIDENCE_MIN = 2;

export function evidenceRequest(claim: string, quotes: { text: string }[]) {
  const qs: Record<string, string> = {};
  const questions: Record<string, ReturnType<typeof score>> = {};
  quotes.forEach((q, i) => {
    qs[`q${i + 1}`] = q.text;
    questions[`q${i + 1}`] = score(
      `How well does \`quotes.q${i + 1}\` serve as an original quotation evidencing the claim in \`claim\`?`,
      EVIDENCE_LEVELS,
    );
  });
  return { state: { claim, quotes: qs }, questions };
}
