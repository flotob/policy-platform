/**
 * Render the pipeline methodology page — ONE integrated board: the
 * Verfahren timeline (paper §8/§12) as horizontal columns T0-T5, with the
 * full pipeline station cards hanging beneath the phase in which they run.
 * Strand membership (§7 complementarity: structure / people, meeting at
 * the diagnosis hinge) survives as the cards' colored left edge. All
 * system prompts are inlined from the running package ("inspectable by
 * construction"). Horizontally scrollable; desktop-first by decision.
 *
 * No DB, no LLM. Usage:
 *   tsx scripts/render-pipeline.ts [--out ../../../docs/landkarte]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CUT_QUESTION } from "../src/extract.ts";
import { intakeRequest } from "../src/intake.ts";
import { mapAssignQuestion, REASONS_SCREEN, sameQuestion } from "../src/jev-map.ts";
import { RELATION_LEVELS } from "../src/jev-match.ts";
import { relationRequest } from "../src/jev-relations.ts";
import { stanceQuestion } from "../src/jev-stance.ts";
import { measureQuestion } from "../src/measures.ts";
import {
  BEFUND_SYSTEM,
  BILL_MEASURES_SYSTEM,
  CONDENSE_PROPOSE_SYSTEM,
  EDITOR_SYSTEM,
  extractSystem,
  MATCH_SYSTEM,
  NAME_CAMPS_SYSTEM,
  REASONS_CHECK_SYSTEM,
} from "../src/prompts.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Kind = "ki" | "jev" | "det" | "plan";

const KIND: Record<Kind, { label: string; fg: string; bg: string; border: string }> = {
  ki: { label: "KI schreibt — Sprachmodell", fg: "#0C447C", bg: "#DCE9F6", border: "#185FA5" },
  jev: { label: "KI entscheidet — Jev, mit Wahrscheinlichkeit", fg: "#4B2E83", bg: "#ECE6F7", border: "#6A4BB0" },
  det: { label: "Gerechnet — keine KI", fg: "#085041", bg: "#DFF1EA", border: "#0F6E56" },
  plan: { label: "Geplant — noch nicht gebaut", fg: "#444441", bg: "transparent", border: "#5F5E5A" },
};

/** Jev questions, readable: name, kind of judgment, question, answer options. */
type JevQuestion = { type: string; instructions: unknown; criteria?: Record<string, unknown> | readonly string[] };
function questionsText(qs: Record<string, unknown>): string {
  return Object.entries(qs)
    .map(([name, raw]) => {
      const q = raw as JevQuestion;
      const instr = typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions, null, 1);
      const crit = q.criteria
        ? Array.isArray(q.criteria)
          ? (q.criteria as string[]).map((v, i) => `   ${i}: ${v}`).join("\n")
          : Object.entries(q.criteria).map(([k, v]) => `   – ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")
        : "";
      const kind = q.type === "noul" ? "ja/nein, als Wahrscheinlichkeit" : q.type === "choice" ? "Auswahl" : "Skala";
      return `[${name} · ${kind}] ${instr}${crit ? `\n${crit}` : ""}`;
    })
    .join("\n\n");
}

interface Station {
  /** Stable identity for anchors and cross-references — display codes
   *  (T1.2 …) are computed from board position and may change. */
  key: string;
  strand: "st" | "sa" | "sb" | "sh";
  name: string;
  script: string | null;
  kinds: Kind[];
  text: string;
  note?: string;
  prompts?: { label: string; text: string }[];
  /** Jev question families, shown verbatim like the prompts. */
  questions?: { label: string; text: string }[];
}

const EXAMPLE = { label: "…", summary: "…" };

/** Shared trunk: everything downstream depends on these. */
const TRUNK: Station[] = [
  {
    key: "import",
    strand: "st",
    name: "Import & Aufbereitung",
    script: "harvester · import-harvest.ts · import-documents.ts",
    kinds: ["det"],
    text: "Stellungnahmen, Fragebögen und Anhänge werden aus den Quellsystemen geholt und unverändert gespeichert — dazu der Entwurf selbst (Gesetzentwurf, Beschlussvorlage), aus dem der Zuschnitt in Maßnahmen kommt.",
    note: "Nur im Anlauf: Im Dauerbetrieb (T2) kommt neues Material durch die drei Türen herein, nicht per Import.",
  },
  {
    key: "zerlegung",
    strand: "st",
    name: "Zerlegung",
    script: "extract.ts",
    kinds: ["jev", "ki"],
    text: "Lange Stellungnahmen werden in Abschnitte geteilt — dort, wo Jev einen Themenwechsel erkennt, nicht nach Zeichenzahl. Alle Abschnitte laufen gleichzeitig: Das Sprachmodell sieht jeweils die ganze Stellungnahme und schreibt die Punkte seines Abschnitts — jeder Punkt genau eine Behauptung, Tatsachen und Wertungen getrennt, Prämissen als eigene Punkte, dazu ein wörtliches Beleg-Zitat. Etikettieren muss das Sprachmodell nichts mehr; das entscheidet Jev in der nächsten Stufe.",
    prompts: [{ label: "Zerlegungs-Prompt", text: extractSystem(true) }],
    questions: [{ label: "Wo wird geschnitten?", text: questionsText({ schnitt: CUT_QUESTION("cN") }) }],
  },
  {
    key: "redaktion",
    strand: "st",
    name: "Automatische Redaktion",
    script: "extract.ts (refine)",
    kinds: ["jev", "ki"],
    text: "Jev prüft jeden Punkt in einer einzigen Anfrage: freigabefähig (eine Behauptung, für sich verständlich, sachlich, zum Thema, keine persönlichen Daten)? Welche Rolle — Behauptung, Einwand, Lösungsvorschlag, offene Frage —, durch welche der fünf Türen, Tatsache oder Wertung, welche Stelle im Grundmuster P1–P4? Findet Jev ein Problem, repariert es das Sprachmodell (teilen, umformulieren, streichen), und Jev prüft erneut. Die Redakteure sind Maschinen; jede Entscheidung ist protokolliert, damit ein Mensch sie jederzeit nachprüfen und umdrehen kann.",
    prompts: [{ label: "Redaktions-Prompt (Reparatur)", text: EDITOR_SYSTEM }],
    questions: [{ label: "Die Prüffragen je Punkt", text: questionsText(intakeRequest("…", EXAMPLE).questions) }],
  },
  {
    key: "abgleich",
    strand: "st",
    name: "Abgleich: bekannt oder neu?",
    script: "extract.ts (canonicalize)",
    kinds: ["jev", "ki"],
    text: "Jeder neue Punkt wird mit den ähnlichsten Punkten der Karte verglichen: dasselbe Argument, verwandt oder verschieden? Ab 50 % Wahrscheinlichkeit für „dasselbe“ wird zusammengeführt; Fälle zwischen 20 und 50 % entscheidet das Sprachmodell als Zweitmeinung. Unter einer Sekunde je Punkt — die Voraussetzung dafür, dass Tür 2 sofort antworten kann: „Das wurde schon gesagt“ oder „neu“.",
    prompts: [{ label: "Abgleich-Prompt (Zweitmeinung)", text: MATCH_SYSTEM }],
    questions: [{ label: "Wie verhält sich der neue Punkt zu einem bekannten?", text: questionsText({ bezug: { type: "score", instructions: "How does the candidate argument `candidate` relate to the existing map point `existing.pN`?", criteria: RELATION_LEVELS } }) }],
  },
];

/** Strand A: the structure of the dispute — needs no votes. */
const STRAND_A: Station[] = [
  {
    key: "zuschnitt",
    strand: "sa",
    name: "Zuschnitt aus dem Entwurf",
    script: "propose-measures-bill.ts",
    kinds: ["ki"],
    text: "Worüber entschieden wird, steht im Entwurf: Das Sprachmodell liest den Gesetzentwurf oder die Beschlussvorlage einmal und benennt die getrennt entscheidbaren Maßnahmen — jede mit ihren Paragraphen. Jede Maßnahme bekommt ihre eigene Landkarte; dazu „Das Vorhaben als Ganzes“ und „Über den Entwurf hinaus“.",
    note: "Im Zielverfahren bestätigt die Kommune den Zuschnitt; die KI schlägt vor.",
    prompts: [{ label: "Zuschnitt-Prompt", text: BILL_MEASURES_SYSTEM }],
  },
  {
    key: "zuordnung",
    strand: "sa",
    name: "Zuordnung zur Maßnahme",
    script: "assign-measures.ts",
    kinds: ["det", "jev", "ki"],
    text: "Jeder Punkt kommt zu der Maßnahme, die er betrifft. Nennt er seinen Paragraphen („§ 29 Abs. 7 streichen“), ordnet der Code direkt zu; sonst entscheidet Jev — und wo Jev unsicher ist, das Sprachmodell.",
    questions: [
      {
        label: "Welche Maßnahme betrifft der Punkt?",
        text: questionsText(measureQuestion([{ name: "<Maßnahme aus dem Entwurf>", description: "<was entschieden wird>", paragraphs: [0], other: [] }])),
      },
    ],
  },
  {
    key: "bezuege",
    strand: "sa",
    name: "Bezüge über alle Stellungnahmen",
    script: "relations.ts",
    kinds: ["jev"],
    text: "Wer stützt wen, wer greift wen an — durch welche der fünf Türen? Jev vergleicht jeden Punkt mit seinen 15 nächsten Nachbarn aus allen Stellungnahmen, beide Richtungen ausdrücklich. Mit dem Sprachmodell war das unbezahlbar; mit Jev kostet es für eine ganze Konsultation Cent-Beträge. So wird sichtbar, welches Argument wo beantwortet wird — und welches unbeantwortet steht.",
    questions: [{ label: "Wie hängen zwei Punkte zusammen?", text: questionsText(relationRequest("…", EXAMPLE, [EXAMPLE]).questions) }],
  },
  {
    key: "verdichtung",
    strand: "sa",
    name: "Verdichtung zu Landkarten-Punkten",
    script: "condense.ts",
    kinds: ["ki", "jev"],
    text: "Je Maßnahme sucht das Sprachmodell die Fragen, um die wirklich gestritten wird, und schreibt je Frage einen Satz, über den man abstimmen kann — höchstens 20; alle Maßnahmen gleichzeitig. Verschiedene Positionen zur selben Frage („Biomasse-Grenze anheben“, „senken“, „streichen“) werden ein Landkarten-Punkt; Gewicht entscheidet, was auf die Karte kommt (wie viele Organisationen etwas sagen). Jev prüft jedes Paar: Fragen zwei Punkte dasselbe? Dann ordnet Jev jeden Extraktionspunkt der Frage zu, zu der er Stellung nimmt. Was keiner Frage gehört — meist die Forderung einer einzelnen Organisation —, steht als Einzelforderung unter der Karte: nicht verloren, aber nicht zur Abstimmung.",
    note: "Im Dauerbetrieb (T2) arbeitet die Verdichtung inkrementell: Neue Punkte werden bestehenden Landkarten-Punkten zugeordnet oder als neue vorgeschlagen.",
    prompts: [{ label: "Verdichtungs-Prompt", text: CONDENSE_PROPOSE_SYSTEM }],
    questions: [
      { label: "Fragen zwei Landkarten-Punkte dasselbe?", text: questionsText({ gleiche_frage: sameQuestion("k1", "k2") }) },
      { label: "Zu welcher Frage nimmt der Punkt Stellung?", text: questionsText(mapAssignQuestion([{ label: "<Landkarten-Punkt>", question: "<Streitfrage>" }])) },
    ],
  },
];

/** Strand B: the people — they vote on the Landkarten-Punkte. */
const STRAND_B: Station[] = [
  {
    key: "tuer1",
    strand: "sb",
    name: "Tür 1: Abstimmen",
    script: null,
    kinds: ["plan"],
    text: "Die niedrigste Schwelle der Beteiligung: über die Landkarten-Punkte selbst abstimmen — zustimmen, ablehnen oder überspringen; einen Antworten-Knopf gibt es mit Absicht nicht. Die neue App dafür ist noch nicht gebaut; die Daten liegen schon in dieser Form vor.",
  },
  {
    key: "tuer2",
    strand: "sb",
    name: "Tür 2: Eigene Kurzaussage",
    script: null,
    kinds: ["plan"],
    text: "Zwei Sätze, sofort geprüft: Mit Jev läuft die Strecke S1–S3 in Sekunden — bekannt oder neu, freigabefähig, wohin gehört der Punkt. Das Bürger-Formular davor ist noch nicht gebaut.",
  },
  {
    key: "tuer3",
    strand: "sb",
    name: "Tür 3: Volle Stellungnahme",
    script: "extract.ts",
    kinds: ["ki", "jev"],
    text: "Der Verband, der vier Seiten mit Anlagen schickt: Die Stellungnahme fließt in die Zerlegung (S1) und durchläuft dieselbe Strecke wie alles andere.",
  },
  {
    key: "haltung",
    strand: "sb",
    name: "Haltung aus Stellungnahmen",
    script: "map-stances.ts",
    kinds: ["jev"],
    text: "Für eingereichte Stellungnahmen leitet Jev ab, wie jede Organisation zu jedem Landkarten-Punkt steht — Zustimmung, Ablehnung oder nicht angesprochen —, aus ihrem eigenen Text und mit Wahrscheinlichkeit. Nicht angesprochen heißt: keine Stimme. Für eine ganze Konsultation dauert das Sekunden; überall als „abgeleitet“ gekennzeichnet.",
    note: "Im echten Verfahren ergänzt diese Stufe die Live-Beteiligung (Stellungnahmen zählen mit), sie ersetzt sie nicht.",
    questions: [{ label: "Wie steht der Text zum Landkarten-Punkt?", text: questionsText({ haltung: stanceQuestion("<Landkarten-Punkt>", "<Streitfrage>") }) }],
  },
  {
    key: "analyse",
    strand: "sb",
    name: "Lager & Brücken",
    script: "camps.ts",
    kinds: ["det"],
    text: "Das Polis-Verfahren über den Stimmen zu den Landkarten-Punkten: Wer ähnlich stimmt, bildet ein Lager (PCA + k-means, deterministisch, differentialgetestet gegen die Referenz-Implementierung). Jeder Landkarten-Punkt bekommt sein Profil je Lager direkt — gezählt, nicht gemittelt.",
  },
  {
    key: "namen",
    strand: "sb",
    name: "Lager-Namen",
    script: "name-camps.ts",
    kinds: ["ki"],
    text: "Damit „Gruppe 0“ und „Gruppe 1“ lesbar werden, benennt ein Sprachmodell die Lager anhand der Punkte, die sie am deutlichsten trennen, und ihrer Mitglieder — reine Benennung, keine Zahl wird angefasst.",
    prompts: [{ label: "Lager-Namen-Prompt", text: NAME_CAMPS_SYSTEM }],
  },
];

/** Convergence: structure × people, then the report. */
const JOIN: Station[] = [
  {
    key: "diagnose",
    strand: "sh",
    name: "Diagnose je Punkt — das Scharnier",
    script: "diagnose-map.ts",
    kinds: ["det", "jev", "ki"],
    text: "Hier treffen sich Struktur und Menschen: Jeder Landkarten-Punkt hat sein Profil je Lager, gezählt („3 von 4 Organisationen dafür“), und daraus fällt die Diagnose aus festen Schwellen: Brücke der Gründe (beide Lager ≥ 60 %), klärbar durch Gutachten (Tatsachenpunkt, Lager ≥ 15 Punkte auseinander), Wertdifferenz, Streit um die Ausgestaltung (Gestaltungspunkt, Lager auseinander), Kernkonflikt (die größte Wert-Differenz der Maßnahme), offen (zu wenige Stimmen aus einem Lager). Türen ohne einen einzigen Einwand werden zu Lücken-Punkten. Scheinbrücken: Das Sprachmodell prüft jede Brücke mit genug Material — Jevs Vorprüfung ließ im ersten Lauf alle 53 Brücken durch und wird nur noch mitprotokolliert; ein Fund wird als Warnung markiert, nicht als Faktum.",
    prompts: [{ label: "Scheinbrücken-Check-Prompt", text: REASONS_CHECK_SYSTEM }],
    questions: [{ label: "Scheinbrücken-Frage (nur protokolliert)", text: questionsText({ verdacht: REASONS_SCREEN }) }],
  },
  {
    key: "befund",
    strand: "sh",
    name: "Befund je Punkt",
    script: "diagnose-map.ts (Befund-Teil)",
    kinds: ["ki"],
    text: "Zu jeder gerechneten Diagnose entsteht der Befund: zwei bis fünf Sätze Klartext — was die Zählungen zeigen, was daraus für das Verfahren folgt (Kurzgutachten? Ratsentscheidung? Lücke schließen?), was im Material dahintersteht. Die Diagnose selbst ist dem Modell vorgegeben und unantastbar.",
    prompts: [{ label: "Befund-Prompt (mit Bindungsregel)", text: BEFUND_SYSTEM }],
  },
  {
    key: "landkarte",
    strand: "sh",
    name: "Die Landkarte",
    script: "render-landkarte.ts",
    kinds: ["det"],
    text: "Je Maßnahme eine eigenständige Seite: das Grundmuster als Leiste, die Zone der Gutachter mit ihren Bezirken, die Zone des Rates, die Ausgestaltung — jeder Punkt mit Zählung je Lager, Befund, Originalzitaten samt Lager der Organisation und aufklappbarer Beleg-Schicht. Reines Rendern, keine KI.",
  },
];

/** The Verfahren board (Zielbild, paper §8 + §12): one integrated diagram —
 *  timeline columns left to right, the FULL pipeline station cards hanging
 *  beneath the phase in which they run. Horizontally scrollable (desktop). */
interface Mini {
  label: string;
  key: string;
  note: string;
}
interface Column {
  code: string;
  title: string;
  dur: string;
  text: string;
  sat?: string;
  cls?: string;
  cards: Station[];
  minis?: Mini[];
}

function byKey(all: Station[], key: string): Station {
  const f = all.find((x) => x.key === key);
  if (!f) throw new Error(`station ${key} not found`);
  return f;
}

const ALL = [...TRUNK, ...STRAND_A, ...STRAND_B, ...JOIN];
const n = (key: string) => byKey(ALL, key);

/** T0 and T3-T5 as plain columns; T1+T2 are the merged group below. */
function outerColumns(): { before: Column[]; after: Column[] } {
  return {
    before: [
      {
        code: "T0",
        title: "T0 · Anlass & Zuschnitt",
        dur: "Woche 0",
        text: "Die Kommune beschließt das Verfahren und legt fest, worüber entschieden wird: Der Zuschnitt kommt aus der Beschlussvorlage selbst — jede Teilentscheidung bekommt ihre eigene Landkarte. Die KI liest den Entwurf und schlägt vor; die Kommune bestätigt.",
        cards: [n("zuschnitt")],
      },
    ],
    after: [
      {
        code: "T3",
        title: "T3 · Auswertung",
        dur: "≈ 1 Woche",
        text: "Finale Analyse über dem vollständigen Material: Lager und Brücken, Diagnose je Punkt, Lücken, Scheinbrücken-Prüfung, Befunde.",
        cards: [n("analyse"), n("namen"), n("diagnose"), n("befund")],
      },
      {
        code: "T4",
        title: "T4 · Bericht & Entscheidung",
        dur: "Ratsbefassung",
        text: "Landkarten und Bericht gehen an den Rat: Brücken als konsensfähige Beschlussteile, Klärfälle mit Gutachten-Empfehlung, Wertungspunkte als ausgewiesene politische Entscheidungen. Erfolgskriterium des Papiers: Der Rat zitiert den Bericht in der Beschlussvorlage.",
        cards: [n("landkarte")],
      },
      {
        code: "T5",
        title: "T5 · Nach der Entscheidung",
        dur: "Perspektive",
        text: "Gutachten kommen zurück, Klärfälle werden auf der Karte tatsächlich geklärt, die Landkarte lebt als Gedächtnis des Verfahrens weiter (Evidenz-Graph — Zukunft).",
        cls: "col-t5",
        cards: [],
      },
    ],
  };
}

/** T1+T2 as one group: the shared Verarbeitungsstrecke spans both phases —
 *  same machinery, two operating modes (batch over the Bestand / streaming
 *  per contribution). Only the inputs differ. */
const T12 = {
  t1: {
    title: "T1 · Vorbereitung — der Anlauf",
    dur: "≈ 2 Wochen",
    text: "Der vorhandene Bestand — Beschlussvorlage samt Begründung, Gutachten, Stellungnahmen aus Träger- und Verbändebeteiligung — läuft einmal komplett im Stapel durch die Verarbeitungsstrecke (S1–S6), alle Abschnitte gleichzeitig: für ein Verfahren in der Größe des Wärmeplanungsgesetzes in rund einer halben Stunde.",
  },
  t2: {
    title: "T2 · Offene Beteiligung — der Dauerbetrieb",
    dur: "≈ 3 Wochen",
    text: "Dieselbe Strecke läuft weiter, jetzt gespeist aus den drei Türen — je Beitrag statt im Stapel. Neue Punkte gehen nach Freigabe selbst in die Abstimmung: der Rückkanal, keine eingefrorene Landkarte.",
    sat: "endet bei Sättigung, nicht nach Kalender — „es kommt seit zehn Tagen nichts Neues mehr“ (§10)",
  },
  strecke: ["zerlegung", "redaktion", "abgleich", "zuordnung", "bezuege", "verdichtung"].map(n),
  t1Only: ["import"].map(n),
  t2Only: ["tuer1", "tuer2", "tuer3", "haltung"].map(n),
  t2Minis: [
    {
      label: "↻ Lagerbildung",
      key: "analyse",
      note: "läuft nächtlich mit — Lager und Brücken aktualisieren sich während der Beteiligung",
    },
  ] as Mini[],
};

/** Display codes from board position: T0.1, S1-S6, T1.1, T2.1 …, T3.1 … */
function codeMap(): Map<string, string> {
  const m = new Map<string, string>();
  const oc = outerColumns();
  for (const c of [...oc.before, ...oc.after])
    c.cards.forEach((st, i) => m.set(st.key, `${c.code}.${i + 1}`));
  T12.strecke.forEach((st, i) => m.set(st.key, `S${i + 1}`));
  T12.t1Only.forEach((st, i) => m.set(st.key, `T1.${i + 1}`));
  T12.t2Only.forEach((st, i) => m.set(st.key, `T2.${i + 1}`));
  return m;
}

function miniHtml(m: Mini, codes: Map<string, string>): string {
  return `<a class="mini" href="#st-${m.key}"><strong>${esc(m.label)}</strong><span>${esc(m.note)} (→ ${codes.get(m.key) ?? ""})</span></a>`;
}

function columnHtml(c: Column, codes: Map<string, string>): string {
  return `<div class="col ${c.cls ?? ""}">
    <div class="col-head">
      <div class="tl-head">${esc(c.title)}</div>
      <div class="tl-dur">${esc(c.dur)}</div>
      <p>${esc(c.text)}</p>
      ${c.sat ? `<p class="tl-sat">┄ ${esc(c.sat)}</p>` : ""}
    </div>
    ${c.cards.map((st) => stationHtml(st, codes.get(st.key) ?? "")).join("")}
    ${(c.minis ?? []).map((m) => miniHtml(m, codes)).join("")}
  </div>`;
}

function t12Html(codes: Map<string, string>): string {
  const head = (h: { title: string; dur: string; text: string; sat?: string }) => `
    <div class="col-head">
      <div class="tl-head">${esc(h.title)}</div>
      <div class="tl-dur">${esc(h.dur)}</div>
      <p>${esc(h.text)}</p>
      ${h.sat ? `<p class="tl-sat">┄ ${esc(h.sat)}</p>` : ""}
    </div>`;
  return `<div class="t12">
    ${head(T12.t1)}
    ${head(T12.t2)}
    <div class="band">
      <div class="band-title">Die Verarbeitungsstrecke — identisch in T1 und T2</div>
      <div class="band-sub">in T1 als Stapel über den Bestand · in T2 laufend über jeden neuen Beitrag (jede Stufe ist idempotent — Dauerbetrieb heißt: dieselben Stufen laufen wiederholt)</div>
      <div class="band-cards">${T12.strecke.map((st) => stationHtml(st, codes.get(st.key) ?? "")).join("")}</div>
    </div>
    <div class="t12-sub">
      <div class="sub-label">Nur im Anlauf (T1)</div>
      ${T12.t1Only.map((st) => stationHtml(st, codes.get(st.key) ?? "")).join("")}
    </div>
    <div class="t12-sub">
      <div class="sub-label">Nur im Dauerbetrieb (T2)</div>
      ${T12.t2Only.map((st) => stationHtml(st, codes.get(st.key) ?? "")).join("")}
      ${T12.t2Minis.map((m) => miniHtml(m, codes)).join("")}
    </div>
  </div>`;
}

function badge(k: Kind): string {
  const m = KIND[k];
  const dashed = k === "plan" ? "border-style:dashed;" : "";
  return `<span class="badge" style="color:${m.fg};background:${m.bg};border:1px solid ${m.border};${dashed}">${m.label}</span>`;
}

function stationHtml(s: Station, code: string): string {
  const prompts =
    (s.prompts ?? [])
      .map(
        (p) =>
          `<details class="prompt"><summary>Prompt ansehen: ${esc(p.label)}</summary><pre>${esc(p.text)}</pre></details>`,
      )
      .join("") +
    (s.questions ?? [])
      .map(
        (q) =>
          `<details class="prompt prompt-jev"><summary>Jev-Fragen ansehen: ${esc(q.label)}</summary><pre>${esc(q.text)}</pre></details>`,
      )
      .join("");
  return `<div class="station strand-${s.strand}${s.kinds.includes("plan") ? " station-plan" : ""}" id="st-${s.key}">
    <div class="station-head">
      <span class="station-num">${code}</span>
      <strong>${esc(s.name)}</strong>
      ${s.script ? `<code>${esc(s.script)}</code>` : ""}
    </div>
    <div class="station-badges">${s.kinds.map(badge).join("")}</div>
    <p>${esc(s.text)}</p>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    ${prompts}
  </div>`;
}

function main() {
  const outDir = resolve(arg("out") ?? "../../../docs/landkarte");
  mkdirSync(outDir, { recursive: true });

  const today = new Date().toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Die Pipeline — So entsteht die Landkarte des Streits</title>
<style>
  body { margin:0; background:#FBFAF6; color:#1C1E24; line-height:1.55;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 56rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  .narrow { max-width: 34rem; margin-left:auto; margin-right:auto; }
  .kicker { font-size:.75rem; letter-spacing:.1em; text-transform:uppercase; color:#6B6E76; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight:500; font-size:1.875rem; margin:.25rem 0 0; }
  .sub { font-size:.9rem; color:#6B6E76; margin-top:.5rem; max-width:46rem; }
  .principle { margin-top:1rem; background:#FFF; border:1px solid #E3E1D8; border-left:4px solid #0F6E56;
    border-radius:.6rem; padding:.8rem 1rem; font-size:.9rem; max-width:46rem; }
  .legend { margin-top:.9rem; display:flex; flex-wrap:wrap; gap:.4rem; }
  .badge, .phase-chip { font-size:.68rem; border-radius:9999px; padding:.12rem .55rem; white-space:nowrap; }
  .phase-chip { color:#9A6A14; border:1px solid #E4C990; background:#FBF3E0; margin-left:auto; }
  .seg-title { font-family:Georgia,serif; font-weight:500; font-size:1.2rem; margin:1.8rem 0 .1rem; text-align:center; }
  .seg-sub { font-size:.8rem; color:#6B6E76; text-align:center; margin:0 0 .7rem; }
  .board-scroll { overflow-x:auto; margin-top:.6rem; padding-bottom:.6rem;
    width:calc(100vw - 2rem); margin-left:50%; transform:translateX(-50%); }
  .board { display:flex; gap:.7rem; align-items:flex-start; width:max-content; padding:0 .2rem; }
  .col { width:360px; flex:0 0 auto; background:#F1EFE8; border:1px solid #E3E1D8;
    border-radius:.9rem; padding:.55rem; }
  .col-t5 { background:transparent; border-style:dashed; }
  .col-head { padding:.35rem .45rem .5rem; }
  .tl-head { font-family:Georgia,serif; font-size:1rem; font-weight:500; }
  .tl-dur { font-size:.66rem; color:#9A6A14; text-transform:uppercase; letter-spacing:.06em; margin-top:.05rem; }
  .col-head p { font-size:.76rem; margin:.35rem 0 0; color:#3D4046; }
  .tl-sat { color:#9A6A14 !important; font-style:italic; border-top:1px dashed #E4C990; padding-top:.3rem; margin-top:.45rem !important; }
  .station { position:relative; background:#FFF; border:1px solid #E3E1D8; border-radius:.75rem;
    padding:.8rem .9rem; margin:.5rem 0 0; border-left-width:4px; }
  .strand-st { border-left-color:#6B6E76; }
  .strand-sa { border-left-color:#0F6E56; }
  .strand-sb { border-left-color:#1E4A7A; }
  .strand-sh { border-left-color:#9A6A14; }
  .station-plan { border-style:dashed; border-left-style:solid; background:transparent; }
  .station-head { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; }
  .station-num { min-width:1.55rem; height:1.55rem; border-radius:50%; background:#FBFAF6;
    border:2px solid #B4B8A9; color:#6B6E76; font-size:.66rem; font-weight:600;
    display:inline-flex; align-items:center; justify-content:center; padding:0 .2rem; }
  .station-head strong { font-size:.88rem; }
  .station-head code { font-size:.66rem; color:#6B6E76; background:#F1EFE8; border-radius:.25rem; padding:.1rem .35rem; }
  .station-badges { display:flex; align-items:center; gap:.3rem; flex-wrap:wrap; margin-top:.35rem; }
  .station p { font-size:.8rem; margin:.45rem 0 0; }
  .note { color:#9A6A14; background:#FBF3E0; border-radius:.4rem; padding:.4rem .55rem; font-size:.74rem !important; }
  details.prompt { margin-top:.45rem; font-size:.78rem; }
  details.prompt summary { cursor:pointer; color:#1E4A7A; }
  details.prompt-jev summary { color:#4B2E83; }
  details.prompt pre { white-space:pre-wrap; background:#F1EFE8; border:1px solid #E3E1D8;
    border-radius:.5rem; padding:.6rem .8rem; font-size:.68rem; line-height:1.5; margin:.35rem 0 0; }
  .mini { display:block; background:transparent; border:1px dashed #B4B8A9; border-radius:.6rem;
    padding:.5rem .7rem; margin:.5rem 0 0; text-decoration:none; }
  .mini strong { font-size:.78rem; color:#1C1E24; display:block; }
  .mini span { font-size:.7rem; color:#6B6E76; }
  .mini:hover { border-color:#1E4A7A; }
  .t12 { flex:0 0 auto; display:grid; grid-template-columns:360px 360px; gap:.55rem .7rem;
    background:#F1EFE8; border:1px solid #E3E1D8; border-radius:.9rem; padding:.55rem; align-content:start; }
  .band { grid-column:1 / 3; background:#FBFAF6; border:1.5px solid #B4B8A9; border-radius:.75rem;
    padding:.5rem .6rem .6rem; }
  .band-title { font-family:Georgia,serif; font-size:.95rem; font-weight:500; text-align:center; }
  .band-sub { font-size:.7rem; color:#6B6E76; text-align:center; margin:.15rem 0 .3rem; }
  .band-cards { display:grid; grid-template-columns:1fr 1fr; gap:.5rem; align-items:start; }
  .band-cards .station { margin:0; }
  .t12-sub { display:flex; flex-direction:column; }
  .sub-label { font-size:.68rem; letter-spacing:.07em; text-transform:uppercase; color:#6B6E76;
    margin:.1rem 0 0 .2rem; }
  .strand-legend { font-size:.72rem; color:#6B6E76; text-align:center; margin:.4rem 0 0; }
  .strand-legend i { font-style:normal; font-weight:700; }
  .aux { margin-top:2.4rem; max-width:34rem; margin-left:auto; margin-right:auto; }
  .aux h2 { font-family:Georgia,serif; font-weight:500; font-size:1.05rem; }
  .foot { margin-top:2rem; font-size:.72rem; color:#6B6E76; text-align:center; }
  .backlink { font-size:.8rem; } .backlink a { color:#1E4A7A; }
  .tl-scroll { overflow-x:auto; margin-top:.6rem; padding-bottom:.5rem;
    width:min(1480px, calc(100vw - 2rem)); margin-left:50%; transform:translateX(-50%); }
  .timeline { display:flex; gap:.45rem; min-width:1180px; align-items:stretch; }
  .tl-sep { align-self:center; color:#6B6E76; font-size:.9rem; flex:0 0 auto; }
  .tl-block { flex:1 1 0; background:#FFF; border:1px solid #E3E1D8; border-radius:.7rem; padding:.65rem .75rem; }
  .tl-t2 { flex:1.55 1 0; }
  .tl-t5 { flex:.85 1 0; border-style:dashed; background:transparent; }
  .tl-head { font-family:Georgia,serif; font-size:.92rem; font-weight:500; }
  .tl-dur { font-size:.66rem; color:#9A6A14; text-transform:uppercase; letter-spacing:.06em; margin-top:.05rem; }
  .tl-block p { font-size:.74rem; margin:.35rem 0 .45rem; color:#3D4046; }
  .tl-sat { color:#9A6A14 !important; font-style:italic; border-top:1px dashed #E4C990; padding-top:.3rem; }
  .tl-chips { display:flex; flex-wrap:wrap; gap:.25rem; }
  .tl-chip { font-size:.64rem; border:1px solid #C6D6E8; background:#EDF2F8; color:#0C447C;
    border-radius:9999px; padding:.08rem .5rem; text-decoration:none; display:inline-block; }
  .tl-chip:hover { background:#DCE9F6; }
  .tl-chip.run::before { content:"↻ "; }
  .tl-chip.plan { border:1px dashed #5F5E5A; background:transparent; color:#444441; }
  .tl-chip.test { background:#FBF3E0; border-color:#E4C990; color:#633806; }
  .tl-legend { font-size:.68rem; color:#6B6E76; margin:.15rem 0 0; }
</style>
</head>
<body>
<div class="wrap">
  <p class="backlink"><a href="index.html">← Zu den Landkarten</a></p>
  <p class="kicker">Methodik · Stand ${today} · alle Prompts im Original aus dem laufenden System</p>
  <h1>So entsteht die Landkarte des Streits</h1>
  <p class="sub">Ein Bild für die ganze Idee: <strong>die Zeitachse des Verfahrens</strong>, wie eine
    Kommune es erlebt — von Anlass bis Ratsentscheidung (Zielbild nach §8 und §12 des Konzeptpapiers) —
    und <strong>unter jedem Zeitblock die Pipeline-Stufen</strong>, die dort arbeiten. Die farbige Kante
    jeder Karte zeigt den Strang: Die Struktur des Streits und die Menschen dahinter (die Komplementarität
    aus §7): Die Struktur bringt die Landkarten-Punkte hervor, die Menschen stimmen über sie ab, beides trifft
    sich im Scharnier der Diagnose. Jede Stufe zeigt, wer entscheidet: das Sprachmodell schreibt, Jev
    entscheidet mit Wahrscheinlichkeit, der Code rechnet — mit den tatsächlichen Prompts und Jev-Fragen,
    direkt aus dem Code eingebettet. Jede Stufe ist wiederholbar und protokolliert ihre Entscheidungen.</p>
  <p class="principle">Das Vertrauensprinzip auf jeder Ebene: <strong>Das Sprachmodell schreibt, Jev entscheidet,
    der Code rechnet. Die Diagnosen werden gerechnet, nicht gemeint. Wertungsfragen entscheidet die Maschine nie.
    Jede Entscheidung ist protokolliert — ein Mensch kann jede nachprüfen und umdrehen.</strong></p>
  <div class="legend">${(Object.keys(KIND) as Kind[]).map(badge).join("")}</div>

  <h2 class="seg-title">Das Verfahren — und die Maschine darunter</h2>
  <p class="seg-sub">Zielbild für ein kommunales Verfahren (§12: „Eine Kommune, sechs Wochen“). Unter jedem
    Zeitblock hängen die Pipeline-Stufen, die dort laufen — horizontal scrollen für den ganzen Ablauf.</p>
  <div class="board-scroll">
    <div class="board">${(() => { const codes = codeMap(); const oc = outerColumns(); return [
      ...oc.before.map((c) => columnHtml(c, codes)),
      t12Html(codes),
      ...oc.after.map((c) => columnHtml(c, codes)),
    ].join(""); })()}</div>
  </div>
  <p class="strand-legend">Kartenkante = Strang: <i style="color:#6B6E76">▍</i> Stamm ·
    <i style="color:#0F6E56">▍</i> Struktur des Streits (bringt die Landkarten-Punkte hervor) ·
    <i style="color:#1E4A7A">▍</i> die Menschen dahinter (stimmen über die Landkarten-Punkte ab) ·
    <i style="color:#9A6A14">▍</i> Scharnier &amp; Bericht (Struktur × Lagerprofile) ·
    gestrichelte Karten = geplant · ↻ = läuft im Fenster durchgehend als Dienst</p>

  <p class="foot">Alle Stufen quelloffen (MIT) unter github.com/flotob/policy-platform · Lagermathematik als
    differentialgetestete Portierung des Polis-Verfahrens · Dieses Dokument wird generiert
    (render-pipeline.ts) — die Prompt-Texte sind zwangsläufig aktuell.</p>
</div>
</body>
</html>`;

  writeFileSync(`${outDir}/pipeline.html`, html);
  console.log(
    `pipeline.html → ${outDir} (Stamm ${TRUNK.length} · A ${STRAND_A.length} · B ${STRAND_B.length} · Scharnier ${JOIN.length})`,
  );
  process.exit(0);
}

main();
