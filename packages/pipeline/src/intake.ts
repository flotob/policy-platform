/**
 * Intake judgment (exp/jev): everything intrinsic to a NEW point, decided
 * in ONE Jev request at the moment it enters the map — the editorial
 * release criteria, its role and door, and the argument grammar (fact or
 * value, P1–P4). These were three separate passes (jev-review, jev-classify,
 * jev-grammar); the questions are the same, validated ones — they share the
 * point as state and are answered in parallel, so one request costs one
 * round trip. Structure-dependent questions (measure, theme, map point)
 * follow once that structure exists (jev-classify).
 */

import { noul, type EntryType } from "@policy/llm";

import { roleQuestions } from "./jev-classify.ts";
import { decideGrammar, grammarQuestions, type Slot } from "./jev-grammar.ts";
import { decidePointReview, pointReviewQuestions, type ReviewVerdict } from "./jev-review.ts";

export const INTAKE_FAMILY = "intake.v2";

/**
 * Whether a point really MIXES a fact and a judgment is its own question —
 * a middle P(evidence) only means Jev is unsure which of the two it is
 * (TypeSafe: a Noul is the probability of the criterion, not a degree).
 */
const MIXED = noul(
  "Does `point` combine a checkable factual claim and a separate value judgment or demand that a reader could accept or reject independently of each other?",
  {
    true: "Two parts: one that evidence could settle (e.g. 'costs will rise by 20 percent') and a separate judgment or demand (e.g. 'this burden is unacceptable') — someone could accept one part and reject the other.",
    false: "One claim — either something evidence could settle or a judgment/demand; naming what it refers to does not make it two claims.",
  },
);

export function intakeRequest(consultation: string, point: { label: string; summary: string }) {
  return {
    state: { consultation, point } as EntryType,
    questions: { ...pointReviewQuestions(), ...roleQuestions(), ...grammarQuestions(), mixed: MIXED },
  };
}

type ChoiceAnswer = { choice: string; confidence: number };

export interface IntakeDecision {
  status: "released" | "rejected" | "draft";
  verdict: ReviewVerdict;
  role: "claim" | "objection" | "instrument" | "gap";
  kind: "fact" | "value" | "design" | "gap";
  slot: Slot | null;
  cq: string | null;
  answersCq: string[] | null;
  /** What an editor should look at (failed review criteria + uncertain judgments). */
  flags: string[];
  confidence: { role: number; door: number | null; pEvidence: number };
}

/** Below this the role choice is flagged for an editor (labels still applied). */
export const ROLE_MIN_CONFIDENCE = 0.5;

export function decideIntake(a: Record<string, unknown>): IntakeDecision {
  const review = decidePointReview(a as Record<string, { noul: number }>);
  const g = decideGrammar(a as Record<string, { noul: number }>);
  const roleA = a.role as ChoiceAnswer;
  const role = roleA.choice as IntakeDecision["role"];
  const doorO = a.door_objection as ChoiceAnswer;
  const doorI = a.door_instrument as ChoiceAnswer;

  const kind = role === "instrument" ? "design" : role === "gap" ? "gap" : g.kind;
  // Slots belong to the grammar claims; instruments sit at the conclusion
  // ("if we do it, then like this"); objections attach through their door.
  const slot = role === "claim" ? g.slot : role === "instrument" ? "conclusion" : null;

  const flags = [...review.flags];
  if (roleA.confidence < ROLE_MIN_CONFIDENCE) flags.push("role_uncertain");
  if (role === "claim" && g.demand) flags.push("demand_as_claim");
  // A confirmed mix is a text defect (the editor splits it); a middle
  // P(evidence) is only classification uncertainty (recorded, not repaired).
  if ((role === "claim" || role === "objection") && (a.mixed as { noul: number } | undefined)?.noul !== undefined) {
    if ((a.mixed as { noul: number }).noul >= 0.5) flags.push("mixed_fact_value");
    else if (g.mixed) flags.push("fact_value_uncertain");
  }

  return {
    status: review.verdict === "release" ? "released" : review.verdict === "reject" ? "rejected" : "draft",
    verdict: review.verdict,
    role,
    kind,
    slot,
    cq: role === "objection" ? doorO.choice : null,
    answersCq: role === "instrument" ? [doorI.choice] : null,
    flags,
    confidence: {
      role: roleA.confidence,
      door: role === "objection" ? doorO.confidence : role === "instrument" ? doorI.confidence : null,
      pEvidence: g.pEvidence,
    },
  };
}
