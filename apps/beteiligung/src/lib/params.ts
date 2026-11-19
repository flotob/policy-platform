/**
 * Procedure parameters (Gesamtmodell E3) with their defaults. Stored per
 * campaign in campaigns.params; everything a municipality can tune lives
 * here, never as a constant in the pipeline (invariant I12).
 */

/** Who decides in the editorial queue (Florian 2026-10-25: a human gate, with an AI mode). */
export type EditorialMode = "mensch" | "assistiert" | "ki";

export interface CampaignParams {
  /** Door 1 vote, door 2 short statement (two sentences), door 3 full statement with attachments. */
  doors: { abstimmen: boolean; kurzaussage: boolean; stellungnahme: boolean };
  /** Planned period; the campaign can also end on saturation. */
  start: string | null;
  end: string | null;
  /** End early when this many inputs in a row brought no new point (B11). */
  saturationWindow: number;
  /** Matches at or above this confidence attach automatically; below go to the editors (Z5). */
  matchThreshold: number;
  /** Share of automatic matches the editors spot-check (Z9). */
  sampleRate: number;
  /** A bridge needs at least this agreement in every camp. */
  bridgeThreshold: number;
  /** Below this many participants no camps are computed. */
  minParticipants: number;
  editorialMode: EditorialMode;
  /** Open to everyone or only with an invite code. */
  access: "offen" | "einladung";
}

export const DEFAULT_PARAMS: CampaignParams = {
  doors: { abstimmen: true, kurzaussage: true, stellungnahme: true },
  start: null,
  end: null,
  saturationWindow: 100,
  matchThreshold: 0.8,
  sampleRate: 0.1,
  bridgeThreshold: 0.6,
  minParticipants: 50,
  editorialMode: "mensch",
  access: "offen",
};

export function paramsOf(stored: unknown): CampaignParams {
  const p = (stored && typeof stored === "object" ? stored : {}) as Partial<CampaignParams>;
  return { ...DEFAULT_PARAMS, ...p, doors: { ...DEFAULT_PARAMS.doors, ...(p.doors ?? {}) } };
}

export const EDITORIAL_MODES: Record<EditorialMode, { label: string; text: string }> = {
  mensch: {
    label: "Redaktion entscheidet",
    text: "Jeder neue Punkt wird von einem Menschen aus Ihrer Verwaltung geprüft und freigegeben. Die Maschine macht Vorschläge.",
  },
  assistiert: {
    label: "Maschine schlägt vor, Redaktion bestätigt",
    text: "Die Maschine trifft eine vorläufige Entscheidung; die Redaktion bestätigt oder korrigiert sie mit einem Klick.",
  },
  ki: {
    label: "Maschine entscheidet, Redaktion prüft Stichproben",
    text: "Die Maschine entscheidet allein, die Redaktion prüft einen Teil nach. Der Bericht weist aus, dass ohne menschliche Freigabe gearbeitet wurde.",
  },
};

/**
 * The four steps of a justification (the artifact's step model, Florian
 * 2026-10-25) — close to the proportionality test: the situation, suitable,
 * necessary, appropriate.
 */
export const STEPS = [
  { key: "lage", label: "So ist die Lage", hint: "Die Tatsachen, von denen die Maßnahme ausgeht." },
  { key: "wirkung", label: "Das bewirkt unser Vorhaben", hint: "Was sich ändert, wenn die Stadt sie beschließt." },
  { key: "weg", label: "So kommen wir ans Ziel", hint: "Warum der Weg gangbar ist und besser als die Alternativen." },
  { key: "eingriff", label: "Dafür lohnt sich der Eingriff", hint: "Warum die Last für die Betroffenen zumutbar ist." },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
export type Steps = Partial<Record<StepKey, string>>;

/**
 * The five objections (critical questions) and the step each one attacks (a parameter, not code:
 * Stephan may remap). Wording from Stephan's deck (Nov 2026) where it means the same; "lage" in the
 * same style. His v10 model (P3 Ziel, P4 Wert, "Es lässt sich nicht umsetzen") is a later switch.
 */
export const QUESTIONS = [
  { key: "lage", label: "Die Lage ist eine andere", steps: ["lage"] },
  { key: "wirkung", label: "Die Wirkung tritt nicht ein", steps: ["wirkung"] },
  { key: "weg", label: "Es geht auch anders", steps: ["weg"] },
  { key: "nebenfolgen", label: "Ein anderer Wert leidet darunter", steps: ["lage", "eingriff"] },
  { key: "wert", label: "Das ist es nicht wert", steps: ["eingriff"] },
] as const;

export const STATES = {
  entwurf: { label: "Entwurf", text: "Noch nicht vorbereitet. Nur Ihre Verwaltung sieht das Verfahren." },
  vorbereitung: { label: "Vorbereitung", text: "Die Maschine wertet Begründung und Unterlagen aus, die Redaktion gibt die ersten Punkte frei." },
  offen: { label: "Offen", text: "Bürgerinnen und Bürger beteiligen sich." },
  auswertung: { label: "Auswertung", text: "Die Beteiligung ist geschlossen; Lager und Befunde werden gerechnet." },
  bericht: { label: "Bericht", text: "Der Bericht wird geschrieben und geprüft." },
  veroeffentlicht: { label: "Veröffentlicht", text: "Bericht und Landkarte sind öffentlich." },
} as const;

export type CampaignState = keyof typeof STATES;
