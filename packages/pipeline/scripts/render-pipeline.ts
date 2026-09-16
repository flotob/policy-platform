/**
 * Render the pipeline methodology page — one standalone HTML file that
 * describes the COMPLETE current pipeline, grouped by the concept paper's
 * four phases (§8), with the REAL system prompts inlined ("inspectable by
 * construction": the texts are imported from the running package, never
 * transcribed). Companion to the Landkarte pages, same visual language.
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
  name: string;
  script: string | null;
  kinds: Kind[];
  text: string;
  note?: string;
  prompts?: { label: string; text: string }[];
}

interface Phase {
  title: string;
  paper: string;
  intro: string;
  stations: Station[];
}

const PHASES: Phase[] = [
  {
    title: "Phase 1 — Vorbereitung",
    paper: "Papier §8: „Aus Punkten werden abstimmbare Aussagen“",
    intro:
      "Die vorliegenden Stellungnahmen werden vollständig gelesen und in die Struktur des Papiers übersetzt: Grundmuster (P1–P4), fünf Türen, Instrumente. Am Ende dieser Phase steht der Startbestand der Landkarte — kanonische, abstimmbare Punkte mit vollständiger Beleg-Schicht.",
    stations: [
      {
        name: "Import & Aufbereitung",
        script: "harvester · import-harvest.ts",
        kinds: ["det"],
        text: "Stellungnahmen, Fragebögen und Anhänge werden aus den Quellsystemen geholt und unverändert gespeichert. Lange Texte werden nie gekürzt, sondern in überlappenden Fenstern vollständig verarbeitet.",
      },
      {
        name: "Zerlegung",
        script: "decompose.ts",
        kinds: ["ki"],
        text: "Jede Stellungnahme wird in einzelne Punkte zerlegt — Behauptungen entlang des Grundmusters, Einwände durch eine der fünf Türen, Lösungsvorschläge (Instrumente) mit ihrer primären Tür. Jeder Punkt trägt ein wörtliches Beleg-Zitat und die Fundstelle. Das Sprachmodell schreibt keine freie Zusammenfassung, es füllt eine Struktur.",
        prompts: [{ label: "Zerlegungs-Prompt", text: DECOMPOSE_SYSTEM }],
      },
      {
        name: "Abgleich: bekannt oder neu?",
        script: "decompose.ts (Rückkanal)",
        kinds: ["ki"],
        text: "Das Scharnier gegen die Duplikat-Flut: Für jeden Kandidaten wird entschieden, ob er ein bekannter Punkt in neuen Worten ist oder ein wirklich neues Element. 214 Wiederholungen desselben Einwands werden ein einziger Punkt — die Landkarte wächst um Erkenntnis, nicht um Papier. Jede Entscheidung wird mit Modell, Prompt-Hash und Konfidenz protokolliert; die Neupunkt-Rate ergibt das Sättigungsmaß.",
        prompts: [
          { label: "Abgleich-Prompt (einzeln)", text: MATCH_SYSTEM },
          { label: "Abgleich-Prompt (Batch)", text: BATCH_MATCH_SYSTEM },
        ],
      },
      {
        name: "Bezüge zwischen Punkten",
        script: "backfill-relations.ts",
        kinds: ["ki"],
        text: "Stützt- und Angriffs-Beziehungen zwischen den Punkten einer Stellungnahme werden erfasst — das Gerüst, an dem später die Türen-Klassifikation und die Ketten hängen.",
        prompts: [{ label: "Bezüge-Prompt", text: RELATIONS_SYSTEM }],
      },
      {
        name: "Redaktion: Punkte",
        script: "ai-review.ts --what points",
        kinds: ["ki", "gate"],
        text: "Kein Punkt erscheint ungeprüft auf der Karte. Ein KI-Redakteur schlägt Freigabe oder Ablehnung vor; in der Redaktions-Workbench kann ein Mensch jede Entscheidung einsehen und umdrehen. Die Maschine schlägt vor, der Mensch gibt frei.",
        prompts: [{ label: "Redaktions-Prompt: Punkte", text: AI_REVIEW_POINTS_SYSTEM }],
      },
      {
        name: "Abstimmbare Aussagen",
        script: "generate-statements.ts + ai-review.ts --what statements",
        kinds: ["ki", "gate"],
        text: "Jeder freigegebene Punkt wird in genau eine abstimmbare Aussage übersetzt: neutral formuliert, eine Behauptung pro Aussage, zweisprachig. Auch hier prüft die Redaktion vor der Freigabe.",
        prompts: [
          { label: "Aussagen-Prompt", text: STATEMENT_SYSTEM },
          { label: "Redaktions-Prompt: Aussagen", text: AI_REVIEW_STATEMENTS_SYSTEM },
        ],
      },
      {
        name: "Fünf Türen",
        script: "classify-cq.ts",
        kinds: ["det", "ki"],
        text: "Jeder Einwand wird einer der fünf kritischen Fragen zugeordnet: Empirie, Alternativen, Zielkonflikt, Machbarkeit, Wertkonflikt. Wo die Angriffs-Beziehungen die Tür bereits eindeutig bestimmen, geschieht das rein deterministisch; nur der Rest geht ans Sprachmodell. Türen, durch die niemand gekommen ist, werden später als Lücken ausgewiesen.",
        prompts: [{ label: "Türen-Prompt", text: CLASSIFY_CQ_SYSTEM }],
      },
      {
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
        name: "Verdichtung",
        script: "condense-map.ts",
        kinds: ["ki"],
        text: "Die neueste Stufe, und die Antwort auf die Frage nach der Körnung: Aus den fein-granularen Extraktionspunkten (oft 50 je Stellungnahme) werden je Maßnahme 15–25 kanonische Landkarten-Punkte — die Einheit, die ein Leser im Kopf behalten und über die ein Bürger abstimmen kann. Nichts geht verloren: Jeder Extraktionspunkt bleibt als Beleg-Schicht seinem kanonischen Punkt zugeordnet und ist im Detail einsehbar.",
        note: "Im Zielverfahren erzeugt dieser Schritt den Startbestand für die Abstimmung (Phase 2). In den bisherigen Testdaten lief die Abstimmung noch auf der feineren Ebene; die Profile werden auf die kanonischen Punkte aggregiert.",
        prompts: [
          { label: "Verdichtungs-Prompt", text: CONDENSE_SYSTEM },
          { label: "Verdichtungs-Prompt (Nachzuordnung)", text: CONDENSE_ASSIGN_SYSTEM },
        ],
      },
    ],
  },
  {
    title: "Phase 2 — Beteiligung",
    paper: "Papier §8: „Drei Türen, ein Graph“",
    intro:
      "Drei Eingänge mit unterschiedlich hoher Schwelle, alle reichern dieselbe Landkarte an. Niemand muss sich einem Formular unterwerfen — die Struktur passt sich dem Menschen an.",
    stations: [
      {
        name: "Tür 1: Abstimmen",
        script: "Vote-Deck (App)",
        kinds: ["det"],
        text: "Die niedrigste Schwelle: Aussage für Aussage zustimmen, ablehnen oder überspringen — einen Antworten-Knopf gibt es mit Absicht nicht, Streitspiralen werden strukturell verhindert. Wer sich durchklickt, bekommt nebenbei den fairen Überblick über die ganze Debatte.",
      },
      {
        name: "Tür 2: Eigene Kurzaussage",
        script: null,
        kinds: ["plan"],
        text: "Zwei Sätze, automatisch geprüft: bekannter Punkt in neuen Worten (die Stimme zählt auf den vorhandenen Punkt) oder wirklich neu (geht zur Redaktion und dann selbst in die Abstimmung). Die Maschinerie dahinter — Abgleich und Redaktions-Gate — existiert und läuft in Phase 1; das Bürger-Formular davor ist noch nicht gebaut.",
      },
      {
        name: "Tür 3: Volle Stellungnahme",
        script: "decompose.ts",
        kinds: ["ki"],
        text: "Der Verband, der vier Seiten mit Anlagen schickt: Die Stellungnahme wird komplett zerlegt wie in Phase 1 und landet als Punkte und Belege auf derselben Karte.",
      },
      {
        name: "Stance-Ableitung",
        script: "infer-stances.ts",
        kinds: ["ki"],
        text: "Für Konsultationen, die bereits gelaufen sind (unsere Testdaten), wird die Haltung der Freitext-Einreicher zu den Aussagen aus ihren eigenen Texten abgeleitet und als Votum gewertet — überall sichtbar als „abgeleitet“ gekennzeichnet. Ein Votum wird erst gespeichert, wenn alle Text-Abschnitte eines Einreichers verarbeitet sind; Widersprüche werden zu „Enthaltung“.",
        note: "Im echten Verfahren ergänzt diese Stufe die Live-Beteiligung (Stellungnahmen zählen mit), sie ersetzt sie nicht.",
        prompts: [{ label: "Stance-Prompt", text: STANCE_SYSTEM }],
      },
    ],
  },
  {
    title: "Phase 3 — Auswertung",
    paper: "Papier §8: „Cluster auf der Landkarte“",
    intro:
      "Ab hier wird gerechnet, nicht gemeint: Lager, Brücken und Diagnosen entstehen deterministisch aus der Abstimmungsmatrix und den Punkt-Typen — ohne jede KI-Unsicherheit. Wertungspunkte entscheidet die Maschine zu keinem Zeitpunkt.",
    stations: [
      {
        name: "Lager & Brücken",
        script: "analyze.ts",
        kinds: ["det"],
        text: "Das Polis-Verfahren: Wer ähnlich votet, bildet ein Lager (PCA + k-means, deterministisch, differentialgetestet gegen die Referenz-Implementierung). Brücken und Konfliktlinien folgen Signifikanztests; jede Aussage bekommt ein Zustimmungsprofil je Lager.",
      },
      {
        name: "Lager-Namen",
        script: "name-camps.ts",
        kinds: ["ki"],
        text: "Damit „Gruppe 0“ und „Gruppe 1“ lesbar werden, benennt ein Sprachmodell die Lager anhand ihrer charakteristischen Positionen — reine Benennung, keine Zahl wird angefasst.",
        prompts: [{ label: "Lager-Namen-Prompt", text: NAME_CAMPS_SYSTEM }],
      },
      {
        name: "Diagnose je Punkt",
        script: "diagnose-map.ts",
        kinds: ["det", "ki"],
        text: "Jeder kanonische Punkt bekommt seine Diagnose aus festen Schwellen: Brücke der Gründe (beide Lager ≥ 60 %), klärbar durch Gutachten (Tatsachenpunkt, Lager ≥ 15 Punkte auseinander), Wertdifferenz, Kernkonflikt (die größte Wert-Differenz der Maßnahme), offen. Türen ohne einen einzigen Einwand werden zu Lücken-Punkten — die ungestellte Frage als eigener Eintrag auf der Karte. Einzige KI-Beteiligung: Der Scheinbrücken-Check prüft bei Brücken, ob die sichtbaren Begründungen wirklich in dieselbe Richtung tragen; ein Fund wird als Warnung markiert — ausdrücklich als maschinelle Markierung mit redaktionellem Prüfvermerk, nicht als Faktum.",
        prompts: [{ label: "Scheinbrücken-Check-Prompt", text: REASONS_CHECK_SYSTEM }],
      },
    ],
  },
  {
    title: "Phase 4 — Bericht",
    paper: "Papier §8: „Die Maschine rechnet, der Mensch entscheidet“",
    intro:
      "Die Schlussfolgerungen sind gerechnet und für die Maschine bindend. Das Sprachmodell formuliert sie aus — es darf sie nicht verändern, nicht abschwächen und nicht umdrehen. Beim Lesen der fertigen Landkarte rechnet keine KI mehr.",
    stations: [
      {
        name: "Befund je Punkt",
        script: "diagnose-map.ts (Befund-Teil)",
        kinds: ["ki"],
        text: "Zu jeder gerechneten Diagnose entsteht der Befund: zwei bis fünf Sätze Klartext, die sagen, was die Zahlen zeigen, was daraus für das Verfahren folgt (Kurzgutachten? Ratsentscheidung? Lücke schließen?) und was im Material dahintersteht. Die Diagnose selbst ist dem Modell vorgegeben und unantastbar.",
        prompts: [{ label: "Befund-Prompt (mit Bindungsregel)", text: BEFUND_SYSTEM }],
      },
      {
        name: "Die Landkarte",
        script: "render-landkarte.ts",
        kinds: ["det"],
        text: "Aus den Daten wird je Maßnahme eine eigenständige Seite gebaut: das Grundmuster als Leiste, die Zone der Gutachter mit ihren Bezirken, die Zone des Rates, die Ausgestaltung — jeder Punkt mit Lagerprofil, Befund, Originalzitaten und aufklappbarer Beleg-Schicht. Reines Rendern, keine KI.",
      },
    ],
  },
];

const AUX: { label: string; text: string }[] = [
  { label: "Themen-Cluster (cluster-themes.ts)", text: THEMES_PROPOSE_SYSTEM + "\n\n---\n\n" + THEMES_ASSIGN_SYSTEM },
  { label: "Kurz-Labels (shorten-labels.ts)", text: SHORTEN_LABELS_SYSTEM },
];

function badge(k: Kind): string {
  const m = KIND[k];
  const dashed = k === "plan" ? "border-style:dashed;" : "";
  return `<span class="badge" style="color:${m.fg};background:${m.bg};border:1px solid ${m.border};${dashed}">${m.label}</span>`;
}

function stationHtml(s: Station, n: number): string {
  const prompts = (s.prompts ?? [])
    .map(
      (p) =>
        `<details class="prompt"><summary>Prompt ansehen: ${esc(p.label)}</summary><pre>${esc(p.text)}</pre></details>`,
    )
    .join("");
  return `<div class="station${s.kinds.includes("plan") ? " station-plan" : ""}">
    <div class="station-head">
      <span class="station-num">${n}</span>
      <strong>${esc(s.name)}</strong>
      ${s.script ? `<code>${esc(s.script)}</code>` : ""}
      ${s.kinds.map(badge).join("")}
    </div>
    <p>${esc(s.text)}</p>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
    ${prompts}
  </div>`;
}

function main() {
  const outDir = resolve(arg("out") ?? "../../../docs/landkarte");
  mkdirSync(outDir, { recursive: true });

  let n = 0;
  const phases = PHASES.map(
    (ph) => `<section class="phase">
      <h2>${esc(ph.title)}</h2>
      <p class="paper-ref">${esc(ph.paper)}</p>
      <p class="phase-intro">${esc(ph.intro)}</p>
      ${ph.stations.map((s) => stationHtml(s, ++n)).join("")}
    </section>`,
  ).join("");

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
  .wrap { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  .kicker { font-size:.75rem; letter-spacing:.1em; text-transform:uppercase; color:#6B6E76; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight:500; font-size:1.875rem; margin:.25rem 0 0; }
  .sub { font-size:.9rem; color:#6B6E76; margin-top:.5rem; max-width:44rem; }
  .principle { margin-top:1rem; background:#FFF; border:1px solid #E3E1D8; border-left:4px solid #0F6E56;
    border-radius:.6rem; padding:.8rem 1rem; font-size:.9rem; }
  .legend { margin-top:.9rem; display:flex; flex-wrap:wrap; gap:.4rem; }
  .badge { font-size:.7rem; border-radius:9999px; padding:.12rem .55rem; white-space:nowrap; }
  .phase { margin-top:2.2rem; }
  .phase h2 { font-family:Georgia,serif; font-weight:500; font-size:1.35rem; margin:0; }
  .paper-ref { font-size:.75rem; color:#9A6A14; margin:.15rem 0 0; }
  .phase-intro { font-size:.9rem; color:#6B6E76; margin:.4rem 0 .9rem; max-width:44rem; }
  .station { position:relative; background:#FFF; border:1px solid #E3E1D8; border-radius:.75rem;
    padding:.9rem 1.1rem; margin:.6rem 0 .6rem 1.6rem; }
  .station::before { content:""; position:absolute; left:-1.05rem; top:-0.85rem; bottom:-0.85rem;
    width:2px; background:#B4B8A9; }
  .station:last-child::before { bottom:50%; }
  .station-plan { border-style:dashed; background:transparent; }
  .station-head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .station-num { position:absolute; left:-1.95rem; top:.95rem; width:1.75rem; height:1.75rem;
    border-radius:50%; background:#FBFAF6; border:2px solid #B4B8A9; color:#6B6E76;
    font-size:.72rem; font-weight:600; display:flex; align-items:center; justify-content:center; }
  .station-head strong { font-size:.95rem; }
  .station-head code { font-size:.7rem; color:#6B6E76; background:#F1EFE8; border-radius:.25rem; padding:.1rem .4rem; }
  .station p { font-size:.875rem; margin:.5rem 0 0; }
  .note { color:#9A6A14; background:#FBF3E0; border-radius:.4rem; padding:.4rem .6rem; font-size:.8rem !important; }
  details.prompt { margin-top:.55rem; font-size:.8rem; }
  details.prompt summary { cursor:pointer; color:#1E4A7A; }
  details.prompt pre { white-space:pre-wrap; background:#F1EFE8; border:1px solid #E3E1D8;
    border-radius:.5rem; padding:.7rem .9rem; font-size:.72rem; line-height:1.5; margin:.4rem 0 0; }
  .aux { margin-top:2.2rem; }
  .aux h2 { font-family:Georgia,serif; font-weight:500; font-size:1.1rem; }
  .foot { margin-top:2rem; font-size:.72rem; color:#6B6E76; }
  .backlink { font-size:.8rem; } .backlink a { color:#1E4A7A; }
</style>
</head>
<body>
<div class="wrap">
  <p class="backlink"><a href="index.html">← Zu den Landkarten</a></p>
  <p class="kicker">Methodik · Stand ${today} · alle Prompts im Original aus dem laufenden System</p>
  <h1>So entsteht die Landkarte des Streits</h1>
  <p class="sub">Die komplette Verarbeitungskette, geordnet nach den vier Phasen des Konzeptpapiers.
    Jede KI-Stufe zeigt den tatsächlichen System-Prompt, mit dem sie läuft — direkt aus dem Code eingebettet,
    nicht abgeschrieben. Jede Stufe ist wiederholbar, bricht bei Fehlern einzeln (nie im Ganzen) und
    protokolliert jede Entscheidung mit Modell und Prompt-Fassung im Audit-Log.</p>
  <p class="principle">Das Vertrauensprinzip auf jeder Ebene: <strong>Die Maschine schlägt vor, der Mensch gibt frei.
    Die Diagnosen werden gerechnet, nicht gemeint. Wertungsfragen entscheidet die Maschine nie.</strong></p>
  <div class="legend">${(Object.keys(KIND) as Kind[]).map(badge).join("")}</div>
  ${phases}
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
  console.log(`pipeline.html → ${outDir} (${n} Stationen)`);
  process.exit(0);
}

main();
