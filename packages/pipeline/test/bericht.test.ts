import { describe, expect, it } from "vitest";

import { checkRules, numbersIn, refsIn, type Absatz, type Satz } from "../src/kern/bericht.ts";

const S: Satz[] = [
  { id: "S1", section: "ergebnis", text: "Elf von 19 Aussagen tragen in beiden Lagern.", refs: [] },
  { id: "S2", section: "rat", text: "„Die Mehrkosten sind zumutbar.“ [A14] ist eine Wertungsfrage: 72 % im Lager A, 18 % im Lager B stimmen zu.", refs: [14] },
];
const ok: Absatz[] = [
  { abschnitt: "ergebnis", text: "11 von 19 Aussagen tragen in beiden Lagern.", saetze: ["S1"] },
  { abschnitt: "rat", text: "Bei „Die Mehrkosten sind zumutbar.“ [A14] trennen sich die Lager: 72 % zu 18 %.", saetze: ["S2"] },
];

describe("R3 rules", () => {
  it("reads digits and number words, not statement references", () => {
    expect([...numbersIn("Elf von 19, Stufe 4 [A14], 1,5 Prozent")].sort()).toEqual(["1.5", "11", "19", "4"]);
    expect([...refsIn("„x“ [A3] und [A12]")]).toEqual([3, 12]);
  });
  it("passes a faithful text", () => {
    expect(checkRules(S, ok)).toEqual([]);
  });
  it("catches an added number, a foreign statement and a missing sentence", () => {
    const bad: Absatz[] = [{ abschnitt: "rat", text: "„Die Mehrkosten sind zumutbar.“ [A14] und [A9]: 72 % zu 18 %, also 54 Punkte Abstand.", saetze: ["S2"] }];
    const issues = checkRules(S, bad).map((x) => x.text);
    expect(issues.some((t) => t.includes("Zahl 54"))).toBe(true);
    expect(issues.some((t) => t.includes("[A9]"))).toBe(true);
    expect(issues.some((t) => t.startsWith("Satz S1"))).toBe(true);
  });
  it("catches a reference to a sentence that does not exist", () => {
    expect(checkRules(S, [...ok, { abschnitt: "rat", text: "Mehr.", saetze: ["S9"] }]).map((x) => x.text)).toContain("Absatz 3 verweist auf S9, den es in der Liste nicht gibt.");
  });
});
