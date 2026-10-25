/** Plain German for everything the machine stores as a key. */

export const TYP = {
  T: { label: "Tatsache", text: "Daten, Studien oder Erfahrung können es klären." },
  W: { label: "Wertung", text: "Eine Frage, was richtig, gerecht oder zumutbar ist. Das entscheidet der Rat." },
  verfahren: { label: "Ausgestaltung", text: "Ein Vorschlag, wie die Maßnahme gestaltet wird: Frist, Ausnahme, Förderung." },
} as const;

export const RICHTUNG = {
  stuetzt: "stützt",
  greift_an: "greift an",
} as const;

export const BELEG = {
  keine: "ohne Beleg",
  behauptung: "behauptet, ohne Quelle",
  vergleichsfall: "mit Vergleichsfall",
  studie: "mit Studie oder Gutachten",
  messdaten: "mit eigenen Zahlen",
} as const;

/** What the machine's review flags mean, for the editors. */
export const FLAG = {
  personal_data: "Enthält vielleicht Angaben zu einer Privatperson.",
  meta: "Vielleicht nur Gruß, Dank oder Kritik am Verfahren.",
  off_topic: "Hat vielleicht nichts mit der Maßnahme zu tun.",
  not_standalone: "Ist ohne die Stellungnahme vielleicht nicht verständlich.",
  several_claims: "Enthält vielleicht mehr als eine Behauptung.",
  not_neutral: "Ist vielleicht nicht neutral formuliert.",
  reason_clause: "Hängt vielleicht eine Begründung an; über die stimmt man getrennt ab.",
  frage_passt_nicht: "Die Prüffrage passte nicht zum Schritt und wurde angepasst.",
  etikett_pruefen: "Tatsache oder Wertung passt nicht zur Prüffrage.",
} as const;

export const REJECT = {
  kein_argument: "Kein Sachargument",
  ausserhalb: "Betrifft nicht die Maßnahme",
  persoenlich: "Persönliche Daten oder Angriff",
  doppelt: "Steht schon da",
} as const;

export type RejectKey = keyof typeof REJECT;

/** Who decided, in words. */
export function actorName(actor: string | null, names: Record<string, string> = {}): string {
  if (!actor) return "";
  if (actor === "regel") return "automatisch zugeordnet";
  if (actor === "demo") return "für die Demo vorab freigegeben";
  if (actor.startsWith("ki")) return "von der Maschine";
  if (actor.startsWith("user:")) return names[actor.slice(5)] ? `von ${names[actor.slice(5)]}` : "von der Redaktion";
  return actor;
}

/** A probability as words an editor can act on. */
export function certainty(p: number): string {
  if (p >= 0.9) return "sehr sicher";
  if (p >= 0.7) return "ziemlich sicher";
  if (p >= 0.5) return "eher sicher";
  return "unsicher";
}
