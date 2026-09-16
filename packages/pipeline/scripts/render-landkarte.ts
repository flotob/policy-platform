/**
 * Render the Landkarte des Streits — one standalone HTML page per scope
 * (measure or 'übergreifend'), in the visual language of the concept
 * paper's original prototype (docs/landkarte1.html): paper ground, Georgia
 * serif, the practical-reasoning spine, the Gutachter/Rat zones with
 * districts, diagnosis-colored chips, detail panel with Lagerprofil,
 * Befund, and original quotes — plus the evidence layer (extraction
 * points) the prototype could only claim.
 *
 * Reads map_points (condense-map + diagnose-map must have run). No LLM.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/render-landkarte.ts --consultation <ref>
 *     [--out ../../../docs/landkarte]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface MapPoint {
  id: string;
  ord: number;
  typ: string;
  bezirk: string;
  text: string;
  label: string;
  diag: string | null;
  pa: number | null;
  pb: number | null;
  n_voted: number;
  befund: string | null;
  diag_flags: Record<string, unknown> | null;
  quotes: { lager: string; quelle: string; text: string }[] | null;
  members: string[];
}

const DIAG_META: Record<string, { label: string; fg: string; bg: string; stroke: string }> = {
  bruecke: { label: "Brücke der Gründe", fg: "#085041", bg: "#DFF1EA", stroke: "#0F6E56" },
  klaerbar: { label: "Klärbar durch Gutachten", fg: "#0C447C", bg: "#DCE9F6", stroke: "#185FA5" },
  offen: { label: "Offen — Evidenz fehlt", fg: "#444441", bg: "#EDECE4", stroke: "#5F5E5A" },
  wert: { label: "Wertdifferenz", fg: "#712B13", bg: "#F6E3DB", stroke: "#993C1D" },
  kern: { label: "Kernkonflikt — politisch zu entscheiden", fg: "#633806", bg: "#F7E8CB", stroke: "#9A6A14" },
  warnung: { label: "Warnung: Brücke der Ergebnisse", fg: "#633806", bg: "#F7E8CB", stroke: "#9A6A14" },
  luecke: { label: "Lücke — unbeantwortete Frage", fg: "#444441", bg: "none", stroke: "#5F5E5A" },
};

const TYP_LABEL: Record<string, string> = {
  T: "T · Tatsache",
  W: "W · Wertung",
  verfahren: "– · Verfahren",
  luecke: "? · Lücke",
};

const BEZIRKE: Record<string, { title: string; sub: string }> = {
  wirkung: { title: "Wirkung der Maßnahme", sub: "verhandelt P2 und P3 · Angriff: kritische Frage 1" },
  machbarkeit: { title: "Machbarkeit", sub: "kritische Frage 4" },
  kosten: { title: "Kosten und Nebenfolgen", sub: "kritische Frage 3 — Zielkonflikt" },
  alternativen: { title: "Alternativen", sub: "kritische Frage 2" },
  wert: { title: "", sub: "" },
  ausgestaltung: { title: "", sub: "" },
};

function chip(p: MapPoint): string {
  const m = DIAG_META[p.diag ?? "offen"] ?? DIAG_META.offen!;
  const dashed = p.diag === "luecke" ? "border-style:dashed;background:transparent;" : "";
  const kern = p.diag === "kern" ? "chip-kern" : "";
  const id = `P${String(p.ord).padStart(2, "0")}`;
  const sub =
    p.diag === "kern" && p.pa !== null
      ? `<span class="chip-sub">Kernkonflikt · ${p.pa} % : ${p.pb} %</span>`
      : "";
  return `<button class="chip ${kern}" data-id="${p.id}" style="background:${m.bg === "none" ? "transparent" : m.bg};border-color:${m.stroke};color:${m.fg};${dashed}">${id} · ${esc(p.label)}${sub}</button>`;
}

function districtBox(bezirk: string, points: MapPoint[]): string {
  if (points.length === 0) return "";
  const b = BEZIRKE[bezirk]!;
  return `<div class="district"><div class="district-head"><strong>${esc(b.title)}</strong><span>${esc(b.sub)}</span></div>${points.map(chip).join("")}</div>`;
}

function lagerBars(pa: number | null, pb: number | null, campA: string, campB: string): string {
  if (pa === null || pb === null)
    return `<p class="muted small">Keine belastbaren Abstimmungsdaten zu diesem Punkt.</p>`;
  const bar = (name: string, v: number, color: string) => `
    <div class="bar-row"><span class="bar-name">${esc(name)}</span>
      <span class="bar-track"><i style="width:${v}%;background:${color}"></i><i class="floor"></i></span>
      <span class="bar-val">${v} %</span></div>`;
  return `<div class="bars">${bar(campA, pa, "#44639A")}${bar(campB, pb, "#B26E24")}</div>`;
}

function detailHtml(p: MapPoint, campA: string, campB: string): string {
  const m = DIAG_META[p.diag ?? "offen"] ?? DIAG_META.offen!;
  const id = `P${String(p.ord).padStart(2, "0")}`;
  const flags = p.diag_flags ?? {};
  const reviewNote =
    p.diag === "warnung" && flags.scheinbruecke
      ? `<p class="review-note">⚠ Maschinell markiert (Begründungs-Check) — redaktionell zu prüfen.</p>`
      : typeof flags.reasons === "string" && flags.reasons === "same_reasons"
        ? `<p class="muted small">Begründungs-Check: die sichtbaren Gründe tragen in dieselbe Richtung.</p>`
        : "";
  const quotes = (p.quotes ?? [])
    .map(
      (q) =>
        `<blockquote><p>„${esc(q.text)}“</p><footer>${esc(q.quelle)}</footer></blockquote>`,
    )
    .join("");
  const members =
    p.members.length > 0
      ? `<details class="members"><summary>Beleg-Schicht: ${p.members.length} Extraktionspunkte darunter</summary><ul>${p.members
          .map((l) => `<li>${esc(l)}</li>`)
          .join("")}</ul></details>`
      : "";
  return `
    <div class="detail-head">
      <span class="pid">${id}</span>
      <span class="typ-badge">${TYP_LABEL[p.typ] ?? p.typ}</span>
      <span class="diag-badge" style="background:${m.bg === "none" ? "#F1EFE8" : m.bg};color:${m.fg}">${m.label}</span>
    </div>
    <p class="detail-text">${esc(p.text)}</p>
    ${lagerBars(p.pa, p.pb, campA, campB)}
    ${reviewNote}
    ${p.befund ? `<p class="befund">${esc(p.befund)}</p>` : ""}
    ${quotes}
    ${members}`;
}

function renderScope(input: {
  scope: string;
  displayScope: string;
  consultationTitle: string;
  campA: string;
  campB: string;
  sizeA: number;
  sizeB: number;
  participants: number;
  inferredNote: string;
  points: MapPoint[];
  indexHref: string;
}): string {
  const { points, campA, campB } = input;
  const by = (b: string) => points.filter((p) => p.bezirk === b);
  const wert = by("wert");
  const kern = wert.filter((p) => p.diag === "kern");
  const wertRest = wert.filter((p) => p.diag !== "kern");
  const counts = {
    punkte: points.filter((p) => p.typ !== "luecke").length,
    bruecken: points.filter((p) => p.diag === "bruecke").length,
    klaerbar: points.filter((p) => p.diag === "klaerbar").length,
    kern: kern.length,
    warnung: points.filter((p) => p.diag === "warnung").length,
    luecken: points.filter((p) => p.diag === "luecke").length,
  };
  const detailById = Object.fromEntries(
    points.map((p) => [p.id, detailHtml(p, campA, campB)]),
  );
  const listCards = points
    .map((p) => {
      const m = DIAG_META[p.diag ?? "offen"] ?? DIAG_META.offen!;
      return `<div class="list-card" data-diag="${p.diag ?? "offen"}" data-typ="${p.typ}" style="border-left:4px solid ${m.stroke}">${detailHtml(p, campA, campB)}</div>`;
    })
    .join("");

  const spine = [
    ["P1 · Lage", "Lagebeschreibung", "#EDECE4", "#5F5E5A"],
    ["P2 · Wirkung", "Prognose", "#DCE9F6", "#185FA5"],
    ["P3 · Ziel", "Zielerreichung", "#DCE9F6", "#185FA5"],
    ["P4 · Wert", "reine Wertung", "#F7E8CB", "#9A6A14"],
    ["Also: Maßnahme", "Schluss", "#EDECE4", "#5F5E5A"],
  ]
    .map(
      ([t, s, bg, st]) =>
        `<div class="spine-slot" style="background:${bg};border-color:${st}"><strong>${t}</strong><span>${s}</span></div>`,
    )
    .join('<span class="spine-arrow">→</span>');

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landkarte des Streits — ${esc(input.displayScope)}</title>
<style>
  :root { --paper:#FBFAF6; --card:#FFF; --ink:#1C1E24; --muted:#6B6E76; --line:#E3E1D8;
    --amberBg:#FBF3E0; --amberLine:#E4C990; --amber:#9A6A14; --blueBg:#EDF2F8; --blue:#1E4A7A;
    --grayBg:#F1EFE8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); line-height:1.5;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  .kicker { font-size:.75rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight:500; font-size:1.875rem; margin:.25rem 0 0; }
  .sub { font-size:.875rem; color:var(--muted); margin-top:.5rem; }
  .stats { margin-top:1.25rem; background:var(--card); border:1px solid var(--line); border-radius:.75rem;
    padding:1rem; display:flex; flex-wrap:wrap; gap:.5rem 1.5rem; }
  .stats b { display:block; font-family:Georgia,serif; font-weight:500; font-size:1.25rem; }
  .stats span { font-size:.75rem; color:var(--muted); }
  .camps { margin-top:.75rem; font-size:.8rem; color:var(--muted); }
  .camps i { display:inline-block; width:9px; height:9px; border-radius:50%; vertical-align:baseline; margin-right:.25rem; }
  .views { margin-top:1rem; display:flex; gap:.5rem; flex-wrap:wrap; }
  .views button, .filters button { font:inherit; font-size:.875rem; padding:.375rem 1rem; border-radius:9999px;
    border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  .views button.on, .filters button.on { background:var(--ink); color:#fff; border-color:var(--ink); }
  .mapcard { margin-top:1rem; background:var(--card); border:1px solid var(--line); border-radius:.75rem; padding:1rem; }
  .measure-box { margin:0 auto; max-width:22rem; background:var(--grayBg); border:1px solid #5F5E5A;
    border-radius:.5rem; text-align:center; padding:.5rem .75rem; }
  .measure-box strong { font-size:.9rem; }
  .measure-box span { display:block; font-size:.72rem; color:var(--muted); }
  .spine-note { font-size:.72rem; color:var(--muted); margin:1rem 0 .25rem; }
  .spine { display:flex; align-items:stretch; gap:.25rem; flex-wrap:wrap; }
  .spine-slot { flex:1 1 6rem; border:1px solid; border-radius:.45rem; padding:.3rem .4rem; text-align:center; min-width:6rem; }
  .spine-slot strong { display:block; font-size:.72rem; }
  .spine-slot span { font-size:.66rem; color:var(--muted); }
  .spine-arrow { align-self:center; color:var(--muted); font-size:.8rem; }
  .zone { margin-top:1rem; border-radius:1rem; padding:.9rem; }
  .zone-gutachter { background:var(--blueBg); border:1px solid #C6D6E8; }
  .zone-rat { background:var(--amberBg); border:1px solid var(--amberLine); }
  .zone-ausgestaltung { background:var(--grayBg); border:1px solid var(--line); }
  .zone-head { font-weight:600; font-size:.9rem; }
  .zone-gutachter .zone-head { color:var(--blue); }
  .zone-rat .zone-head { color:var(--amber); }
  .zone-sub { font-size:.72rem; color:var(--muted); margin-bottom:.5rem; }
  .zone-ausgestaltung .zone-head { color:#5F5E5A; }
  .districts { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; margin-top:.5rem; }
  @media (max-width:600px){ .districts { grid-template-columns:1fr; } }
  .district { background:var(--card); border:1px solid var(--line); border-radius:.6rem; padding:.6rem; }
  .district-head { margin-bottom:.4rem; }
  .district-head strong { display:block; font-size:.82rem; }
  .district-head span { font-size:.68rem; color:var(--muted); }
  .chip { display:block; width:100%; text-align:left; font:inherit; font-size:.78rem; margin-top:.35rem;
    border:1px solid; border-radius:.35rem; padding:.3rem .5rem; cursor:pointer; }
  .chip:hover { filter:brightness(.96); }
  .chip.sel { outline:2.5px solid var(--ink); }
  .chip-kern { font-weight:600; font-size:.84rem; padding:.45rem .5rem; }
  .chip-sub { display:block; font-weight:400; font-size:.7rem; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:.35rem .6rem; margin-top:.4rem; }
  @media (max-width:600px){ .grid2 { grid-template-columns:1fr; } }
  .grid2 .chip { margin-top:0; }
  .kern-slot { margin-top:.6rem; }
  .legend { margin-top:.75rem; font-size:.72rem; color:var(--muted); display:flex; flex-wrap:wrap; gap:.25rem 1rem; }
  .legend i { font-style:normal; }
  .detail { margin-top:.9rem; background:var(--card); border:1px solid var(--line); border-radius:.75rem; padding:1rem; }
  .detail-head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
  .pid { font-size:.75rem; color:var(--muted); font-weight:600; }
  .typ-badge { font-size:.72rem; border:1px solid var(--line); border-radius:.25rem; padding:.1rem .4rem; background:var(--grayBg); }
  .diag-badge { font-size:.72rem; border-radius:9999px; padding:.15rem .6rem; }
  .detail-text { font-family:Georgia,serif; font-size:1.05rem; margin:.6rem 0 .4rem; }
  .bars { margin:.5rem 0; display:grid; gap:.3rem; }
  .bar-row { display:grid; grid-template-columns:minmax(8rem,14rem) 1fr 3rem; gap:.5rem; align-items:center; font-size:.75rem; }
  .bar-name { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { position:relative; height:9px; background:var(--line); border-radius:5px; overflow:hidden; }
  .bar-track i { position:absolute; inset:0 auto 0 0; border-radius:5px; }
  .bar-track .floor { left:60%; width:2px; background:var(--card); inset:0 auto 0 60%; }
  .bar-val { text-align:right; font-variant-numeric:tabular-nums; }
  .review-note { font-size:.8rem; color:var(--amber); background:var(--amberBg); border-radius:.4rem; padding:.35rem .6rem; }
  .befund { font-size:.9rem; margin:.6rem 0; }
  blockquote { margin:.6rem 0; padding:.5rem .8rem; border-left:3px solid var(--line); background:var(--grayBg); border-radius:0 .4rem .4rem 0; }
  blockquote p { margin:0; font-size:.85rem; font-style:italic; }
  blockquote footer { font-size:.72rem; color:var(--muted); margin-top:.25rem; }
  .members { margin-top:.6rem; font-size:.8rem; }
  .members summary { cursor:pointer; color:var(--blue); }
  .members ul { margin:.4rem 0 0; padding-left:1.2rem; color:var(--muted); }
  .filters { margin-top:1rem; display:flex; gap:.4rem; flex-wrap:wrap; }
  .list-card { margin-top:.75rem; background:var(--card); border:1px solid var(--line); border-radius:.75rem; padding:1rem; }
  .muted { color:var(--muted); } .small { font-size:.8rem; }
  .foot { margin-top:1.5rem; font-size:.72rem; color:var(--muted); }
  .backlink { font-size:.8rem; } .backlink a { color:var(--blue); }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <p class="backlink"><a href="${input.indexHref}">← Alle Landkarten dieser Konsultation</a></p>
  <p class="kicker">Online-Anhang zum Konsultationsbericht · Echte Daten · Entwurf, redaktionelle Freigabe ausstehend</p>
  <h1>Landkarte des Streits: ${esc(input.displayScope)}</h1>
  <p class="sub">${esc(input.consultationTitle)} · ${input.participants} Teilnehmende. ${esc(input.inferredNote)}
    Jeder Punkt ist bis auf die Originalzitate und die Extraktionsebene rückverfolgbar. Die Befunde sind deterministisch
    aus Abstimmungsprofilen und Punkttypen abgeleitet und nur sprachlich ausformuliert.</p>
  <div class="stats">
    <div><b>${input.participants}</b><span>Teilnehmende</span></div>
    <div><b>${counts.punkte}</b><span>Punkte</span></div>
    <div><b>${counts.bruecken}</b><span>Brücken</span></div>
    <div><b>${counts.klaerbar}</b><span>Klärfälle</span></div>
    <div><b style="color:var(--amber)">${counts.kern}</b><span>Kernkonflikt</span></div>
    <div><b>${counts.luecken}</b><span>Lücken</span></div>
  </div>
  <p class="camps"><i style="background:#44639A"></i>${esc(campA)} (${input.sizeA} Beteiligte) &nbsp; <i style="background:#B26E24"></i>${esc(campB)} (${input.sizeB} Beteiligte)</p>
  <div class="views">
    <button id="btn-karte" class="on">Kartenansicht</button>
    <button id="btn-liste">Listenansicht</button>
  </div>

  <div id="view-karte">
    <div class="mapcard">
      <div class="measure-box"><strong>${esc(input.displayScope)}</strong><span>Maßnahme — die Streitfrage</span></div>
      <p class="spine-note">Das Grundmuster: praktisches Schließen — die Grammatik hinter allen Punkten</p>
      <div class="spine">${spine}</div>
      <div class="zone zone-gutachter">
        <div class="zone-head">Zone der Gutachter — durch Evidenz klärbar</div>
        <div class="zone-sub">Tatsachenpunkte: durch Daten, Gutachten, Vergleichsfälle zu klären</div>
        <div class="districts">
          ${districtBox("wirkung", by("wirkung"))}
          ${districtBox("machbarkeit", by("machbarkeit"))}
          ${districtBox("kosten", by("kosten"))}
          ${districtBox("alternativen", by("alternativen"))}
        </div>
      </div>
      <div class="zone zone-rat">
        <div class="zone-head">Zone des Rates — politisch zu entscheiden</div>
        <div class="zone-sub">verhandelt Prämisse P4 · Angriff: kritische Frage 5 — keine Studie kann hier entscheiden</div>
        <div class="grid2">${wertRest.map(chip).join("")}</div>
        ${kern.length > 0 ? `<div class="kern-slot">${kern.map(chip).join("")}</div>` : ""}
      </div>
      <div class="zone zone-ausgestaltung">
        <div class="zone-head">Ausgestaltung — wirkt erst nach der Grundsatzentscheidung</div>
        <div class="grid2">${by("ausgestaltung").map(chip).join("")}</div>
      </div>
      <div class="legend">
        ${Object.entries(DIAG_META)
          .filter(([k]) => k !== "warnung")
          .map(([k, m]) => `<span><i style="color:${m.stroke}">${k === "luecke" ? "□" : "■"}</i> ${m.label}</span>`)
          .join("")}
      </div>
      <div class="detail" id="detail"><p class="muted small">Wähle einen Punkt auf der Karte, um Lagerprofil, Befund und Originalzitate zu sehen.</p></div>
    </div>
  </div>

  <div id="view-liste" hidden>
    <div class="filters">
      <button data-f="alle" class="on">Alle Punkte</button>
      <button data-f="bruecke">Brücken (${counts.bruecken})</button>
      <button data-f="konflikt">Kernkonflikt &amp; Wertdifferenzen</button>
      <button data-f="klaer">Warnungen &amp; Klärfälle</button>
      <button data-f="T">Nur Tatsachen [T]</button>
      <button data-f="W">Nur Wertungen [W]</button>
    </div>
    <div id="list">${listCards}</div>
  </div>

  <p class="foot">Methodik: Zerlegung der Stellungnahmen per Sprachmodell in Schablonen (praktisches Schließen, fünf kritische Fragen),
    Verdichtung auf kanonische Landkarten-Punkte mit vollständiger Zuordnung der Extraktionsebene · Voten teils direkt, teils aus
    Freitext abgeleitet und gekennzeichnet · Lagerbildung und Brückenwerte statistisch aus der Abstimmungsmatrix (Verfahren nach Polis) ·
    Diagnosen deterministisch gerechnet, Wertungspunkte zu keinem Zeitpunkt maschinell entschieden · Befunde sprachlich ausformuliert
    bei bindender Schlussfolgerung · Jeder Schritt ist protokolliert (Audit-Log). Entwurf — redaktionelle Freigabe ausstehend.</p>
</div>
<script>
var DETAILS = ${JSON.stringify(detailById).replace(/<\//g, "<\\/")};
var sel = null;
document.querySelectorAll('.chip').forEach(function (c) {
  c.addEventListener('click', function () {
    if (sel) sel.classList.remove('sel');
    sel = c; c.classList.add('sel');
    document.getElementById('detail').innerHTML = DETAILS[c.dataset.id];
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
});
var bk = document.getElementById('btn-karte'), bl = document.getElementById('btn-liste');
function view(karte) {
  document.getElementById('view-karte').hidden = !karte;
  document.getElementById('view-liste').hidden = karte;
  bk.classList.toggle('on', karte); bl.classList.toggle('on', !karte);
}
bk.addEventListener('click', function () { view(true); });
bl.addEventListener('click', function () { view(false); });
document.querySelectorAll('.filters button').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelectorAll('.filters button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    var f = b.dataset.f;
    document.querySelectorAll('.list-card').forEach(function (card) {
      var d = card.dataset.diag, t = card.dataset.typ, show = true;
      if (f === 'bruecke') show = d === 'bruecke';
      else if (f === 'konflikt') show = d === 'kern' || d === 'wert';
      else if (f === 'klaer') show = d === 'warnung' || d === 'klaerbar' || d === 'offen' || d === 'luecke';
      else if (f === 'T' || f === 'W') show = t === f;
      card.hidden = !show;
    });
  });
});
</script>
</body>
</html>`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const outDir = resolve(arg("out") ?? "../../../docs/landkarte");

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, title FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, title } = cons.rows[0] as { id: string; title: string };

  const runRes = await db.execute(sql`
    SELECT result FROM analysis_runs WHERE consultation_id = ${consultationId}
    ORDER BY created_at DESC LIMIT 1
  `);
  const analysis = (runRes.rows[0]?.result ?? null) as {
    clustering: { groupSizes: Record<string, number> };
    campNames?: Record<string, { name: string }>;
  } | null;
  if (!analysis) throw new Error("no analysis run");
  const top2 = Object.entries(analysis.clustering.groupSizes)
    .map(([g, n]) => ({ g: Number(g), n }))
    .sort((a, b) => b.n - a.n || a.g - b.g)
    .slice(0, 2);
  const campA = analysis.campNames?.[String(top2[0]!.g)]?.name ?? `Lager ${top2[0]!.g}`;
  const campB = analysis.campNames?.[String(top2[1]!.g)]?.name ?? `Lager ${top2[1]!.g}`;

  const statsRes = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM participants pa WHERE pa.consultation_id = ${consultationId})::int AS participants,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${consultationId})::int AS votes,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${consultationId} AND v.method = 'inferred')::int AS inferred
  `);
  const st = statsRes.rows[0] as { participants: number; votes: number; inferred: number };
  const inferredNote =
    st.inferred > 0
      ? `${st.votes.toLocaleString("de-DE")} Voten, davon ${st.inferred.toLocaleString("de-DE")} aus den Freitext-Stellungnahmen abgeleitet und gekennzeichnet.`
      : `${st.votes.toLocaleString("de-DE")} Voten.`;

  const scopesRes = await db.execute(sql`
    SELECT DISTINCT scope FROM map_points WHERE consultation_id = ${consultationId} ORDER BY scope
  `);
  const scopes = (scopesRes.rows as { scope: string }[]).map((r) => r.scope);
  mkdirSync(outDir, { recursive: true });

  const indexRows: { scope: string; display: string; file: string; counts: string }[] = [];
  for (const scope of scopes) {
    const rowsRes = await db.execute(sql`
      SELECT mp.id, mp.ord, mp.typ, mp.bezirk, mp.text, mp.label, mp.diag, mp.pa, mp.pb,
        mp.n_voted, mp.befund, mp.diag_flags, mp.quotes,
        COALESCE((SELECT json_agg(p.label ORDER BY p.created_at) FROM points p
          WHERE p.map_point_id = mp.id), '[]'::json) AS members
      FROM map_points mp
      WHERE mp.consultation_id = ${consultationId} AND mp.scope = ${scope}
      ORDER BY mp.ord
    `);
    const points = (rowsRes.rows as unknown as (Omit<MapPoint, "members"> & { members: string[] })[]);
    const displayScope = scope === "übergreifend" ? "Das Vorhaben als Ganzes" : scope;
    const html = renderScope({
      scope,
      displayScope,
      consultationTitle: title,
      campA,
      campB,
      sizeA: top2[0]!.n,
      sizeB: top2[1]!.n,
      participants: st.participants,
      inferredNote,
      points,
      indexHref: "index.html",
    });
    const file = `${slug(displayScope)}.html`;
    writeFileSync(`${outDir}/${file}`, html);
    const c = {
      punkte: points.filter((p) => p.typ !== "luecke").length,
      bruecken: points.filter((p) => p.diag === "bruecke").length,
      kern: points.filter((p) => p.diag === "kern").length,
      luecken: points.filter((p) => p.diag === "luecke").length,
    };
    indexRows.push({
      scope,
      display: displayScope,
      file,
      counts: `${c.punkte} Punkte · ${c.bruecken} Brücken · ${c.kern} Kernkonflikt · ${c.luecken} Lücken`,
    });
    console.log(`  ${file}: ${points.length} points`);
  }

  const index = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landkarten des Streits — ${esc(title)}</title>
<style>
  body { margin:0; background:#FBFAF6; color:#1C1E24; font-family:system-ui,sans-serif; line-height:1.5; }
  .wrap { max-width:48rem; margin:0 auto; padding:2rem 1rem 4rem; }
  .kicker { font-size:.75rem; letter-spacing:.1em; text-transform:uppercase; color:#6B6E76; }
  h1 { font-family:Georgia,serif; font-weight:500; font-size:1.875rem; margin:.25rem 0 0; }
  .sub { font-size:.875rem; color:#6B6E76; margin-top:.5rem; }
  a.card { display:block; background:#FFF; border:1px solid #E3E1D8; border-radius:.75rem; padding:1rem 1.25rem;
    margin-top:.75rem; text-decoration:none; color:inherit; }
  a.card:hover { border-color:#0F6E56; }
  a.card strong { font-family:Georgia,serif; font-weight:500; font-size:1.1rem; }
  a.card span { display:block; font-size:.78rem; color:#6B6E76; margin-top:.25rem; }
</style></head><body><div class="wrap">
  <p class="kicker">Online-Anhang zum Konsultationsbericht · Echte Daten · Entwurf</p>
  <h1>Landkarten des Streits</h1>
  <p class="sub">${esc(title)} · ${st.participants} Teilnehmende · eine Landkarte je Teilentscheidung.</p>
  ${indexRows
    .sort((a, b) => (a.scope === "übergreifend" ? -1 : b.scope === "übergreifend" ? 1 : a.display.localeCompare(b.display)))
    .map((r) => `<a class="card" href="${r.file}"><strong>${esc(r.display)}</strong><span>${r.counts}</span></a>`)
    .join("")}
  <a class="card" href="pipeline.html"><strong>So entsteht die Landkarte</strong><span>Die komplette Pipeline in den vier Phasen des Konzeptpapiers — mit allen Prompts im Original.</span></a>
</div></body></html>`;
  writeFileSync(`${outDir}/index.html`, index);
  console.log(`index.html: ${indexRows.length} maps → ${outDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
