import { describe, expect, it } from "vitest";

import { windowSpans } from "../src/extract.ts";
import { decideIntake } from "../src/intake.ts";

describe("windowSpans", () => {
  it("keeps a short text whole", () => {
    const t = "Ein kurzer Absatz, der lang genug ist, um als Fenster zu zählen und nicht verworfen zu werden.";
    expect(windowSpans(t, 1000)).toEqual([{ start: 0, end: t.length }]);
  });

  it("cuts at paragraph boundaries, never above the limit, as exact slices", () => {
    const para = (n: number) => `Absatz ${n}: ` + "Wärmeplanung braucht verlässliche Daten. ".repeat(6);
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
    const spans = windowSpans(text, 700);
    expect(spans.length).toBeGreaterThan(1);
    for (const s of spans) {
      expect(s.end - s.start).toBeLessThanOrEqual(700);
      const slice = text.slice(s.start, s.end);
      expect(slice.startsWith("Absatz")).toBe(true);
    }
    // Every paragraph lands in exactly one window.
    for (let i = 0; i < 12; i++) {
      expect(spans.filter((s) => text.slice(s.start, s.end).includes(`Absatz ${i}:`)).length).toBe(1);
    }
  });

  it("splits an oversized paragraph at whitespace", () => {
    const text = "Wort ".repeat(500).trim();
    const spans = windowSpans(text, 600);
    for (const s of spans) expect(s.end - s.start).toBeLessThanOrEqual(600);
    expect(spans.at(-1)!.end).toBe(text.length);
  });
});

describe("decideIntake", () => {
  const n = (p: number) => ({ noul: p });
  const c = (choice: string, confidence = 0.9) => ({ choice, confidence, probabilities: {} });
  const base = {
    single_claim: n(0.9), standalone: n(0.9), neutral: n(0.9), on_topic: n(0.95), meta: n(0.05), personal: n(0.01),
    evidence: n(0.9), p1: n(0.1), p2: n(0.8), p3: n(0.2), p4: n(0.1), stance: n(0.1), demand: n(0.1),
    role: c("claim"), door_objection: c("empirics"), door_instrument: c("feasibility"),
  };

  it("a clean prognosis claim: released fact at P2, no door", () => {
    const d = decideIntake(base);
    expect(d).toMatchObject({ status: "released", kind: "fact", slot: "P2", cq: null, answersCq: null });
  });

  it("an objection carries its door and no slot", () => {
    const d = decideIntake({ ...base, role: c("objection") });
    expect(d).toMatchObject({ kind: "fact", slot: null, cq: "empirics", answersCq: null });
  });

  it("an instrument is design at the conclusion, answering its door", () => {
    const d = decideIntake({ ...base, role: c("instrument") });
    expect(d).toMatchObject({ kind: "design", slot: "conclusion", cq: null, answersCq: ["feasibility"] });
  });

  it("personal data is never auto-released; meta-commentary is rejected", () => {
    expect(decideIntake({ ...base, personal: n(0.4) }).status).toBe("draft");
    expect(decideIntake({ ...base, meta: n(0.9) }).status).toBe("rejected");
  });

  it("flags an uncertain role and a demand filed as a claim", () => {
    const d = decideIntake({ ...base, role: c("claim", 0.4), demand: n(0.7) });
    expect(d.flags).toEqual(expect.arrayContaining(["role_uncertain", "demand_as_claim"]));
  });
});
