/**
 * The concept paper's argument grammar as System One judgments (exp/jev).
 *
 * Stephan's recognition tests ("erkennbar daran", paper §3) are yes/no
 * questions by construction, so each becomes one Noul; code composes slot
 * and fact/value from the probabilities. The fact/value split is the paper's
 * backbone (§5: "Diese Trennlinie ist das Rückgrat des Ansatzes") — here it
 * becomes an auditable, calibrated judgment instead of a side effect of
 * generation, and mixed claims surface instead of being forced into a zone.
 */

import { noul } from "@policy/llm";

export const GRAMMAR_FAMILY = "grammar.v2";
export const EVIDENCE_FAMILY = "evidence.v2";

const EVIDENCE = noul(
  "Could evidence — data, measurements, studies, expert reports, or legal analysis — in principle settle whether the claim in `point` is true?",
  {
    true: "The claim is about facts, effects, costs, legal consequences, or prognoses: evidence can confirm or refute it, even if that evidence does not exist yet.",
    false: "The claim is a value judgment, a priority, a demand about what ought to be done, or a stance of approval or rejection ('X is welcomed', 'X is rejected'): no study could settle it; it has to be decided politically.",
  },
);

export function evidenceQuestions() {
  return { evidence: EVIDENCE };
}

export function grammarQuestions() {
  return {
    evidence: EVIDENCE,
    p1: noul(
      "Does `point` describe the present situation — how things are today, independently of the proposed measure — so that it could already be checked with data today?",
    ),
    p2: noul(
      "Does `point` make a prognosis about what the proposed measure will cause — an effect in the future that would turn out differently without the measure?",
    ),
    p3: noul(
      "Does `point` claim that an effect does or does not serve a stated goal — such that one could accept the effect itself and still dispute that it serves the goal?",
    ),
    p4: noul(
      "Does `point` judge whether a goal or value is worth its price — a setting of priorities that no study could prove or disprove?",
    ),
    stance: noul(
      "Does `point` state support for or rejection of the proposed measure or one of its provisions — a verdict on the measure, rather than a reason for or against it?",
    ),
    demand: noul(
      "Is `point` a demand about how the measure should be designed, changed, or implemented — saying what should be done, rather than claiming how things are, will be, or what matters?",
    ),
  };
}

export type Slot = "P1" | "P2" | "P3" | "P4" | "conclusion";

/** Below this, no slot test clearly applies → slot stays unclear. */
export const SLOT_MIN = 0.35;
/** Evidence probability in this band = mixed claim (fact inside a value judgment or vice versa). */
export const MIXED_BAND: [number, number] = [0.3, 0.7];

export interface GrammarDecision {
  kind: "fact" | "value";
  slot: Slot | null;
  mixed: boolean;
  /** A design demand filed as a claim — candidate for kind "design" (editorial). */
  demand: boolean;
  pEvidence: number;
  slotProbabilities: Record<Slot, number>;
}

/** Fact/value only (objections, map points): the zone, not the slot. */
export function decideEvidence(a: Record<string, { noul: number }>) {
  const pEvidence = a.evidence!.noul;
  return {
    kind: pEvidence >= 0.5 ? ("fact" as const) : ("value" as const),
    mixed: pEvidence >= MIXED_BAND[0] && pEvidence <= MIXED_BAND[1],
    pEvidence,
  };
}

export function decideGrammar(a: Record<string, { noul: number }>): GrammarDecision {
  const slotProbabilities: Record<Slot, number> = {
    P1: a.p1!.noul,
    P2: a.p2!.noul,
    P3: a.p3!.noul,
    P4: a.p4!.noul,
    conclusion: Math.max(a.stance!.noul, a.demand!.noul),
  };
  let slot: Slot | null = null;
  let best = 0;
  for (const [s, p] of Object.entries(slotProbabilities) as [Slot, number][]) {
    if (p > best) {
      best = p;
      slot = s;
    }
  }
  const e = decideEvidence(a);
  return {
    ...e,
    slot: best >= SLOT_MIN ? slot : null,
    demand: a.demand!.noul >= 0.5,
    slotProbabilities,
  };
}

// ——— District of a map point: derived in code, not generated ————————————

const DOOR_TO_BEZIRK: Record<string, string> = {
  empirics: "wirkung",
  feasibility: "machbarkeit",
  goal_conflict: "kosten",
  alternatives: "alternativen",
};

/**
 * Typ decides the zone: W → wert, verfahren → ausgestaltung. A fact point's
 * district follows the critical questions of its member objections (paper
 * §4: districts ARE the doors) when they give a clear majority; otherwise the
 * proposed district stands — and a fact point never sits in wert/ausgestaltung
 * (it then falls back to "wirkung", the P2/P3 district).
 */
export function deriveBezirk(
  typ: "T" | "W" | "verfahren",
  memberDoors: (string | null)[],
  proposed: string,
): string {
  if (typ === "W") return "wert";
  if (typ === "verfahren") return "ausgestaltung";
  const counts = new Map<string, number>();
  let withDoor = 0;
  for (const d of memberDoors) {
    const b = d ? DOOR_TO_BEZIRK[d] : undefined;
    if (!b) continue;
    withDoor++;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  if (top && top[1] * 2 > withDoor) return top[0];
  if (proposed === "wert" || proposed === "ausgestaltung") return "wirkung";
  return proposed;
}
