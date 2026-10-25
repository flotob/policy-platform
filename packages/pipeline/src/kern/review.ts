/**
 * The machine's recommendation for a proposed node: release, reject or
 * "look at this". In mode "mensch" the editors see the failed criteria as
 * hints, in "assistiert" the verdict is their one-click default, in "ki" it
 * is applied — except for personal data and anything unclear, which always
 * goes to a person.
 *
 * Own questions rather than the federal review-point.v2 set: on the first
 * Musterstadt run that set called the town's grid "off topic" and saw reason
 * clauses in plain sentences. Each question is asked in the positive
 * (Jev misreads negated questions) and every answer is named in its criterion.
 */

import { noul, type JevJudge, type JudgeProvenance } from "@policy/llm";

export const KERN_REVIEW_FAMILY = "kern-review.v2";

export type ReviewVerdict = "release" | "reject" | "review";

export interface NodeReview {
  verdict: ReviewVerdict;
  /** Criteria that failed or are uncertain — what the editors should look at. */
  flags: string[];
  /** P(yes) per question. */
  p: Record<string, number>;
}

export function nodeReviewQuestions() {
  return {
    several_claims: noul("Does `point` combine two or more separate claims that a citizen could agree or disagree with independently?", {
      true: "Several claims, e.g. 'the costs are too high and the deadline is too short'.",
      false: "One claim, possibly with numbers, a condition or detail that belong to it.",
    }),
    standalone: noul("Can a citizen understand `point` on its own, without the statement it was taken from?", {
      true: "Clear on its own: it names what it is about.",
      false: "Needs the source to be understood ('this', 'the above', an unexplained abbreviation).",
    }),
    loaded: noul("Is `point` phrased with loaded or polemical words rather than plain wording?", {
      true: "Polemical or loaded: insults, 'Diktatur', 'Abzocke', 'Wahnsinn', vivid exaggeration.",
      false: "Plain wording. A strong claim in plain words is plain.",
    }),
    relevant: noul(
      "Does `point` bear on the measure described in `procedure` — its premises, effects, implementation, costs, side effects, alternatives, or whether it is right?",
      {
        true: "It bears on the measure in one of these ways, including facts about the town's grid, buildings, trades, budget or residents.",
        false: "It concerns something else: another project, the participation procedure itself, a person, or politics without a link to the measure.",
      },
    ),
    meta: noul("Is `point` only a greeting, thanks, or a remark about the participation procedure, with no claim about the measure?", {
      true: "Only meta-commentary.",
      false: "A claim about the measure.",
    }),
    personal: noul("Does `point` name or describe a private individual, or attack a person?", {
      true: "Personal data about a private person, or a personal attack.",
      false: "No private person is identifiable or attacked; organisations and public offices are fine.",
    }),
    reason_clause: noul(
      "Does `point` attach a reason to its claim in a subordinate clause ('…, weil …', '…, da …', '…, sodass …', '…, um … zu …', '…, denn …')?",
      {
        true: "Claim plus a reason clause a voter might reject separately.",
        false: "The claim alone; numbers, conditions ('wenn …') and comparisons ('bevor …', 'als …') belong to the claim.",
      },
    ),
  };
}

/** The release policy, in code: when in doubt a person decides; rejection needs a clear failure. */
export function decideNodeReview(a: Record<string, { noul: number }>): Omit<NodeReview, "p"> {
  const P = (k: string) => a[k]!.noul;
  const flags: string[] = [];
  if (P("personal") >= 0.3) flags.push("personal_data");
  if (P("meta") >= 0.5) flags.push("meta");
  if (P("relevant") < 0.5) flags.push("off_topic");
  if (P("standalone") < 0.5) flags.push("not_standalone");
  if (P("several_claims") >= 0.5) flags.push("several_claims");
  if (P("loaded") >= 0.5) flags.push("not_neutral");
  if (P("reason_clause") >= 0.5) flags.push("reason_clause");
  if (flags.includes("personal_data")) return { verdict: "review", flags };
  if (P("meta") >= 0.8 || P("relevant") < 0.2 || P("standalone") < 0.15) return { verdict: "reject", flags };
  return { verdict: flags.length ? "review" : "release", flags };
}

export async function reviewNode(
  judge: JevJudge,
  context: { town: string; measure: string },
  node: { text: string; quotes: string[] },
): Promise<{ review: NodeReview; answers: Record<string, unknown>; provenance: JudgeProvenance }> {
  const state = {
    procedure: `Beteiligungsverfahren der Gemeinde ${context.town} zur Maßnahme: „${context.measure}“. Bürgerinnen und Bürger stimmen über einzelne Aussagen ab.`,
    point: node.text,
    sources: node.quotes.slice(0, 3),
  };
  const { answers, provenance } = await judge.judge(state, nodeReviewQuestions());
  const a = answers as Record<string, { noul: number }>;
  const p = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v.noul * 1000) / 1000]));
  return { review: { ...decideNodeReview(a), p }, answers, provenance };
}
