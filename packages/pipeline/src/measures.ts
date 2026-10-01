/**
 * Points → measures of the bill (exp/jev). Measures come from the draft law
 * (propose-measures-bill.ts); every point is assigned to one of them, to
 * the bill as a whole, or to "beyond the bill". A point that names its
 * section ("§ 29 Abs. 7 streichen") is assigned in code when every section
 * it names belongs to one measure; Jev judges the rest.
 */

import { choice } from "@policy/llm";

/** v2: "whole" only for the law as a whole — a point about rules in several measures goes to its main measure. */
export const MEASURE_FAMILY = "measure.v2";
export const WHOLE = "übergreifend";
export const BEYOND = "Über den Entwurf hinaus";

export interface BillMeasure {
  name: string;
  description: string;
  paragraphs: number[];
  other: string[];
}

/** Abbreviations of OTHER laws: "§ 71 GEG" is not § 71 of this bill. */
const OTHER_LAW = /\b(?!WPG\b)[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*(?:G|V|O|B)\b|\b(?:Gebäudeenergiegesetz|Baugesetzbuch|Energiewirtschaftsgesetz|Grundgesetz)/;

/** Section numbers of THIS bill named in a text (others filtered out). */
export function namedSections(text: string): number[] {
  const out: number[] = [];
  const re = /§§?\s*(\d{1,3})(?:\s*(?:,|und|bis|–|-)\s*(\d{1,3}))*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40).split("§")[0]!;
    if (OTHER_LAW.test(tail)) continue;
    for (const n of m[0].match(/\d{1,3}/g) ?? []) out.push(Number(n));
  }
  return [...new Set(out)];
}

/** The one measure every named section belongs to — or null (none named, unknown, or ambiguous). */
export function measureBySection(text: string, measures: BillMeasure[]): string | null {
  const sections = namedSections(text);
  if (sections.length === 0) return null;
  const owners = new Set<string>();
  for (const s of sections) {
    const own = measures.filter((m) => m.paragraphs.includes(s));
    if (own.length !== 1) return null;
    owners.add(own[0]!.name);
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

export function measureQuestion(measures: BillMeasure[]) {
  const criteria: Record<string, string> = {};
  measures.forEach((m, i) => {
    criteria[`m${i + 1}`] =
      `The point concerns the measure "${m.name}" (§ ${m.paragraphs.join(", ")}${m.other.length ? `; ${m.other.join("; ")}` : ""}): ${m.description}`;
  });
  criteria.whole =
    "The point concerns the draft law AS A WHOLE — an overall verdict on the law, its general direction or goal, a fact about the general situation the whole debate builds on (the building stock, emissions, prices, the state of heat networks), or values that cut across the whole law. NOT a point about a specific rule: a rule that matters for several measures (a biomass limit, how waste heat is counted, a deadline) belongs to the measure the point mainly concerns.";
  criteria.beyond =
    "The point DEMANDS or criticises something this draft law does not regulate — other laws (e.g. the building energy act, tenancy law), funding programmes, energy prices and taxes — rather than a provision of this draft or the situation it responds to.";
  return { measure: choice("Which measure of the draft law does `point` concern?", criteria) };
}

export function decideMeasure(measures: BillMeasure[], a: { choice: string; confidence: number }): string {
  if (a.choice === "whole") return WHOLE;
  if (a.choice === "beyond") return BEYOND;
  return measures[Number(a.choice.slice(1)) - 1]!.name;
}

/** Below this Jev confidence the LLM gives a second opinion on the measure. */
export const MEASURE_SECOND_OPINION_BELOW = 0.5;

export function measureOptionsText(measures: BillMeasure[]): string {
  return [
    ...measures.map((m, i) => `m${i + 1}: ${m.name} (§ ${m.paragraphs.join(", ")}${m.other.length ? `; ${m.other.join("; ")}` : ""}) — ${m.description}`),
    "whole: the draft law AS A WHOLE — overall verdict, its general direction or goal, a fact about the general situation, values across the whole law; NOT a specific rule that matters for several measures (that point goes to the measure it mainly concerns)",
    "beyond: a demand or criticism addressed to something this draft does not regulate (other laws, funding, prices and taxes)",
  ].join("\n");
}
