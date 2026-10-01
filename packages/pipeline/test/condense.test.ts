import { describe, expect, it } from "vitest";

import { mergeGroups, SAME_QUESTION_MIN } from "../src/jev-map.ts";

describe("mergeGroups (same-question dedupe)", () => {
  it("keeps every proposal when no pair asks the same question", () => {
    expect(mergeGroups(3, [{ i: 0, j: 1, p: 0.2 }, { i: 1, j: 2, p: 0.49 }])).toEqual([0, 1, 2]);
  });

  it("merges into the earlier proposal at the threshold", () => {
    expect(mergeGroups(3, [{ i: 1, j: 2, p: SAME_QUESTION_MIN }])).toEqual([0, 1, 1]);
  });

  it("merges chains transitively onto the earliest proposal", () => {
    // "anheben" (3) ~ "streichen" (1), "streichen" (1) ~ "flexibilisieren" (0)
    expect(mergeGroups(4, [{ i: 1, j: 3, p: 0.9 }, { i: 0, j: 1, p: 0.7 }])).toEqual([0, 0, 2, 0]);
  });
});
