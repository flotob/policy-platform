/**
 * Shared pieces of the report (/bericht) and the study agenda (/gutachten):
 * grouping by measure, ranking, the counts as text, and what kind of
 * clarification a Befund proposes. Deterministic — no language model here;
 * the Befunde (written by the pipeline) are the only model-written text shown.
 */

import { sql, type Db } from "@policy/db";

import type { Diag } from "../vocab.ts";
import { breadth, gap, loadAllMapPoints } from "./measure.ts";
import type { Camp, CampCount, MapPoint, MeasureSummary } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export interface ReportData {
  points: MapPoint[];
  /** When the camps (and with them the diagnoses' numbers) were last computed. */
  analysedAt: Date | null;
}

export async function loadReport(db: Db, consultationId: string): Promise<ReportData> {
  const points = await loadAllMapPoints(db, consultationId);
  const r = await rows<{ at: string | Date | null }>(db, sql`
    SELECT max(created_at) AS at FROM analysis_runs
    WHERE consultation_id = ${consultationId} AND engine LIKE '%map-points'`);
  const at = r[0]?.at;
  return { points, analysedAt: at ? new Date(at) : null };
}

export interface MeasureGroup {
  measure: MeasureSummary;
  points: MapPoint[];
}

/** Points grouped by measure, in the measures' order; measures without points are left out. */
export function groupByMeasure(points: MapPoint[], measures: MeasureSummary[], cmp: (a: MapPoint, b: MapPoint) => number = (a, b) => a.ord - b.ord): MeasureGroup[] {
  return measures
    .map((measure) => ({ measure, points: points.filter((p) => p.scope === measure.scope).sort(cmp) }))
    .filter((g) => g.points.length > 0);
}

/** Organisations of both camps that took a position on a point. */
export function voices(p: MapPoint): number {
  return p.votes ? p.votes.a.agree + p.votes.a.disagree + p.votes.b.agree + p.votes.b.disagree : 0;
}

/** Disputes: where the camps are furthest apart first, then where more organisations spoke, then map order. */
export function bySplit(a: MapPoint, b: MapPoint): number {
  return gap(b) - gap(a) || voices(b) - voices(a) || a.ord - b.ord;
}

/** Bridges: the broadest agreement first. */
export function byBreadth(a: MapPoint, b: MapPoint): number {
  return breadth(b) - breadth(a) || voices(b) - voices(a) || a.ord - b.ord;
}

/** The sharpest point of each measure first, then the rest — so a short list spans the decisions. */
export function spread(points: MapPoint[], n: number, cmp: (a: MapPoint, b: MapPoint) => number): MapPoint[] {
  const seen = new Set<string>();
  const first: MapPoint[] = [];
  const rest: MapPoint[] = [];
  for (const p of [...points].sort(cmp)) {
    if (seen.has(p.scope)) rest.push(p);
    else {
      seen.add(p.scope);
      first.push(p);
    }
  }
  return [...first, ...rest].slice(0, n);
}

/** "4 von 4 dafür" — counts of those who spoke, never percentages. */
export function countText(c: CampCount): string {
  const said = c.agree + c.disagree;
  return said === 0 ? "äußert sich nicht" : `${c.agree} von ${said} dafür`;
}

/** "Lager A: 4 von 4 dafür; Lager B: 0 von 2 dafür" with the real camp names. */
export function campCountsText(votes: MapPoint["votes"], camps: Camp[]): string | null {
  if (!votes || camps.length < 2) return null;
  return `${camps[0]!.name}: ${countText(votes.a)}; ${camps[1]!.name}: ${countText(votes.b)}`;
}

/** A Lücke's critical question without the pipeline's suffix. */
export function gapQuestion(p: MapPoint): string {
  return p.text.replace(/\s*—\s*Diese kritische Frage hat im Verfahren niemand gestellt\.$/, "");
}

/** Diagnosis names for counts in running text. */
export const DIAG_COUNT: Record<Diag, [one: string, many: string]> = {
  kern: ["Kernkonflikt", "Kernkonflikte"],
  wert: ["Wertfrage", "Wertfragen"],
  klaerbar: ["Tatsachenfrage", "Tatsachenfragen"],
  gestaltung: ["Gestaltungsfrage", "Gestaltungsfragen"],
  bruecke: ["Brücke", "Brücken"],
  warnung: ["Scheinbrücke", "Scheinbrücken"],
  offen: ["offene Frage", "offene Fragen"],
  luecke: ["Lücke", "Lücken"],
};

export function countOf(n: number, diag: Diag): string {
  const [one, many] = DIAG_COUNT[diag];
  return `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;
}

/** Bridges: was the reasons check run, and what did it find? */
export function reasonsNote(p: MapPoint): string {
  if (p.diag === "warnung") return "Prüfung der Begründungen: Die Lager stimmen aus unvereinbaren Gründen zu.";
  if (p.reasons === "same_reasons") return "Prüfung der Begründungen: dieselben Gründe in beiden Lagern.";
  if (p.reasons === "unclear") return "Prüfung der Begründungen: nicht eindeutig, ob die Gründe übereinstimmen.";
  return "Begründungen nicht geprüft: zu wenig Material für einen Vergleich.";
}

/** The kinds of clarification a Befund names (read from its text, fixed list). */
export type Clarification = "recht" | "gutachten" | "rechnung" | "daten";

export const CLARIFICATION: Record<Clarification, string> = {
  recht: "juristische Kurzstellungnahme",
  gutachten: "Gutachten",
  rechnung: "Modellrechnung",
  daten: "Daten oder Messungen",
};

const CLARIFICATION_RX: [Clarification, RegExp][] = [
  ["recht", /juristisch|rechtsgutacht/i],
  ["gutachten", /(?<!rechts)gutacht|studie/i],
  ["rechnung", /(modell|wirtschaftlichkeits|szenario|kosten)rechnung/i],
  ["daten", /messdaten|messung|datenerhebung|datenauswertung/i],
];

export function clarificationsOf(befund: string | null): Clarification[] {
  if (!befund) return [];
  return CLARIFICATION_RX.filter(([, rx]) => rx.test(befund)).map(([k]) => k);
}
