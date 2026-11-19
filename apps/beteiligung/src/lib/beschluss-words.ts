/**
 * The way back (Stephan, paper v10, "Nach dem Bericht: Der Rückweg"): after the council has
 * decided, the town notes for each statement how it was handled — from a closed list, plus one
 * sentence. Shared by the workspace, the results page and the tracking slip (no server imports).
 */

export const OUTCOMES = [
  { key: "uebernommen", label: "Übernommen", lower: "übernommen" },
  { key: "abgefedert", label: "Durch ein Instrument abgefedert", lower: "durch ein Instrument abgefedert" },
  { key: "zurueckgestellt", label: "Abgewogen und zurückgestellt", lower: "abgewogen und zurückgestellt" },
  { key: "gutachten", label: "Durch Gutachten geklärt", lower: "durch Gutachten geklärt" },
  { key: "nicht_beruecksichtigt", label: "Nicht berücksichtigt", lower: "nicht berücksichtigt" },
] as const;

export type Outcome = (typeof OUTCOMES)[number]["key"];

export const outcomeOf = (key: string) => OUTCOMES.find((o) => o.key === key) ?? null;

/** What the public sees once the decision is published: per statement (node id) its label and sentence. */
export interface PublicDecision {
  gremium: string;
  /** ISO date of the meeting. */
  datum: string | null;
  summary: string | null;
  points: Record<string, { outcome: Outcome; reason: string | null }>;
}

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const decisionDate = (d: string | null) => (d ? day.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : null);

/** "Ergebnis: abgewogen und zurückgestellt. Eine Härteklausel für …" */
export function outcomeSentence(p: { outcome: Outcome; reason: string | null }): string {
  const o = outcomeOf(p.outcome);
  const reason = p.reason?.trim();
  return `Ergebnis: ${o?.lower ?? p.outcome}${reason ? `. ${reason.replace(/\.?$/, ".")}` : "."}`;
}

/** "Der Gemeinderat hat am 12. November 2026 entschieden." */
export function decisionHead(d: PublicDecision): string {
  const when = decisionDate(d.datum);
  return `Der ${d.gremium} hat${when ? ` am ${when}` : ""} entschieden.`;
}
