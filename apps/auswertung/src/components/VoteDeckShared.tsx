import type { CampCount } from "@policy/landkarte/data/types";
import type { VoteOrg, VotePoint } from "@policy/landkarte/data/vote";

/** 1 = stimmt zu, -1 = lehnt ab, 0 = übersprungen. */
export type Answer = 1 | -1 | 0;

/** Camp counts on a point: the diagnosis' numbers, or (if missing) counted from the organisations' positions. */
export function campCount(p: VotePoint, side: "a" | "b", orgs: VoteOrg[], size: number): CampCount {
  if (p.votes) return p.votes[side];
  const own = orgs.filter((o) => o.side === side);
  return {
    agree: own.filter((o) => p.positions[o.id] === 1).length,
    disagree: own.filter((o) => p.positions[o.id] === -1).length,
    size,
  };
}

/** The answer marks, in the Voices vocabulary: filled = stimmt zu, struck ring = lehnt ab. */
export function AnswerIcon({ v }: { v: 1 | -1 }) {
  return <span className={`vote-ico vote-ico-${v === 1 ? "agree" : "disagree"}`} aria-hidden />;
}
