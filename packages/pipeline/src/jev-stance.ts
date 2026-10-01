/**
 * Stance inference as calibrated choices (exp/jev step 4).
 *
 * In the test corpora almost every vote is inferred from free text (WPG:
 * 1,068 of 1,069), so camps, bridges, and every diagnosis rest on this step.
 * The LLM version judged 30 statements per call keyed by array index, merged
 * text windows with a binary rule (agree ∧ disagree → pass) and gave every
 * inferred vote the same weight. Here each statement is its own question
 * (the claim travels in the question, the state is only the text window),
 * windows merge on probabilities, weak evidence abstains, and the vote keeps
 * its calibrated strength (votes.confidence).
 */

import { choice } from "@policy/llm";

export const STANCE_FAMILY = "stance.v2";

/** Below this probability of "addressed" in the best window: no vote. */
export const ABSTAIN_BELOW = 0.5;
/** Both stances at least this strong (in any windows) = genuine contradiction → no vote. */
export const CONTRADICTION_AT = 0.8;
/** Questions per request (claim text rides in each question). */
export const STANCE_BATCH = 60;

const CRITERIA = {
  agrees:
    "The text holds the claim to be true or demands what the claim demands — also when the claim itself is a criticism or a negation (a text that says 'the draft ignores X' agrees with the claim 'the draft ignores X').",
  disagrees:
    "The text holds the claim to be false or rejects what the claim demands. Criticising the draft law is not the same as disagreeing with the claim — judge the text's position on the claim itself.",
  not_addressed: "The text does not address this claim, or its position on it is unclear.",
} as const;

export function stanceQuestion(claim: string) {
  return choice(
    {
      task: "What is the stance of the consultation submission excerpt in `submission` toward the claim? Judge only from the text, not from the author's presumed interests; text and claim may be in different languages — judge the meaning.",
      claim,
    },
    CRITERIA,
  );
}

export type StanceProbs = { agrees: number; disagrees: number; not_addressed: number };

export interface StanceDecision {
  /** 1 = agree, -1 = disagree, null = no vote (abstain or contradiction). */
  value: 1 | -1 | null;
  reason: "stance" | "not_addressed" | "contradiction";
  /** P of the decided stance in the deciding window. */
  confidence: number;
  bestWindow: number;
  addressed: number;
}

export function decideStance(windows: StanceProbs[]): StanceDecision {
  let bestWindow = 0;
  let addressed = -1;
  let maxAgree = 0;
  let maxDisagree = 0;
  let agreeWindow = 0;
  let disagreeWindow = 0;
  windows.forEach((w, i) => {
    const a = 1 - w.not_addressed;
    if (a > addressed) {
      addressed = a;
      bestWindow = i;
    }
    if (w.agrees > maxAgree) {
      maxAgree = w.agrees;
      agreeWindow = i;
    }
    if (w.disagrees > maxDisagree) {
      maxDisagree = w.disagrees;
      disagreeWindow = i;
    }
  });
  if (Math.max(maxAgree, maxDisagree) < ABSTAIN_BELOW) {
    return { value: null, reason: "not_addressed", confidence: 1 - addressed, bestWindow, addressed };
  }
  if (Math.min(maxAgree, maxDisagree) >= CONTRADICTION_AT) {
    return { value: null, reason: "contradiction", confidence: 0, bestWindow, addressed };
  }
  const value: 1 | -1 = maxAgree >= maxDisagree ? 1 : -1;
  return {
    value,
    reason: "stance",
    confidence: value === 1 ? maxAgree : maxDisagree,
    bestWindow: value === 1 ? agreeWindow : disagreeWindow,
    addressed,
  };
}
