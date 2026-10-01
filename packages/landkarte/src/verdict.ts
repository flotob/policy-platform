/**
 * The verdict per measure — the concept paper's four diagnoses (v7 §7) read
 * at the level of a whole measure: is this a clear value conflict, a sham
 * factual dispute, a design negotiation, or broad agreement? Computed from
 * the per-point diagnoses only (no AI), so it is as reproducible as they are.
 */

import type { Diag, Tone } from "./vocab.ts";

export type VerdictKey =
  | "wertkonflikt"
  | "scheinfaktenstreit"
  | "fakten-und-werte"
  | "tatsachen"
  | "werte"
  | "ausgestaltung"
  | "einig"
  | "duenn";

export interface Verdict {
  key: VerdictKey;
  title: string;
  /** What follows from it — who has to act. */
  text: string;
  tone: Tone;
}

export interface DiagCounts {
  /** Landkarten-Punkte without Lücken. */
  points: number;
  /** Points where both camps have enough voices for a profile. */
  withNumbers: number;
  counts: Partial<Record<Diag, number>>;
}

/** Below this share of points with camp numbers there is no picture yet. */
export const MIN_COVERAGE = 0.4;

const V: Record<VerdictKey, Omit<Verdict, "key">> = {
  wertkonflikt: {
    title: "Klarer Wertkonflikt",
    text: "Über die Tatsachen sind sich die Lager einig oder sie sind überbrückt. Was sie trennt, ist eine Wertung. Weitere Faktendebatten helfen hier nicht: Das gehört auf die politische Leitungsebene.",
    tone: "political",
  },
  scheinfaktenstreit: {
    title: "Scheinfaktenstreit",
    text: "Die Lager teilen die Werte. Strittig sind Tatsachen. Das ist der günstigste Konflikt: Ein Gutachten kann ihn auflösen.",
    tone: "evidence",
  },
  "fakten-und-werte": {
    title: "Streit um Fakten und Werte",
    text: "Die Lager streiten über Tatsachen und über Wertungen zugleich. Erst die Tatsachen klären, dann liegt der politische Kern frei.",
    tone: "political",
  },
  tatsachen: {
    title: "Vor allem Tatsachenfragen",
    text: "Die meisten Streitpunkte sind Tatsachenfragen. Gutachten können einen großen Teil des Streits auflösen.",
    tone: "evidence",
  },
  werte: {
    title: "Vor allem Wertfragen",
    text: "Die meisten Streitpunkte sind Wertungen. Sie gehören auf die politische Leitungsebene, nicht auf die Fachebene.",
    tone: "political",
  },
  ausgestaltung: {
    title: "Vor allem Streit um die Ausgestaltung",
    text: "Über das Ob wird wenig gestritten, über das Wie viel: Fristen, Grenzen, Ausnahmen. Das ist Verhandlungssache.",
    tone: "design",
  },
  einig: {
    title: "Weitgehend einig",
    text: "In den meisten Punkten stimmen beide Lager zu. Hier lässt sich auf breiter Grundlage entscheiden.",
    tone: "bridge",
  },
  duenn: {
    title: "Noch kein klares Bild",
    text: "Zu wenige Organisationen haben sich zu diesen Fragen geäußert, um die Lager zu vergleichen.",
    tone: "open",
  },
};

export function verdictOf(d: DiagCounts): Verdict {
  const c = (k: Diag) => d.counts[k] ?? 0;
  const fact = c("klaerbar");
  const value = c("wert") + c("kern");
  const design = c("gestaltung");
  const bridges = c("bruecke") + c("warnung");
  const splits = fact + value + design;
  const pick = (key: VerdictKey): Verdict => ({ key, ...V[key] });

  if (d.points === 0 || d.withNumbers / d.points < MIN_COVERAGE) return pick("duenn");
  if (splits === 0) return pick(bridges > 0 ? "einig" : "duenn");
  // The paper's two pure patterns first.
  if (fact === 0 && value >= 1 && design <= value) return pick("wertkonflikt");
  if (value === 0 && fact >= 1 && design <= fact) return pick("scheinfaktenstreit");
  if (bridges > splits) return pick("einig");
  if (fact >= 1 && value >= 1 && Math.abs(fact - value) <= 1 && Math.min(fact, value) >= design) return pick("fakten-und-werte");
  if (design > fact && design > value) return pick("ausgestaltung");
  return pick(value >= fact ? "werte" : "tatsachen");
}
