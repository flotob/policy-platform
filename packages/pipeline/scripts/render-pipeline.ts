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

import {
  AI_REVIEW_POINTS_SYSTEM,
  AI_REVIEW_STATEMENTS_SYSTEM,
  BATCH_MATCH_SYSTEM,
  BEFUND_SYSTEM,
  CLASSIFY_CQ_SYSTEM,
  CONDENSE_ASSIGN_SYSTEM,
  CONDENSE_SYSTEM,
  DECOMPOSE_SYSTEM,
  MATCH_SYSTEM,
  MEASURES_ASSIGN_SYSTEM,
  MEASURES_PROPOSE_SYSTEM,
  NAME_CAMPS_SYSTEM,
  REASONS_CHECK_SYSTEM,
  RELATIONS_SYSTEM,
  SHORTEN_LABELS_SYSTEM,
  STANCE_SYSTEM,
  STATEMENT_SYSTEM,
  THEMES_ASSIGN_SYSTEM,
  THEMES_PROPOSE_SYSTEM,
} from "../src/prompts.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Kind = "ki" | "det" | "gate" | "plan";

const KIND: Record<Kind, { label: string; fg: string; bg: string; border: string }> = {
  ki: { label: "KI-Stufe", fg: "#0C447C", bg: "#DCE9F6", border: "#185FA5" },
  det: { label: "Deterministisch — keine KI", fg: "#085041", bg: "#DFF1EA", border: "#0F6E56" },
  gate: { label: "Redaktions-Gate — Mensch gibt frei", fg: "#633806", bg: "#F7E8CB", border: "#9A6A14" },
  plan: { label: "Geplant — noch nicht gebaut", fg: "#444441", bg: "transparent", border: "#5F5E5A" },
};

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
}

/** Shared trunk: everything downstream depends on these. */
const TRUNK: Station[] = [
  {
    key: "import",
    strand: "st",
    name: "Import & Aufbereitung",
    script: "harvester · import-harvest.ts",
    kinds: ["det"],
    text: "Stellungnahmen, Fragebögen und Anhänge werden aus den Quellsystemen geholt und unverändert gespeichert. Lange Texte werden nie gekürzt, sondern in überlappenden Fenstern vollständig verarbeitet.",
  },
  {
    key: "zerlegung",
    strand: "st",
    name: "Zerlegung + Abgleich",
    script: "decompose.ts",
    kinds: ["ki"],
    text: "Jede Stellungnahme wird in einzelne Punkte zerlegt — Behauptungen entlang des Grundmusters (P1–P4), Einwände durch eine der fünf Türen (die fünf kritischen Fragen: die fünf Wege, ein Maßnahmen-Argument anzugreifen), Lösungsvorschläge mit der Tür, die sie beantworten. Jeder Punkt trägt ein wörtliches Beleg-Zitat. Direkt verzahnt der Abgleich: Ist der Kandidat ein bekannter Punkt in neuen Worten oder wirklich neu? 214 Wiederholungen werden ein Punkt — die Landkarte wächst um Erkenntnis, nicht um Papier. Die Neupunkt-Rate ergibt das Sättigungsmaß.",
    prompts: [
      { label: "Zerlegungs-Prompt", text: DECOMPOSE_SYSTEM },
      { label: "Abgleich-Prompt (einzeln)", text: MATCH_SYSTEM },
      { label: "Abgleich-Prompt (Batch)", text: BATCH_MATCH_SYSTEM },
    ],
  },
  {
    key: "bezuege",
    strand: "st",
    name: "Bezüge zwischen Punkten",
    script: "backfill-relations.ts",
    kinds: ["ki"],
    text: "Stützt- und Angriffs-Beziehungen: welcher Punkt ist Prämisse wofür, welcher Einwand zielt auf welche Behauptung. Die Angriffskanten tragen als Vokabular die fünf Türen — daran hängt später die deterministische Türen-Zuordnung.",
    prompts: [{ label: "Bezüge-Prompt", text: RELATIONS_SYSTEM }],
  },
  {
    key: "redaktion",
    strand: "st",
    name: "Redaktion: Punkte",
    script: "ai-review.ts --what points",
    kinds: ["ki", "gate"],
    text: "Kein Punkt erscheint ungeprüft auf der Karte. Ein KI-Redakteur schlägt Freigabe oder Ablehnung vor; in der Redaktions-Workbench kann ein Mensch jede Entscheidung einsehen und umdrehen.",
    prompts: [{ label: "Redaktions-Prompt: Punkte", text: AI_REVIEW_POINTS_SYSTEM }],
  },
];

/** Strand A: the structure of the dispute — needs no votes. */
const STRAND_A: Station[] = [
  {
    key: "tueren",
    strand: "sa",
    name: "Fünf Türen",
    script: "classify-cq.ts",
    kinds: ["det", "ki"],
    text: "Jeder Einwand wird einer der fünf kritischen Fragen zugeordnet: Empirie, Alternativen, Zielkonflikt, Machbarkeit, Wertkonflikt. Wo die Angriffskanten die Tür bereits eindeutig bestimmen, geschieht das deterministisch; nur der Rest geht ans Sprachmodell. Türen, durch die niemand gekommen ist, werden später als Lücken ausgewiesen.",
    prompts: [{ label: "Türen-Prompt", text: CLASSIFY_CQ_SYSTEM }],
  },
  {
    key: "zuschnitt",
    strand: "sa",
    name: "Maßnahmen-Zuschnitt",
    script: "segment-measures.ts",
    kinds: ["ki"],
    text: "Ein Gesetzentwurf oder Maßnahmenkatalog ist selten eine einzige Entscheidung. Die Karte wird in getrennt entscheidbare Teilentscheidungen zerlegt — jede bekommt ihre eigene Landkarte; übergreifende Punkte bilden den gemeinsamen Stamm („Das Vorhaben als Ganzes“).",
    prompts: [
      { label: "Zuschnitt-Prompt (Vorschlag)", text: MEASURES_PROPOSE_SYSTEM },
      { label: "Zuschnitt-Prompt (Zuordnung)", text: MEASURES_ASSIGN_SYSTEM },
    ],
  },
  {
    key: "verdichtung",
    strand: "sa",
    name: "Verdichtung",
    script: "condense-map.ts",
    kinds: ["ki"],
    text: "Aus den fein-granularen Extraktionspunkten (oft 50 je Stellungnahme) werden je Maßnahme 15–25 kanonische Landkarten-Punkte — die Einheit, die ein Leser im Kopf behalten und über die ein Bürger abstimmen kann. Nichts geht verloren: Jeder Extraktionspunkt bleibt als Beleg-Schicht seinem kanonischen Punkt zugeordnet.",
    note: "Im Zielverfahren erzeugt dieser Schritt den Startbestand für die Abstimmung (blauer Strang, T2). In den bisherigen Testdaten lief die Abstimmung noch auf der feineren Ebene; die Profile werden auf die kanonischen Punkte aggregiert.",
    prompts: [
      { label: "Verdichtungs-Prompt", text: CONDENSE_SYSTEM },
      { label: "Verdichtungs-Prompt (Nachzuordnung)", text: CONDENSE_ASSIGN_SYSTEM },
    ],
  },
];

/** Strand B: the people behind the arguments — needs no doors/measures. */
const STRAND_B: Station[] = [
  {
    key: "aussagen",
    strand: "sb",
    name: "Abstimmbare Aussagen",
    script: "generate-statements.ts + ai-review.ts",
    kinds: ["ki", "gate"],
    text: "Jeder freigegebene Punkt wird in genau eine abstimmbare Aussage übersetzt: neutral, eine Behauptung pro Aussage, zweisprachig. Auch hier prüft die Redaktion vor der Freigabe.",
    prompts: [
      { label: "Aussagen-Prompt", text: STATEMENT_SYSTEM },
      { label: "Redaktions-Prompt: Aussagen", text: AI_REVIEW_STATEMENTS_SYSTEM },
    ],
  },
  {
    key: "tuer1",
    strand: "sb",
    name: "Tür 1: Abstimmen",
    script: "Vote-Deck (App)",
    kinds: ["det"],
    text: "Die niedrigste Schwelle der Beteiligung: Aussage für Aussage zustimmen, ablehnen oder überspringen — einen Antworten-Knopf gibt es mit Absicht nicht, Streitspiralen werden strukturell verhindert.",
  },
  {
    key: "tuer2",
    strand: "sb",
    name: "Tür 2: Eigene Kurzaussage",
    script: null,
    kinds: ["plan"],
    text: "Zwei Sätze, automatisch geprüft: bekannt oder neu? Die Maschinerie dahinter — Abgleich und Redaktions-Gate — existiert und läuft im Stamm; das Bürger-Formular davor ist noch nicht gebaut.",
  },
  {
    key: "tuer3",
    strand: "sb",
    name: "Tür 3: Volle Stellungnahme",
    script: "decompose.ts",
    kinds: ["ki"],
    text: "Der Verband, der vier Seiten mit Anlagen schickt: Die Stellungnahme fließt zurück in die Zerlegung (T1.2) und landet als Punkte und Belege auf derselben Karte.",
  },
  {
    key: "stances",
    strand: "sb",
    name: "Stance-Ableitung",
    script: "infer-stances.ts",
    kinds: ["ki"],
    text: "Für bereits gelaufene Konsultationen (unsere Testdaten) wird die Haltung der Freitext-Einreicher zu den Aussagen aus ihren eigenen Texten abgeleitet und als Votum gewertet — überall als „abgeleitet“ gekennzeichnet.",
    note: "Im echten Verfahren ergänzt diese Stufe die Live-Beteiligung (Stellungnahmen zählen mit), sie ersetzt sie nicht.",
    prompts: [{ label: "Stance-Prompt", text: STANCE_SYSTEM }],
  },
  {
    key: "analyse",
    strand: "sb",
    name: "Lager & Brücken",
    script: "analyze.ts",
    kinds: ["det"],
    text: "Das Polis-Verfahren: Wer ähnlich votet, bildet ein Lager (PCA + k-means, deterministisch, differentialgetestet gegen die Referenz-Implementierung). Brücken und Konfliktlinien folgen Signifikanztests; jede Aussage bekommt ein Zustimmungsprofil je Lager.",
  },
  {
    key: "namen",
    strand: "sb",
    name: "Lager-Namen",
    script: "name-camps.ts",
    kinds: ["ki"],
    text: "Damit „Gruppe 0“ und „Gruppe 1“ lesbar werden, benennt ein Sprachmodell die Lager anhand ihrer charakteristischen Positionen — reine Benennung, keine Zahl wird angefasst.",
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
    kinds: ["det", "ki"],
    text: "Hier treffen sich die Stränge: Die kanonischen Punkte (grüner Strang) bekommen die Zustimmungsprofile (blauer Strang) — und daraus fällt für jeden Punkt die Diagnose, aus festen Schwellen gerechnet: Brücke der Gründe (beide Lager ≥ 60 %), klärbar durch Gutachten (Tatsachenpunkt, Lager ≥ 15 Punkte auseinander), Wertdifferenz, Kernkonflikt (die größte Wert-Differenz der Maßnahme), offen. Türen ohne einen einzigen Einwand werden zu Lücken-Punkten. Einzige KI-Beteiligung: Der Scheinbrücken-Check prüft bei Brücken, ob die sichtbaren Begründungen wirklich in dieselbe Richtung tragen; ein Fund wird als Warnung markiert — als maschinelle Markierung mit redaktionellem Prüfvermerk, nicht als Faktum.",
    prompts: [{ label: "Scheinbrücken-Check-Prompt", text: REASONS_CHECK_SYSTEM }],
  },
  {
    key: "befund",
    strand: "sh",
    name: "Befund je Punkt",
    script: "diagnose-map.ts (Befund-Teil)",
    kinds: ["ki"],
    text: "Zu jeder gerechneten Diagnose entsteht der Befund: zwei bis fünf Sätze Klartext — was die Zahlen zeigen, was daraus für das Verfahren folgt (Kurzgutachten? Ratsentscheidung? Lücke schließen?), was im Material dahintersteht. Die Diagnose selbst ist dem Modell vorgegeben und unantastbar.",
    prompts: [{ label: "Befund-Prompt (mit Bindungsregel)", text: BEFUND_SYSTEM }],
  },
  {
    key: "landkarte",
    strand: "sh",
    name: "Die Landkarte",
    script: "render-landkarte.ts",
    kinds: ["det"],
    text: "Aus den Daten wird je Maßnahme eine eigenständige Seite gebaut: das Grundmuster als Leiste, die Zone der Gutachter mit ihren Bezirken, die Zone des Rates, die Ausgestaltung — jeder Punkt mit Lagerprofil, Befund, Originalzitaten und aufklappbarer Beleg-Schicht. Reines Rendern, keine KI.",
  },
];

const AUX: { label: string; text: string }[] = [
  { label: "Themen-Cluster (cluster-themes.ts)", text: THEMES_PROPOSE_SYSTEM + "\n\n---\n\n" + THEMES_ASSIGN_SYSTEM },
  { label: "Kurz-Labels (shorten-labels.ts)", text: SHORTEN_LABELS_SYSTEM },
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

function columns(): Column[] {
  const all = [...TRUNK, ...STRAND_A, ...STRAND_B, ...JOIN];
  const n = (key: string) => byKey(all, key);
  return [
    {
      code: "T0",
      title: "T0 · Anlass & Zuschnitt",
      dur: "Woche 0",
      text: "Die Kommune beschließt das Verfahren und legt fest, worüber entschieden wird: eine Maßnahme oder ein Katalog — jede Teilentscheidung bekommt ihre eigene Landkarte. Im Zielverfahren ist der Zuschnitt eine bewusste Entscheidung der Kommune; die KI schlägt höchstens vor.",
      cards: [n("zuschnitt")],
    },
    {
      code: "T1",
      title: "T1 · Vorbereitung",
      dur: "≈ 2 Wochen",
      text: "Vorhandenes Material — die Beschlussvorlage samt Begründung, Gutachten, Stellungnahmen aus Träger- und Verbändebeteiligung — wird zerlegt, geordnet und je Maßnahme zu 15–25 kanonischen, abstimmbaren Punkten verdichtet. Die Redaktion gibt den Startbestand frei.",
      cards: [n("import"), n("zerlegung"), n("bezuege"), n("redaktion"), n("tueren"), n("verdichtung"), n("aussagen")],
    },
    {
      code: "T2",
      title: "T2 · Offene Beteiligung",
      dur: "≈ 3 Wochen",
      text: "Die drei Türen sind offen; die Karte wächst live. Neue Punkte aus Tür 2 und 3 gehen nach Freigabe selbst in die Abstimmung — der Rückkanal, keine eingefrorene Landkarte.",
      sat: "endet bei Sättigung, nicht nach Kalender — „es kommt seit zehn Tagen nichts Neues mehr“ (§10)",
      cards: [n("tuer1"), n("tuer2"), n("tuer3"), n("stances")],
      minis: [
        { label: "↻ Zerlegung + Abgleich", key: "zerlegung", note: "läuft durchgehend weiter — jede neue Eingabe wird sofort zerlegt und abgeglichen" },
        { label: "↻ Redaktion", key: "redaktion", note: "läuft durchgehend weiter — neue Punkte werden laufend freigegeben" },
        { label: "↻ Lagerbildung", key: "analyse", note: "läuft nächtlich mit — Lager und Brücken aktualisieren sich während der Beteiligung" },
      ],
    },
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
  ];
}

/** Display codes computed from board position: T1.1, T1.2, … */
function codeMap(cols: Column[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cols)
    c.cards.forEach((st, i) => m.set(st.key, `${c.code}.${i + 1}`));
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

function badge(k: Kind): string {
  const m = KIND[k];
  const dashed = k === "plan" ? "border-style:dashed;" : "";
  return `<span class="badge" style="color:${m.fg};background:${m.bg};border:1px solid ${m.border};${dashed}">${m.label}</span>`;
}

function stationHtml(s: Station, code: string): string {
  const prompts = (s.prompts ?? [])
    .map(
      (p) =>
        `<details class="prompt"><summary>Prompt ansehen: ${esc(p.label)}</summary><pre>${esc(p.text)}</pre></details>`,
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

  const aux = AUX.map(
    (a) =>
      `<details class="prompt"><summary>${esc(a.label)}</summary><pre>${esc(a.text)}</pre></details>`,
  ).join("");

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
  details.prompt pre { white-space:pre-wrap; background:#F1EFE8; border:1px solid #E3E1D8;
    border-radius:.5rem; padding:.6rem .8rem; font-size:.68rem; line-height:1.5; margin:.35rem 0 0; }
  .mini { display:block; background:transparent; border:1px dashed #B4B8A9; border-radius:.6rem;
    padding:.5rem .7rem; margin:.5rem 0 0; text-decoration:none; }
  .mini strong { font-size:.78rem; color:#1C1E24; display:block; }
  .mini span { font-size:.7rem; color:#6B6E76; }
  .mini:hover { border-color:#1E4A7A; }
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
    aus §7) laufen unabhängig voneinander und treffen sich erst im Scharnier der Diagnose. Jede KI-Stufe
    zeigt den tatsächlichen System-Prompt, direkt aus dem Code eingebettet; jede Stufe ist wiederholbar
    und protokolliert ihre Entscheidungen im Audit-Log.</p>
  <p class="principle">Das Vertrauensprinzip auf jeder Ebene: <strong>Die Maschine schlägt vor, der Mensch gibt frei.
    Die Diagnosen werden gerechnet, nicht gemeint. Wertungsfragen entscheidet die Maschine nie.</strong></p>
  <div class="legend">${(Object.keys(KIND) as Kind[]).map(badge).join("")}</div>

  <h2 class="seg-title">Das Verfahren — und die Maschine darunter</h2>
  <p class="seg-sub">Zielbild für ein kommunales Verfahren (§12: „Eine Kommune, sechs Wochen“). Unter jedem
    Zeitblock hängen die Pipeline-Stufen, die dort laufen — horizontal scrollen für den ganzen Ablauf.</p>
  <div class="board-scroll">
    <div class="board">${(() => { const cols = columns(); const codes = codeMap(cols); return cols.map((c) => columnHtml(c, codes)).join(""); })()}</div>
  </div>
  <p class="strand-legend">Kartenkante = Strang: <i style="color:#6B6E76">▍</i> Stamm ·
    <i style="color:#0F6E56">▍</i> Struktur des Streits (läuft ohne Voten) ·
    <i style="color:#1E4A7A">▍</i> die Menschen dahinter (läuft ohne Türen/Zuschnitt) ·
    <i style="color:#9A6A14">▍</i> Scharnier &amp; Bericht (Struktur × Lagerprofile) —
    die Stränge sind unabhängig und treffen sich erst in der Diagnose ·
    gestrichelte Karten = geplant · ↻ = läuft im Fenster durchgehend als Dienst</p>

  <section class="aux">
    <h2>Hilfsstufen (Darstellung, keine Inhalte)</h2>
    ${aux}
  </section>
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
