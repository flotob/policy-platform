"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The opinion space (Meinungsraum) after Stephan's results page: every dot a
 * person, two clouds = two camps. Choosing a statement colours every dot by
 * that person's vote — the moment Polis does best, here with the reading the
 * Landkarte adds (bridge, real dispute, false consensus).
 *
 * Demo data from Stephan's fictional Musterstadt example; the votes are drawn
 * deterministically from the camp values, so the picture is the same on
 * every load.
 */

export interface DemoStatement {
  id: number;
  text: string;
  /** Agreement in camp A and B, percent. */
  a: number;
  b: number;
  kind: "bruecke" | "streit" | "warnung" | "klaerbar";
  reading: string;
}

const KIND = {
  bruecke: { label: "Darauf einigen sich beide Lager", cls: "agree" },
  streit: { label: "Hier liegt der Streit", cls: "disagree" },
  warnung: { label: "Vorsicht, Scheinkonsens", cls: "warn" },
  klaerbar: { label: "Mit einem Gutachten klärbar", cls: "warn" },
} as const;

const CAMPS = { A: { name: "Klima zuerst", n: 500 }, B: { name: "Kosten & Freiheit", n: 363 } };
const W = 640;
const H = 300;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Person {
  i: number;
  g: "A" | "B";
  x: number;
  y: number;
}

function people(): Person[] {
  const r = rng(2026);
  const out: Person[] = [];
  for (let i = 0; i < CAMPS.A.n + CAMPS.B.n; i++) {
    const g = i < CAMPS.A.n ? "A" : "B";
    const [cx, cy, sx, sy] = g === "A" ? [215, 160, 78, 52] : [445, 166, 66, 50];
    const x = cx + gauss(r) * sx * (0.55 + 0.45 * r());
    const y = cy + gauss(r) * sy * (0.55 + 0.45 * r());
    out.push({ i, g, x: Math.round(Math.max(12, Math.min(W - 12, x)) * 10) / 10, y: Math.round(Math.max(40, Math.min(H - 12, y)) * 10) / 10 });
  }
  return out;
}

/** Convex hull, padded and smoothed: the outline of a camp. */
function hullPath(pts: Person[], pad: number): string {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Person, a: Person, b: Person) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Person[] = [];
  const up: Person[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  const cx = h.reduce((s, q) => s + q.x, 0) / h.length;
  const cy = h.reduce((s, q) => s + q.y, 0) / h.length;
  const e = h.map((q) => {
    const dx = q.x - cx;
    const dy = q.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: q.x + (dx / l) * pad, y: q.y + (dy / l) * pad };
  });
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = "";
  for (let i = 0; i < e.length; i++) {
    const p0 = e[i]!;
    const p1 = e[(i + 1) % e.length]!;
    const p2 = e[(i + 2) % e.length]!;
    if (i === 0) d += `M${r((p0.x + p1.x) / 2)},${r((p0.y + p1.y) / 2)}`;
    d += `Q${r(p1.x)},${r(p1.y)} ${r((p1.x + p2.x) / 2)},${r((p1.y + p2.y) / 2)}`;
  }
  return `${d}Z`;
}

type Vote = "agree" | "disagree" | "pass";

function votesFor(s: DemoStatement, ps: Person[]): Vote[] {
  const r = rng(s.id * 7919 + 11);
  return ps.map((p) => {
    const pa = (p.g === "A" ? s.a : s.b) / 100;
    const x = r();
    if (x < pa) return "agree";
    const passShare = 0.25 + 0.15 * r();
    return (x - pa) / (1 - pa) < passShare ? "pass" : "disagree";
  });
}

export function OpinionSpace({ statements }: { statements: DemoStatement[] }) {
  // Dots are drawn on the client only: Math.log/cos may differ by one ULP
  // between server and browser and would break hydration.
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const ps = useMemo(() => (ready ? people() : []), [ready]);
  const hulls = useMemo(
    () => (ps.length ? { A: hullPath(ps.filter((p) => p.g === "A"), 12), B: hullPath(ps.filter((p) => p.g === "B"), 12) } : null),
    [ps],
  );
  const cur = sel == null ? null : statements[sel]!;
  const votes = useMemo(() => (cur ? votesFor(cur, ps) : null), [cur, ps]);

  useEffect(() => {
    setReady(true);
    // The one orchestrated moment: the cloud appears grey, then takes sides.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setSel(0), reduce ? 0 : 900);
    return () => window.clearTimeout(t);
  }, []);

  const count = (g: "A" | "B") => (votes ? ps.filter((p, i) => p.g === g && votes[i] === "agree").length : 0);

  return (
    <figure className="os">
      <div className="os-map">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cur ? `Meinungsraum: ${cur.text}. ${cur.a} Prozent im Lager ${CAMPS.A.name}, ${cur.b} Prozent im Lager ${CAMPS.B.name} stimmen zu.` : "Meinungsraum mit 863 Teilnehmenden in zwei Lagern"}>
          {hulls ? (
            <>
              <path d={hulls.A} className="os-hull" />
              <path d={hulls.B} className="os-hull" />
            </>
          ) : null}
          <text x={215} y={20} textAnchor="middle" className="os-lbl">
            Lager „{CAMPS.A.name}“
          </text>
          <text x={215} y={34} textAnchor="middle" className="os-lbl2">
            {CAMPS.A.n} Personen
          </text>
          <text x={445} y={20} textAnchor="middle" className="os-lbl">
            Lager „{CAMPS.B.name}“
          </text>
          <text x={445} y={34} textAnchor="middle" className="os-lbl2">
            {CAMPS.B.n} Personen
          </text>
          {ps.map((p, i) => (
            <circle key={p.i} cx={p.x} cy={p.y} r={2.9} className={`os-dot ${votes ? votes[i] : "pass"}`} />
          ))}
        </svg>
        <ul className="os-legend" aria-hidden>
          <li><i className="agree" /> stimmt zu</li>
          <li><i className="disagree" /> lehnt ab</li>
          <li><i className="pass" /> enthält sich</li>
        </ul>
      </div>

      <div className="os-pick" role="group" aria-label="Aussage wählen">
        {statements.map((s, i) => (
          <button key={s.id} type="button" className="os-chip" aria-pressed={sel === i} onClick={() => setSel(i)}>
            {s.text}
          </button>
        ))}
      </div>

      <figcaption className="os-cap" aria-live="polite">
        {cur ? (
          <>
            <p className={`os-kind ${KIND[cur.kind].cls}`}>{KIND[cur.kind].label}</p>
            <div className="os-scores">
              <div className="os-score a">
                <span className="os-who">{CAMPS.A.name}</span>
                <span className="os-big num">{cur.a}<small> %</small></span>
                <span className="os-abs num">{count("A")} von {CAMPS.A.n} stimmen zu</span>
              </div>
              <div className="os-score b">
                <span className="os-who">{CAMPS.B.name}</span>
                <span className="os-big num">{cur.b}<small> %</small></span>
                <span className="os-abs num">{count("B")} von {CAMPS.B.n} stimmen zu</span>
              </div>
            </div>
            <p className="os-reading">{cur.reading}</p>
          </>
        ) : (
          <p className="os-reading muted">863 Menschen aus Musterstadt, zwei Lager. Wählen Sie eine Aussage.</p>
        )}
      </figcaption>
    </figure>
  );
}
