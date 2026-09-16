/**
 * Render the pipeline methodology page — one standalone HTML file that
 * shows the pipeline in its TRUE dependency shape: a shared trunk that
 * forks into two independent strands (structure / people — the paper's §7
 * complementarity), which meet again at the diagnosis (the paper's
 * "Scharnier") and end in the report. The paper's four phases (§8) ride
 * along as chips on every station. All system prompts are inlined from the
 * running package ("inspectable by construction").
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
  num: string;
  name: string;
  script: string | null;
  kinds: Kind[];
  phase: 1 | 2 | 3 | 4;
  text: string;
  note?: string;
  prompts?: { label: string; text: string }[];
}

/** Shared trunk: everything downstream depends on these. */
const TRUNK: Station[] = [
  {
    num: "1",
    name: "Import & Aufbereitung",
    script: "harvester · import-harvest.ts",
    kinds: ["det"],
    phase: 1,
    text: "Stellungnahmen, Fragebögen und Anhänge werden aus den Quellsystemen geholt und unverändert gespeichert. Lange Texte werden nie gekürzt, sondern in überlappenden Fenstern vollständig verarbeitet.",
  },
  {
    num: "2",
    name: "Zerlegung + Abgleich",
    script: "decompose.ts",
    kinds: ["ki"],
    phase: 1,
    text: "Jede Stellungnahme wird in einzelne Punkte zerlegt — Behauptungen entlang des Grundmusters (P1–P4), Einwände durch eine der fünf Türen (die fünf kritischen Fragen: die fünf Wege, ein Maßnahmen-Argument anzugreifen), Lösungsvorschläge mit der Tür, die sie beantworten. Jeder Punkt trägt ein wörtliches Beleg-Zitat. Direkt verzahnt der Abgleich: Ist der Kandidat ein bekannter Punkt in neuen Worten oder wirklich neu? 214 Wiederholungen werden ein Punkt — die Landkarte wächst um Erkenntnis, nicht um Papier. Die Neupunkt-Rate ergibt das Sättigungsmaß.",
    prompts: [
      { label: "Zerlegungs-Prompt", text: DECOMPOSE_SYSTEM },
      { label: "Abgleich-Prompt (einzeln)", text: MATCH_SYSTEM },
      { label: "Abgleich-Prompt (Batch)", text: BATCH_MATCH_SYSTEM },
    ],
  },
  {
    num: "3",
    name: "Bezüge zwischen Punkten",
    script: "backfill-relations.ts",
    kinds: ["ki"],
    phase: 1,
    text: "Stützt- und Angriffs-Beziehungen: welcher Punkt ist Prämisse wofür, welcher Einwand zielt auf welche Behauptung. Die Angriffskanten tragen als Vokabular die fünf Türen — daran hängt später die deterministische Türen-Zuordnung.",
    prompts: [{ label: "Bezüge-Prompt", text: RELATIONS_SYSTEM }],
  },
  {
    num: "4",
    name: "Redaktion: Punkte",
    script: "ai-review.ts --what points",
    kinds: ["ki", "gate"],
    phase: 1,
    text: "Kein Punkt erscheint ungeprüft auf der Karte. Ein KI-Redakteur schlägt Freigabe oder Ablehnung vor; in der Redaktions-Workbench kann ein Mensch jede Entscheidung einsehen und umdrehen.",
    prompts: [{ label: "Redaktions-Prompt: Punkte", text: AI_REVIEW_POINTS_SYSTEM }],
  },
];

/** Strand A: the structure of the dispute — needs no votes. */
const STRAND_A: Station[] = [
  {
    num: "A1",
    name: "Fünf Türen",
    script: "classify-cq.ts",
    kinds: ["det", "ki"],
    phase: 1,
    text: "Jeder Einwand wird einer der fünf kritischen Fragen zugeordnet: Empirie, Alternativen, Zielkonflikt, Machbarkeit, Wertkonflikt. Wo die Angriffskanten die Tür bereits eindeutig bestimmen, geschieht das deterministisch; nur der Rest geht ans Sprachmodell. Türen, durch die niemand gekommen ist, werden später als Lücken ausgewiesen.",
    prompts: [{ label: "Türen-Prompt", text: CLASSIFY_CQ_SYSTEM }],
  },
  {
    num: "A2",
    name: "Maßnahmen-Zuschnitt",
    script: "segment-measures.ts",
    kinds: ["ki"],
    phase: 1,
    text: "Ein Gesetzentwurf oder Maßnahmenkatalog ist selten eine einzige Entscheidung. Die Karte wird in getrennt entscheidbare Teilentscheidungen zerlegt — jede bekommt ihre eigene Landkarte; übergreifende Punkte bilden den gemeinsamen Stamm („Das Vorhaben als Ganzes“).",
    prompts: [
      { label: "Zuschnitt-Prompt (Vorschlag)", text: MEASURES_PROPOSE_SYSTEM },
      { label: "Zuschnitt-Prompt (Zuordnung)", text: MEASURES_ASSIGN_SYSTEM },
    ],
  },
  {
    num: "A3",
    name: "Verdichtung",
    script: "condense-map.ts",
    kinds: ["ki"],
    phase: 1,
    text: "Aus den fein-granularen Extraktionspunkten (oft 50 je Stellungnahme) werden je Maßnahme 15–25 kanonische Landkarten-Punkte — die Einheit, die ein Leser im Kopf behalten und über die ein Bürger abstimmen kann. Nichts geht verloren: Jeder Extraktionspunkt bleibt als Beleg-Schicht seinem kanonischen Punkt zugeordnet.",
    note: "Im Zielverfahren erzeugt dieser Schritt den Startbestand für die Abstimmung (Strang B). In den bisherigen Testdaten lief die Abstimmung noch auf der feineren Ebene; die Profile werden auf die kanonischen Punkte aggregiert.",
    prompts: [
      { label: "Verdichtungs-Prompt", text: CONDENSE_SYSTEM },
      { label: "Verdichtungs-Prompt (Nachzuordnung)", text: CONDENSE_ASSIGN_SYSTEM },
    ],
  },
];

/** Strand B: the people behind the arguments — needs no doors/measures. */
const STRAND_B: Station[] = [
  {
    num: "B1",
    name: "Abstimmbare Aussagen",
    script: "generate-statements.ts + ai-review.ts",
    kinds: ["ki", "gate"],
    phase: 1,
    text: "Jeder freigegebene Punkt wird in genau eine abstimmbare Aussage übersetzt: neutral, eine Behauptung pro Aussage, zweisprachig. Auch hier prüft die Redaktion vor der Freigabe.",
    prompts: [
      { label: "Aussagen-Prompt", text: STATEMENT_SYSTEM },
      { label: "Redaktions-Prompt: Aussagen", text: AI_REVIEW_STATEMENTS_SYSTEM },
    ],
  },
  {
    num: "B2",
    name: "Tür 1: Abstimmen",
    script: "Vote-Deck (App)",
    kinds: ["det"],
    phase: 2,
    text: "Die niedrigste Schwelle der Beteiligung: Aussage für Aussage zustimmen, ablehnen oder überspringen — einen Antworten-Knopf gibt es mit Absicht nicht, Streitspiralen werden strukturell verhindert.",
  },
  {
    num: "B3",
    name: "Tür 2: Eigene Kurzaussage",
    script: null,
    kinds: ["plan"],
    phase: 2,
    text: "Zwei Sätze, automatisch geprüft: bekannt oder neu? Die Maschinerie dahinter — Abgleich und Redaktions-Gate — existiert und läuft im Stamm; das Bürger-Formular davor ist noch nicht gebaut.",
  },
  {
    num: "B4",
    name: "Tür 3: Volle Stellungnahme",
    script: "decompose.ts",
    kinds: ["ki"],
    phase: 2,
    text: "Der Verband, der vier Seiten mit Anlagen schickt: Die Stellungnahme fließt zurück in die Zerlegung (Station 2) und landet als Punkte und Belege auf derselben Karte.",
  },
  {
    num: "B5",
    name: "Stance-Ableitung",
    script: "infer-stances.ts",
    kinds: ["ki"],
    phase: 2,
    text: "Für bereits gelaufene Konsultationen (unsere Testdaten) wird die Haltung der Freitext-Einreicher zu den Aussagen aus ihren eigenen Texten abgeleitet und als Votum gewertet — überall als „abgeleitet“ gekennzeichnet.",
    note: "Im echten Verfahren ergänzt diese Stufe die Live-Beteiligung (Stellungnahmen zählen mit), sie ersetzt sie nicht.",
    prompts: [{ label: "Stance-Prompt", text: STANCE_SYSTEM }],
  },
  {
    num: "B6",
    name: "Lager & Brücken",
    script: "analyze.ts",
    kinds: ["det"],
    phase: 3,
    text: "Das Polis-Verfahren: Wer ähnlich votet, bildet ein Lager (PCA + k-means, deterministisch, differentialgetestet gegen die Referenz-Implementierung). Brücken und Konfliktlinien folgen Signifikanztests; jede Aussage bekommt ein Zustimmungsprofil je Lager.",
  },
  {
    num: "B7",
    name: "Lager-Namen",
    script: "name-camps.ts",
    kinds: ["ki"],
    phase: 3,
    text: "Damit „Gruppe 0“ und „Gruppe 1“ lesbar werden, benennt ein Sprachmodell die Lager anhand ihrer charakteristischen Positionen — reine Benennung, keine Zahl wird angefasst.",
    prompts: [{ label: "Lager-Namen-Prompt", text: NAME_CAMPS_SYSTEM }],
  },
];

/** Convergence: structure × people, then the report. */
const JOIN: Station[] = [
  {
    num: "5",
    name: "Diagnose je Punkt — das Scharnier",
    script: "diagnose-map.ts",
    kinds: ["det", "ki"],
    phase: 3,
    text: "Hier treffen sich die Stränge: Die kanonischen Punkte aus Strang A bekommen die Zustimmungsprofile aus Strang B — und daraus fällt für jeden Punkt die Diagnose, aus festen Schwellen gerechnet: Brücke der Gründe (beide Lager ≥ 60 %), klärbar durch Gutachten (Tatsachenpunkt, Lager ≥ 15 Punkte auseinander), Wertdifferenz, Kernkonflikt (die größte Wert-Differenz der Maßnahme), offen. Türen ohne einen einzigen Einwand werden zu Lücken-Punkten. Einzige KI-Beteiligung: Der Scheinbrücken-Check prüft bei Brücken, ob die sichtbaren Begründungen wirklich in dieselbe Richtung tragen; ein Fund wird als Warnung markiert — als maschinelle Markierung mit redaktionellem Prüfvermerk, nicht als Faktum.",
    prompts: [{ label: "Scheinbrücken-Check-Prompt", text: REASONS_CHECK_SYSTEM }],
  },
  {
    num: "6",
    name: "Befund je Punkt",
    script: "diagnose-map.ts (Befund-Teil)",
    kinds: ["ki"],
    phase: 4,
    text: "Zu jeder gerechneten Diagnose entsteht der Befund: zwei bis fünf Sätze Klartext — was die Zahlen zeigen, was daraus für das Verfahren folgt (Kurzgutachten? Ratsentscheidung? Lücke schließen?), was im Material dahintersteht. Die Diagnose selbst ist dem Modell vorgegeben und unantastbar.",
    prompts: [{ label: "Befund-Prompt (mit Bindungsregel)", text: BEFUND_SYSTEM }],
  },
  {
    num: "7",
    name: "Die Landkarte",
    script: "render-landkarte.ts",
    kinds: ["det"],
    phase: 4,
    text: "Aus den Daten wird je Maßnahme eine eigenständige Seite gebaut: das Grundmuster als Leiste, die Zone der Gutachter mit ihren Bezirken, die Zone des Rates, die Ausgestaltung — jeder Punkt mit Lagerprofil, Befund, Originalzitaten und aufklappbarer Beleg-Schicht. Reines Rendern, keine KI.",
  },
];

const AUX: { label: string; text: string }[] = [
  { label: "Themen-Cluster (cluster-themes.ts)", text: THEMES_PROPOSE_SYSTEM + "\n\n---\n\n" + THEMES_ASSIGN_SYSTEM },
  { label: "Kurz-Labels (shorten-labels.ts)", text: SHORTEN_LABELS_SYSTEM },
];

const PHASE_LABEL: Record<number, string> = {
  1: "Phase 1 · Vorbereitung",
  2: "Phase 2 · Beteiligung",
  3: "Phase 3 · Auswertung",
  4: "Phase 4 · Bericht",
};

function badge(k: Kind): string {
  const m = KIND[k];
  const dashed = k === "plan" ? "border-style:dashed;" : "";
  return `<span class="badge" style="color:${m.fg};background:${m.bg};border:1px solid ${m.border};${dashed}">${m.label}</span>`;
}

function stationHtml(s: Station): string {
  const prompts = (s.prompts ?? [])
    .map(
      (p) =>
        `<details class="prompt"><summary>Prompt ansehen: ${esc(p.label)}</summary><pre>${esc(p.text)}</pre></details>`,
    )
    .join("");
  return `<div class="station${s.kinds.includes("plan") ? " station-plan" : ""}">
    <div class="station-head">
      <span class="station-num">${s.num}</span>
      <strong>${esc(s.name)}</strong>
      ${s.script ? `<code>${esc(s.script)}</code>` : ""}
    </div>
    <div class="station-badges">${s.kinds.map(badge).join("")}<span class="phase-chip">${PHASE_LABEL[s.phase]}</span></div>
    <p>${esc(s.text)}</p>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    ${prompts}
  </div>`;
}

const FORK_SVG = `<svg class="connector" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
  <path d="M50,0 L50,5 M26,5 L74,5 M26,5 L26,12 M74,5 L74,12" fill="none" stroke="#B4B8A9" stroke-width="0.6" vector-effect="non-scaling-stroke"/>
</svg>`;
const JOIN_SVG = `<svg class="connector" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
  <path d="M26,0 L26,7 M74,0 L74,7 M26,7 L74,7 M50,7 L50,12" fill="none" stroke="#B4B8A9" stroke-width="0.6" vector-effect="non-scaling-stroke"/>
</svg>`;

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
  .station { position:relative; background:#FFF; border:1px solid #E3E1D8; border-radius:.75rem;
    padding:.85rem 1rem; margin:.55rem 0; }
  .station-plan { border-style:dashed; background:transparent; }
  .station-head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .station-num { min-width:1.6rem; height:1.6rem; border-radius:50%; background:#FBFAF6;
    border:2px solid #B4B8A9; color:#6B6E76; font-size:.68rem; font-weight:600;
    display:inline-flex; align-items:center; justify-content:center; padding:0 .2rem; }
  .station-head strong { font-size:.92rem; }
  .station-head code { font-size:.68rem; color:#6B6E76; background:#F1EFE8; border-radius:.25rem; padding:.1rem .4rem; }
  .station-badges { display:flex; align-items:center; gap:.35rem; flex-wrap:wrap; margin-top:.4rem; }
  .station p { font-size:.85rem; margin:.5rem 0 0; }
  .note { color:#9A6A14; background:#FBF3E0; border-radius:.4rem; padding:.4rem .6rem; font-size:.78rem !important; }
  details.prompt { margin-top:.5rem; font-size:.8rem; }
  details.prompt summary { cursor:pointer; color:#1E4A7A; }
  details.prompt pre { white-space:pre-wrap; background:#F1EFE8; border:1px solid #E3E1D8;
    border-radius:.5rem; padding:.7rem .9rem; font-size:.7rem; line-height:1.5; margin:.4rem 0 0; }
  .trunk .station { max-width:34rem; margin-left:auto; margin-right:auto; }
  .trunk .station + .station::before { content:""; position:absolute; left:50%; top:-0.65rem;
    height:0.65rem; width:2px; background:#B4B8A9; }
  .connector { display:block; width:100%; height:2.6rem; }
  .strands { display:grid; grid-template-columns:1fr 1fr; gap:1rem; align-items:start; }
  .strand-head { text-align:center; margin-bottom:.4rem; }
  .strand-head strong { font-family:Georgia,serif; font-weight:500; font-size:1.05rem; display:block; }
  .strand-head span { font-size:.75rem; color:#6B6E76; font-style:italic; }
  .strand-a .strand-head strong { color:#0F6E56; }
  .strand-b .strand-head strong { color:#1E4A7A; }
  .strand { border-radius:1rem; padding:.7rem; }
  .strand-a { background:#E7F3EE; border:1px solid #BFDCD1; }
  .strand-b { background:#EDF2F8; border:1px solid #C6D6E8; }
  .strand .station + .station::before { content:""; position:absolute; left:50%; top:-0.6rem;
    height:0.6rem; width:2px; background:#B4B8A9; }
  .parallel-note { text-align:center; font-size:.72rem; color:#6B6E76; margin:.3rem 0 0; }
  @media (max-width:640px) {
    .strands { grid-template-columns:1fr; }
    .connector { display:none; }
    .seg-gap { height:1rem; }
  }
  .aux { margin-top:2.4rem; max-width:34rem; margin-left:auto; margin-right:auto; }
  .aux h2 { font-family:Georgia,serif; font-weight:500; font-size:1.05rem; }
  .foot { margin-top:2rem; font-size:.72rem; color:#6B6E76; text-align:center; }
  .backlink { font-size:.8rem; } .backlink a { color:#1E4A7A; }
</style>
</head>
<body>
<div class="wrap">
  <p class="backlink"><a href="index.html">← Zu den Landkarten</a></p>
  <p class="kicker">Methodik · Stand ${today} · alle Prompts im Original aus dem laufenden System</p>
  <h1>So entsteht die Landkarte des Streits</h1>
  <p class="sub">Die Verarbeitungskette in ihrer echten Abhängigkeits-Form: Aus einem gemeinsamen Stamm
    gabeln sich zwei voneinander unabhängige Stränge — <strong>die Struktur des Streits</strong> (braucht keine
    Voten) und <strong>die Menschen dahinter</strong> (braucht keine Struktur). Das ist die Komplementarität aus §7
    des Konzeptpapiers: Die Landkarte kennt die Struktur, Polis kennt die Geometrie der Bevölkerung — und
    beide sind blind für den jeweils anderen. Erst die Diagnose verbindet sie: das Scharnier, das das Papier
    als das eigentlich Neue beschreibt. Jede KI-Stufe zeigt den tatsächlichen System-Prompt, direkt aus dem
    Code eingebettet; jede Stufe ist wiederholbar und protokolliert ihre Entscheidungen im Audit-Log.</p>
  <p class="principle">Das Vertrauensprinzip auf jeder Ebene: <strong>Die Maschine schlägt vor, der Mensch gibt frei.
    Die Diagnosen werden gerechnet, nicht gemeint. Wertungsfragen entscheidet die Maschine nie.</strong></p>
  <div class="legend">${(Object.keys(KIND) as Kind[]).map(badge).join("")}</div>

  <h2 class="seg-title">Der gemeinsame Stamm</h2>
  <p class="seg-sub">Aus Stellungnahmen werden geprüfte Punkte — alles Weitere hängt hieran.</p>
  <div class="trunk">${TRUNK.map(stationHtml).join("")}</div>

  ${FORK_SVG}

  <div class="strands">
    <div class="strand strand-a">
      <div class="strand-head"><strong>Strang A — Die Struktur des Streits</strong>
        <span>„Die Landkarte kennt die Struktur …“ — läuft ohne ein einziges Votum</span></div>
      ${STRAND_A.map(stationHtml).join("")}
    </div>
    <div class="strand strand-b">
      <div class="strand-head"><strong>Strang B — Die Menschen dahinter</strong>
        <span>„… Polis kennt die Geometrie der Bevölkerung“ — läuft ohne Türen und Zuschnitt</span></div>
      ${STRAND_B.map(stationHtml).join("")}
    </div>
  </div>
  <p class="parallel-note">Die Stränge sind vollständig unabhängig und im Prinzip parallel ausführbar;
    der Orchestrator arbeitet sie heute aus Robustheitsgründen nacheinander ab.</p>

  ${JOIN_SVG}

  <h2 class="seg-title">Das Scharnier &amp; der Bericht</h2>
  <p class="seg-sub">Kanonische Punkte × Lagerprofile → Diagnose, Befund, Landkarte.</p>
  <div class="trunk">${JOIN.map(stationHtml).join("")}</div>

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
