import { describe, expect, it } from "vitest";

import { breakCandidates, planCuts } from "../src/extract.ts";
import { decideIntake } from "../src/intake.ts";

describe("breakCandidates", () => {
  it("offers breaks after sentence ends, at blank lines, and before headings — not mid-sentence", () => {
    const t = "Erster Satz endet hier.\nzweiter Teil des Satzes\nläuft weiter\n§ 29 Quoten\nText.\n\nNeuer Absatz";
    const at = breakCandidates(t).map((b) => t.slice(b, b + 12));
    expect(at).toContain("zweiter Teil");
    expect(at).toContain("§ 29 Quoten\n");
    expect(at).not.toContain("läuft weiter");
  });
});

describe("planCuts", () => {
  const para = (n: number) => `Abschnitt ${n}. ` + "Die Wärmeplanung braucht verlässliche Daten und Personal. ".repeat(5) + "\n";
  const text = Array.from({ length: 30 }, (_, i) => para(i)).join("");
  // Fake judge: a new topic begins only before sections divisible by 4.
  const judge = {
    judge: async (state: { cuts: Record<string, { after: string }> }) => {
      const answers: Record<string, { noul: number }> = {};
      for (const [k, v] of Object.entries(state.cuts)) {
        const n = Number(/^Abschnitt (\d+)/.exec(v.after)?.[1] ?? -1);
        answers[k] = { noul: n % 4 === 0 ? 0.9 : 0.1 };
      }
      return { answers, provenance: {} };
    },
  };

  it("keeps a short text whole", async () => {
    expect((await planCuts(judge as never, "kurz", 100)).cuts).toEqual([4]);
  });

  it("cuts where the judge sees a new topic, never above the limit", async () => {
    const { cuts } = await planCuts(judge as never, text, 1500);
    expect(cuts.at(-1)).toBe(text.length);
    let start = 0;
    for (const c of cuts) {
      expect(c - start).toBeLessThanOrEqual(1500);
      if (c < text.length) expect(text.slice(c, c + 14)).toMatch(/^Abschnitt (\d*[048]|\d*[13579][26])\./);
      start = c;
    }
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

describe("measureBySection", () => {
  const measures = [
    { name: "Quoten", description: "", paragraphs: [2, 29], other: [] },
    { name: "Neue Netze", description: "", paragraphs: [30], other: [] },
  ];
  it("assigns by the bill's own sections, ignoring other laws", async () => {
    const { measureBySection } = await import("../src/measures.ts");
    expect(measureBySection("§ 29 Abs. 7 Satz 4 streichen", measures)).toBe("Quoten");
    expect(measureBySection("Verweis auf § 71 GEG anpassen", measures)).toBeNull();
    expect(measureBySection("§§ 29 und 30 zusammenführen", measures)).toBeNull();
    expect(measureBySection("Die Quote ist zu ehrgeizig", measures)).toBeNull();
    expect(measureBySection("§ 29 WPG und § 71 GEG abstimmen", measures)).toBe("Quoten");
  });
});
