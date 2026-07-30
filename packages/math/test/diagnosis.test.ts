/**
 * Ground-truth tests for the diagnosis layer, built from constructed vote
 * matrices where the correct diagnosis is known by design — including the
 * concept paper's flagship case: the Übergangsfristen pseudo-consensus
 * (demo point P17), where two camps agree on a conclusion for incompatible
 * reasons.
 */

import { describe, expect, it } from "vitest";

import {
  buildRawMatrix,
  commentStatistics,
  diagnose,
  type DiagnosisPoint,
  type VoteRecord,
} from "../src/index.ts";

/**
 * Construct votes for two camps of `size` participants each.
 * Pattern per statement: [camp0 vote, camp1 vote] with 1/-1/0.
 */
function twoCamps(
  patterns: Record<number, [number, number]>,
  size = 20,
): { votes: VoteRecord[]; labels: number[] } {
  const votes: VoteRecord[] = [];
  for (let p = 0; p < size * 2; p++) {
    const camp = p < size ? 0 : 1;
    for (const [sid, pattern] of Object.entries(patterns)) {
      votes.push({
        participantId: p,
        statementId: Number(sid),
        vote: pattern[camp]!,
        modified: 1,
      });
    }
  }
  const labels = Array.from({ length: size * 2 }, (_, p) => (p < size ? 0 : 1));
  return { votes, labels };
}

function statsFor(patterns: Record<number, [number, number]>) {
  const { votes, labels } = twoCamps(patterns);
  const matrix = buildRawMatrix(votes);
  return commentStatistics(matrix, labels).grouped;
}

describe("diagnosis layer", () => {
  it("P17: bridge of results — agreement on the conclusion, war over premises", () => {
    // S1 conclusion "transition periods are sensible": both camps agree.
    // S2 premise camp A ("periods make the mandate come cleanly"): A yes, B no.
    // S3 premise camp B ("periods delay until the issue dies"): A no, B yes.
    const grouped = statsFor({ 1: [1, 1], 2: [1, -1], 3: [-1, 1] });
    const points: DiagnosisPoint[] = [
      { id: "P17", kind: "design", statementId: 1 },
      { id: "PA", kind: "value", statementId: 2, supports: ["P17"] },
      { id: "PB", kind: "value", statementId: 3, supports: ["P17"] },
    ];
    const result = diagnose(points, grouped);
    expect(result.conclusions["P17"]).toBe("bridge_of_results");
  });

  it("bridge of reasons — agreement resting on shared premises", () => {
    const grouped = statsFor({ 1: [1, 1], 2: [1, 1], 3: [1, 1] });
    const points: DiagnosisPoint[] = [
      { id: "C", kind: "design", statementId: 1 },
      { id: "P1", kind: "fact", statementId: 2, supports: ["C"] },
      { id: "P2", kind: "fact", statementId: 3, supports: ["C"] },
    ];
    const result = diagnose(points, grouped);
    expect(result.conclusions["C"]).toBe("bridge_of_reasons");
  });

  it("value conflict — facts settled, one value point splits the camps", () => {
    // Facts bridged; the value question (zumutbar?) splits camps → the rest
    // of the fight is theater; the decision belongs to the council.
    const grouped = statsFor({ 1: [1, 1], 2: [1, 1], 3: [1, -1] });
    const points: DiagnosisPoint[] = [
      { id: "F1", kind: "fact", statementId: 1 },
      { id: "F2", kind: "fact", statementId: 2 },
      { id: "W1", kind: "value", statementId: 3 },
    ];
    const result = diagnose(points, grouped);
    expect(result.overall).toBe("value_conflict");
    expect(result.points.find((p) => p.pointId === "W1")!.profile).toBe(
      "divisive",
    );
  });

  it("pseudo fact fight — values shared, a single fact question divides", () => {
    // The cheapest of all conflicts: resolvable with one expert report.
    const grouped = statsFor({ 1: [1, 1], 2: [1, -1], 3: [1, 1] });
    const points: DiagnosisPoint[] = [
      { id: "W1", kind: "value", statementId: 1 },
      { id: "F1", kind: "fact", statementId: 2 },
      { id: "W2", kind: "value", statementId: 3 },
    ];
    const result = diagnose(points, grouped);
    expect(result.overall).toBe("pseudo_fact_fight");
  });

  it("no overall diagnosis when both facts and values divide", () => {
    const grouped = statsFor({ 1: [1, -1], 2: [1, -1] });
    const points: DiagnosisPoint[] = [
      { id: "F1", kind: "fact", statementId: 1 },
      { id: "W1", kind: "value", statementId: 2 },
    ];
    const result = diagnose(points, grouped);
    expect(result.overall).toBeNull();
  });

  it("passes and thin votes yield 'open', not false certainty", () => {
    // Camp 1 passes on everything: no significant signal either way.
    const grouped = statsFor({ 1: [1, 0] });
    const points: DiagnosisPoint[] = [{ id: "F1", kind: "fact", statementId: 1 }];
    const result = diagnose(points, grouped);
    expect(result.points[0]!.profile).toBe("open");
  });

  it("is deterministic", () => {
    const grouped = statsFor({ 1: [1, 1], 2: [1, -1], 3: [-1, 1] });
    const points: DiagnosisPoint[] = [
      { id: "C", kind: "design", statementId: 1 },
      { id: "A", kind: "value", statementId: 2, supports: ["C"] },
      { id: "B", kind: "value", statementId: 3, supports: ["C"] },
    ];
    const a = JSON.stringify(diagnose(points, grouped));
    const b = JSON.stringify(diagnose(points, grouped));
    expect(a).toBe(b);
  });
});
