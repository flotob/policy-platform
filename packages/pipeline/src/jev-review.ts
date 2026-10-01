/**
 * Editorial review as criterion judgments (exp/jev step 5).
 *
 * The LLM editor folded six release criteria into one verdict plus a prose
 * reason. Here every criterion is its own Noul, so the editors see WHICH
 * criterion failed (data, not prose), and the release policy is code:
 * personal data is never auto-released, rejection needs a clear failure
 * ("when in doubt, release — a wrongly rejected point silences a voice"),
 * and everything uncertain goes to a person. Paper §8: the machine
 * proposes, a person releases — with attention only where it is needed.
 */

import { noul } from "@policy/llm";

export const REVIEW_POINT_FAMILY = "review-point.v2";
export const REVIEW_STATEMENT_FAMILY = "review-statement.v2";

export function pointReviewQuestions() {
  return {
    single_claim: noul("Does `point` make one coherent claim, rather than several separate claims combined?", {
      true: "One claim — possibly with its reason, mechanism, or detail, which belong to the same claim.",
      false: "Several separate claims someone could agree with independently (e.g. 'the deadline is too short and the funding should be doubled').",
    }),
    standalone: noul("Is `point` understandable on its own, without the submission it was extracted from?"),
    neutral: noul("Is `point` phrased neutrally — without polemics, insults, or loaded rhetoric?"),
    on_topic: noul("Is `point` about the subject of the consultation named in `consultation`?"),
    meta: noul(
      "Is `point` mere meta-commentary — greetings, thanks, or complaints about the procedure — without any substantive claim about the subject?",
    ),
    personal: noul("Does `point` contain personal data about a private individual, or attack a person?"),
  };
}

export function statementReviewQuestions() {
  return {
    declarative: noul(
      "Is `statement.de` one clear declarative sentence that a reader can agree or disagree with — not a question, not hedged into vagueness?",
    ),
    single_claim: noul(
      "Does `statement.de` contain exactly one claim a voter can agree or disagree with as a whole — no second claim and no justification ('…, because …') that a voter might reject separately?",
    ),
    polarity: noul(
      "Does `statement.de` keep the meaning and the direction of the claim in `point` — neither flipped nor softened?",
    ),
    same_meaning: noul("Do `statement.de` and `statement.en` say the same thing?"),
  };
}

export type ReviewVerdict = "release" | "reject" | "review";

export interface ReviewDecision {
  verdict: ReviewVerdict;
  /** Criteria that failed or are uncertain — what the editor should look at. */
  flags: string[];
}

const P = (a: Record<string, { noul: number }>, k: string) => a[k]!.noul;

export function decidePointReview(a: Record<string, { noul: number }>): ReviewDecision {
  const flags: string[] = [];
  if (P(a, "personal") >= 0.3) flags.push("personal_data");
  if (P(a, "meta") >= 0.5) flags.push("meta");
  if (P(a, "on_topic") < 0.5) flags.push("off_topic");
  if (P(a, "standalone") < 0.5) flags.push("not_standalone");
  if (P(a, "single_claim") < 0.5) flags.push("several_claims");
  if (P(a, "neutral") < 0.5) flags.push("not_neutral");

  if (flags.includes("personal_data")) return { verdict: "review", flags };
  const clearFailure =
    P(a, "meta") >= 0.8 || P(a, "on_topic") < 0.2 || P(a, "standalone") < 0.15;
  if (clearFailure) return { verdict: "reject", flags };
  return { verdict: flags.length === 0 ? "release" : "review", flags };
}

export function decideStatementReview(a: Record<string, { noul: number }>): ReviewDecision {
  const flags: string[] = [];
  if (P(a, "declarative") < 0.5) flags.push("not_declarative");
  if (P(a, "single_claim") < 0.5) flags.push("several_claims");
  if (P(a, "polarity") < 0.5) flags.push("polarity");
  if (P(a, "same_meaning") < 0.5) flags.push("languages_diverge");
  // A rejected statement is regenerated, so rejection is cheap — but a
  // flipped polarity or diverging translation must never reach the vote.
  const clearFailure =
    P(a, "polarity") < 0.3 || P(a, "same_meaning") < 0.3 || P(a, "declarative") < 0.3;
  if (clearFailure) return { verdict: "reject", flags };
  return { verdict: flags.length === 0 ? "release" : "review", flags };
}
