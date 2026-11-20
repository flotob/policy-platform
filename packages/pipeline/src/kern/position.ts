/**
 * Where one camp stands on one statement. Shared by the evaluation (befund.ts) and its words
 * (befund-text.ts), so both apply exactly the same rule.
 */
import { isSignificant, onePropTest } from "@policy/math";

import type { CampCount } from "./befund.ts";

/** Fewer votes than this in a camp are not the camp's position (a statistical floor, not a policy threshold). */
export const MIN_CAMP_VOTES = 3;

const share = (n: number, of: number) => (of ? n / of : 0);

/** A camp holds a position when enough of it voted, the share reaches the threshold and it is not chance. */
export function carries(c: CampCount, t: number): boolean {
  return c.seen >= MIN_CAMP_VOTES && share(c.agree, c.seen) >= t && isSignificant(onePropTest(c.agree, c.seen));
}
export function rejects(c: CampCount, t: number): boolean {
  return c.seen >= MIN_CAMP_VOTES && share(c.disagree, c.seen) >= t && isSignificant(onePropTest(c.disagree, c.seen));
}
