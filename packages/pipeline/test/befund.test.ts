import { describe, expect, it } from "vitest";

import {
  attackStatus,
  categoryOf,
  evaluate,
  profileOf,
  supportStatus,
  verdictOf,
  type CampCount,
  type EvaluateInput,
  type NodeIn,
  type VoteIn,
} from "../src/kern/befund.ts";
import { checkRules, conclusions } from "../src/kern/bericht.ts";
import { headline, readingOf, stepText } from "../src/kern/befund-text.ts";

/** A camp of 100 with this agreement and disagreement in percent (the rest passes). */
const camp = (agree: number, disagree = 100 - agree - 10): CampCount => ({ agree, disagree: Math.max(0, disagree), pass: 100 - agree - Math.max(0, disagree), seen: 100 });
const T = 0.6;
const none = { stuetzt: 0, greift_an: 0 };

// The cases from Stephan's results page (Musterstadt, fictional).
describe("Nach Befund: two numbers and the type", () => {
  it("a value statement 72 % to 18 % is the dispute", () => {
    const p = profileOf([camp(72), camp(18, 70)], T);
    expect(p).toBe("trennt");
    expect(categoryOf(p, "W", none, false)).toBe("streit");
  });
  it("a fact 78 % / 71 % is a bridge", () => {
    expect(categoryOf(profileOf([camp(78), camp(71)], T), "T", none, false)).toBe("bruecke");
  });
  it("agreement read in opposite directions is a false consensus", () => {
    expect(categoryOf(profileOf([camp(84), camp(79)], T), "verfahren", { stuetzt: 1, greift_an: 1 }, false)).toBe("warnung");
  });
  it("a split fact can be settled by a study", () => {
    expect(categoryOf(profileOf([camp(66, 20), camp(30, 55)], T), "T", none, false)).toBe("klaerbar");
  });
  it("an undecided fact without proof stays open, with proof it is clarifiable", () => {
    const p = profileOf([camp(58, 20), camp(34, 46)], T);
    expect(p).toBe("unentschieden");
    expect(categoryOf(p, "T", none, false)).toBe("offen");
    expect(categoryOf(p, "T", none, true)).toBe("klaerbar");
  });
  it("both camps rejecting is a bridge too", () => {
    expect(profileOf([camp(10, 80), camp(20, 70)], T)).toBe("abgelehnt");
  });
  it("too few votes in a camp are no position", () => {
    expect(profileOf([camp(80), { agree: 2, disagree: 0, pass: 0, seen: 2 }], T)).toBe("trennt");
  });
});

describe("Nach Argument: attack statuses and step verdicts", () => {
  it("a contradicted premise both camps keep: the attack is repelled", () => {
    expect(attackStatus([camp(78), camp(71)], T, true, "T", false)).toBe("abgewehrt");
  });
  it("an attack both camps agree with holds", () => {
    expect(attackStatus([camp(81), camp(77)], T, false, "T", false)).toBe("haelt");
  });
  it("a value attack one camp carries holds; a fact attack one camp carries is clarifiable", () => {
    expect(attackStatus([camp(20, 70), camp(76)], T, false, "W", false)).toBe("haelt");
    expect(attackStatus([camp(20, 70), camp(76)], T, false, "T", false)).toBe("klaerbar");
  });
  it("support statuses", () => {
    expect(supportStatus([camp(88), camp(41, 40)], T)).toBe("einseitig");
    expect(supportStatus([camp(85), camp(70)], T)).toBe("getragen");
  });
  it("a holding value attack makes the step fall; a holding fact attack makes it wobble", () => {
    const e = (status: "haelt" | "abgewehrt" | "klaerbar", role: "greift_an" | "stuetzt" = "greift_an") => ({ step: "eingriff" as const, question: "wert", role, status, attack: null, camp: null });
    expect(verdictOf([{ entry: e("haelt"), typ: "W", rolle: "beitrag" }])).toBe("faellt");
    expect(verdictOf([{ entry: e("haelt"), typ: "T", rolle: "beitrag" }])).toBe("wackelt");
    expect(verdictOf([{ entry: e("abgewehrt"), typ: "T", rolle: "praemisse" }, { entry: e("klaerbar"), typ: "T", rolle: "beitrag" }])).toBe("haelt");
  });
});

describe("evaluate", () => {
  // Two clean camps of twelve: A agrees with the measure and its values, B rejects the values; both share the facts.
  const nodes: NodeIn[] = [
    { id: "root", ord: 1, text: "Die Stadt soll X tun.", typ: "W", rolle: "schluss", schritt: null, frage: null, richtung: null, version: 1 },
    { id: "fact", ord: 2, text: "Die Netze haben Reserven.", typ: "T", rolle: "praemisse", schritt: "lage", frage: null, richtung: "stuetzt", version: 1 },
    { id: "value", ord: 3, text: "Die Mehrkosten sind zumutbar.", typ: "W", rolle: "praemisse", schritt: "eingriff", frage: null, richtung: "stuetzt", version: 1 },
    { id: "attack", ord: 4, text: "Die Mehrkosten sind für Familien nicht tragbar.", typ: "W", rolle: "beitrag", schritt: "eingriff", frage: "wert", richtung: "greift_an", version: 1 },
    { id: "skill", ord: 5, text: "Das Handwerk schafft die Menge nicht.", typ: "T", rolle: "beitrag", schritt: "weg", frage: "weg", richtung: "greift_an", version: 1 },
    { id: "frist", ord: 6, text: "Übergangsfristen sind sinnvoll.", typ: "verfahren", rolle: "beitrag", schritt: "weg", frage: "weg", richtung: "stuetzt", version: 1 },
    { id: "speicher", ord: 7, text: "Speicher erhöhen den Eigenverbrauch.", typ: "T", rolle: "beitrag", schritt: "wirkung", frage: "wirkung", richtung: "stuetzt", version: 1 },
    { id: "kosten", ord: 8, text: "Solarstrom senkt die Betriebskosten.", typ: "T", rolle: "beitrag", schritt: "wirkung", frage: "wirkung", richtung: "stuetzt", version: 1 },
  ];
  const A: Record<string, -1 | 0 | 1> = { root: 1, fact: 1, value: 1, attack: -1, skill: 1, frist: 1, speicher: 1, kosten: 1 };
  const B: Record<string, -1 | 0 | 1> = { root: -1, fact: 1, value: -1, attack: 1, skill: 1, frist: 1, speicher: 1, kosten: 1 };
  const votes: VoteIn[] = [];
  const participants = [];
  for (let i = 0; i < 24; i++) {
    const id = `p${String(i).padStart(2, "0")}`;
    participants.push({ id, via: "tuer" });
    const side = i < 14 ? A : B;
    for (const n of nodes) votes.push({ participant: id, node: n.id, value: side[n.id]! });
  }
  const input: EvaluateInput = {
    nodes,
    moves: [
      { id: "m1", node: "frist", stance: 1, richtung: "stuetzt", schritt: "weg", frage: "weg", beleg: "keine", aussage: "Fristen, damit die Pflicht sicher kommt.", quote: "Fristen ja, damit die Pflicht sauber kommt.", participant: "p01", sender: "Privatperson", source: null },
      { id: "m2", node: "frist", stance: 1, richtung: "greift_an", schritt: "eingriff", frage: "wert", beleg: "keine", aussage: "Fristen so lang, dass sich die Pflicht erledigt.", quote: "Fristen ja, bis sich das Thema erledigt hat.", participant: "p20", sender: "Privatperson", source: null },
      { id: "m3", node: "fact", stance: -1, richtung: "greift_an", schritt: "lage", frage: "lage", beleg: "behauptung", aussage: "Die Netze sind voll.", quote: "Der Strom kommt gar nicht ins Netz.", participant: "p21", sender: "Privatperson", source: null },
      { id: "m4", node: "fact", stance: 1, richtung: "stuetzt", schritt: "lage", frage: "lage", beleg: "messdaten", aussage: "Die Netze sind ausgelegt.", quote: "6,5 Kilowatt je Wohneinheit.", participant: null, sender: "Stadtwerke", source: null },
    ],
    votes,
    participants,
    context: {
      steps: [
        { key: "lage", label: "So ist die Lage", these: "" },
        { key: "wirkung", label: "Das bewirkt die Maßnahme", these: "" },
        { key: "weg", label: "So kommen wir ans Ziel", these: "" },
        { key: "eingriff", label: "Dafür lohnt sich der Eingriff", these: "" },
      ],
      questions: [
        { key: "lage", label: "Stimmt die Lage so?", steps: ["lage"] },
        { key: "wirkung", label: "Bewirkt die Maßnahme, was sie soll?", steps: ["wirkung"] },
        { key: "weg", label: "Gibt es einen besseren Weg?", steps: ["weg"] },
        { key: "nebenfolgen", label: "Sind die Nebenfolgen tragbar?", steps: ["lage", "eingriff"] },
        { key: "wert", label: "Ist das Ziel den Eingriff wert?", steps: ["eingriff"] },
      ],
    },
    params: { bridgeThreshold: 0.6, minParticipants: 6 },
    saturation: { inputs: 0, newPoints: 0, streak: 0, window: 10, saturated: false, series: [] },
    inputs: { shortPoints: 0, uploads: 0, files: 0 },
  };
  const r = evaluate(input);
  const by = (id: string) => r.statements.find((s) => s.id === id)!;

  it("finds the two camps, the larger one first", () => {
    expect(r.ready).toBe(true);
    expect(r.camps?.k).toBe(2);
    expect(r.camps?.sizes).toEqual([14, 10]);
    expect(r.people.filter((p) => p.camp >= 0)).toHaveLength(24);
  });
  it("numbers the measure first, then step by step", () => {
    expect(r.statements.map((s) => s.id)).toEqual(["root", "fact", "speicher", "kosten", "skill", "frist", "value", "attack"]);
  });
  it("classifies each statement", () => {
    expect(by("value").category).toBe("streit");
    expect(by("fact").category).toBe("bruecke");
    expect(by("frist").category).toBe("warnung");
  });
  it("judges the steps: the value step falls, the way wobbles, the situation holds", () => {
    const v = Object.fromEntries(r.steps.map((s) => [s.key, s.verdict]));
    expect(v).toEqual({ lage: "haelt", wirkung: "haelt", weg: "wackelt", eingriff: "faellt" });
    expect(by("fact").entries.find((e) => e.role === "greift_an")?.status).toBe("abgewehrt");
    expect(by("frist").entries.find((e) => e.status === "verdeckt")?.step).toBe("eingriff");
  });
  it("diagnoses a clear value conflict with the value statements as its core", () => {
    expect(r.diagnoses[0]?.art).toBe("wertkonflikt");
    expect(r.core).toContain(by("value").nr);
  });
  it("counts evidence by class", () => {
    expect(by("fact").evidence).toEqual({ dafuer: { messdaten: 1 }, dagegen: { behauptung: 1 } });
  });
  it("is deterministic (I7)", () => {
    const again = evaluate(input);
    expect({ ...again, computedAt: "" }).toEqual({ ...r, computedAt: "" });
  });
  it("R1 lists the findings, and the list read back verbatim passes the R3 rules", () => {
    const ss = conclusions(r, ["Klima zuerst", "Kosten & Freiheit"], {
      town: "Stadt Musterstadt",
      measure: "X",
      questions: input.context.questions,
      fictional: true,
      editorialMode: "mensch",
      resultVersion: 1,
    });
    expect(ss[0]?.id).toBe("S1");
    expect(ss.some((x) => x.section === "rat" && x.refs.includes(by("value").nr))).toBe(true);
    expect(ss.some((x) => x.section === "warnung")).toBe(true);
    expect(checkRules(ss, ss.map((x) => ({ abschnitt: x.section, text: x.text, saetze: [x.id] })))).toEqual([]);
  });
  it("speaks plain German", () => {
    expect(headline(r).lead).toMatch(/von acht Aussagen tragen in beiden Lagern/);
    expect(readingOf(by("value"), r, ["Klima zuerst", "Kosten & Freiheit"]).join(" ")).toMatch(/Lager „Klima zuerst“/);
    expect(stepText(r.steps[3]!, r)).toMatch(/^Die Stufe fällt\./);
  });
});
