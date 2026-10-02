/**
 * The Landkarte's vocabulary in plain German — one place for labels,
 * one-line explanations, and the colour token each diagnosis owns
 * (concept paper v7 §5/§7; diagnose-map.ts computes the keys).
 */

export type Diag = "bruecke" | "warnung" | "klaerbar" | "wert" | "kern" | "gestaltung" | "offen" | "luecke";
export type Typ = "T" | "W" | "verfahren" | "luecke";
export type Bezirk = "wirkung" | "machbarkeit" | "kosten" | "alternativen" | "wert" | "ausgestaltung";
export type Door = "empirics" | "alternatives" | "goal_conflict" | "feasibility" | "value_conflict";

/** Colour tokens (CSS custom properties in styles.css). */
export type Tone = "bridge" | "evidence" | "political" | "design" | "open";

export interface DiagMeta {
  label: string;
  /** One sentence: what this means and what follows from it. */
  explain: string;
  /** Who resolves it — the paper's zones. */
  resolver: string;
  tone: Tone;
  dashed?: boolean;
}

export const DIAG: Record<Diag, DiagMeta> = {
  bruecke: {
    label: "Brücke",
    explain: "Beide Lager stimmen zu, aus denselben Gründen. Darauf lässt sich bauen.",
    resolver: "Konsens",
    tone: "bridge",
  },
  warnung: {
    label: "Scheinbrücke",
    explain: "Beide Lager stimmen zu, aber aus unvereinbaren Gründen. Die Einigkeit trägt nicht weit.",
    resolver: "Redaktion prüft",
    tone: "political",
    dashed: true,
  },
  klaerbar: {
    label: "Klärbar durch Gutachten",
    explain: "Eine Tatsachenfrage trennt die Lager. Daten, ein Gutachten oder Vergleichsfälle können sie klären.",
    resolver: "Gutachter",
    tone: "evidence",
  },
  wert: {
    label: "Wertfrage",
    explain: "Eine Wertung trennt die Lager. Keine Studie kann das entscheiden, nur die Politik.",
    resolver: "Politik",
    tone: "political",
  },
  kern: {
    label: "Kernkonflikt",
    explain: "Die Wertfrage, bei der die Lager am weitesten auseinanderliegen. Sie gehört auf die Leitungsebene.",
    resolver: "Politik",
    tone: "political",
  },
  gestaltung: {
    label: "Streit um die Ausgestaltung",
    explain: "Die Lager streiten, wie die Regel aussehen soll: Fristen, Grenzen, Ausnahmen. Das ist Verhandlungssache.",
    resolver: "Verhandlung",
    tone: "design",
  },
  offen: {
    label: "Offen",
    explain: "Zu wenige Organisationen aus einem Lager haben sich geäußert, um etwas zu sagen.",
    resolver: "Mehr Beteiligung",
    tone: "open",
  },
  luecke: {
    label: "Lücke",
    explain: "Diese kritische Frage hat in den Stellungnahmen niemand gestellt.",
    resolver: "Aktiv nachfragen",
    tone: "open",
    dashed: true,
  },
};

export const DIAG_ORDER: Diag[] = ["kern", "wert", "klaerbar", "gestaltung", "warnung", "bruecke", "offen", "luecke"];

export const TYP: Record<Typ, { label: string; explain: string }> = {
  T: { label: "Tatsache", explain: "Eine Behauptung über die Welt. Belege können sie klären." },
  W: { label: "Wertung", explain: "Eine Abwägung von Werten. Sie entscheidet die Politik." },
  verfahren: { label: "Ausgestaltung", explain: "Ein Instrument: wie die Regel aussehen soll, wenn sie kommt." },
  luecke: { label: "Lücke", explain: "Eine kritische Frage, die niemand gestellt hat." },
};

export const BEZIRK: Record<Bezirk, { label: string; question: string }> = {
  wirkung: { label: "Wirkung", question: "Wirkt die Maßnahme so, wie behauptet?" },
  machbarkeit: { label: "Machbarkeit", question: "Lässt sie sich praktisch umsetzen?" },
  kosten: { label: "Kosten und Nebenfolgen", question: "Was kostet sie, und welches andere Ziel leidet?" },
  alternativen: { label: "Alternativen", question: "Erreicht ein anderes Mittel dasselbe besser?" },
  wert: { label: "Wertfragen", question: "Wie schwer wiegt der Wert gegen das, was er kostet?" },
  ausgestaltung: { label: "Ausgestaltung", question: "Wenn die Regel kommt: in welcher Form?" },
};

/** The five critical questions (paper §4) — every objection comes in through one of these doors. */
export const DOOR: Record<Door, { label: string; question: string }> = {
  empirics: { label: "Empirie-Frage", question: "Tritt die Wirkung wirklich ein?" },
  alternatives: { label: "Alternativen-Frage", question: "Erreicht ein anderes Mittel dasselbe Ziel günstiger oder schonender?" },
  goal_conflict: { label: "Zielkonflikt-Frage", question: "Verletzt die Maßnahme nebenbei ein anderes Ziel?" },
  feasibility: { label: "Machbarkeits-Frage", question: "Lässt sich das praktisch umsetzen?" },
  value_conflict: { label: "Wertkonflikt-Frage", question: "Wie schwer wiegt der Wert gegen das, was wir dafür opfern?" },
};

export const WHOLE = "übergreifend";
export const BEYOND = "Über den Entwurf hinaus";

/** How a measure scope reads in the interface. */
export function displayScope(scope: string): string {
  return scope === WHOLE ? "Das Vorhaben als Ganzes" : scope;
}

export function slugOf(scope: string): string {
  return displayScope(scope)
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Short organisation names for tight spaces (the full name stays in titles). */
export function shortOrg(org: string): string {
  const known: Record<string, string> = {
    "Bundesvereinigung der kommunalen Spitzenverbände": "Kommunale Spitzenverbände",
    "BDEW Bundesverband der Energie- und Wasserwirtschaft": "BDEW",
    "Haus & Grund Deutschland": "Haus & Grund",
    "Stadtwerke München GmbH": "Stadtwerke München",
    "Deutsche Umwelthilfe e. V.": "Deutsche Umwelthilfe",
    "Zentralverband des Deutschen Handwerks": "ZDH",
    "Verband kommunaler Unternehmen e. V. (VKU)": "VKU",
    "Dr.-Ing. Helmut Waniczek (Sachverständiger, Einzelperson)": "Waniczek",
    "Agora Energiewende": "Agora Energiewende",
    "Deutscher Verein des Gas- und Wasserfaches e. V. (DVGW)": "DVGW",
    "ZIA Zentraler Immobilien Ausschuss e. V.": "ZIA",
  };
  if (known[org]) return known[org];
  // "BDEW – Bundesverband der …" → "BDEW"; "NABU (Naturschutzbund …)" → "NABU".
  const acronym = /^([A-ZÄÖÜ][A-Za-zÄÖÜäöü&.-]{1,9})\s+(?:[–-]\s+|\()/.exec(org)?.[1];
  if (acronym && /[A-ZÄÖÜ].*[A-ZÄÖÜ]/.test(acronym)) return acronym;
  // "Nordrhein-Westfalen: Ministerium für …" → "Nordrhein-Westfalen (Ministerium)".
  const land = /^([A-ZÄÖÜ][\wäöüß-]+): (Ministerium|Staatsministerium|Behörde)\b/.exec(org);
  if (land) return `${land[1]} (${land[2]})`;
  return org.replace(/\s+e\.\s?V\.?$/, "");
}

/** Short names, unique within one consultation: a short name two senders share falls back to the full name. */
export function shortNames(names: string[]): Map<string, string> {
  const short = new Map(names.map((n) => [n, shortOrg(n)]));
  const count = new Map<string, number>();
  for (const s of short.values()) count.set(s, (count.get(s) ?? 0) + 1);
  for (const [n, s] of short) if ((count.get(s) ?? 0) > 1) short.set(n, n.replace(/\s+e\.\s?V\.?$/, ""));
  return short;
}

export const nf = new Intl.NumberFormat("de-DE");
