"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { Example } from "@/lib/beispiel";

/**
 * The opinion space (Meinungsraum) after Stephan's results page: every dot a person of the published
 * example, one cloud per camp. Choosing a statement colours every dot by that person's vote — the moment
 * Polis does best, here with the reading the Landkarte adds (bridge, real dispute, false consensus).
 */

const W = 640;
const H = 300;
const TOP = 46;
const CAMP_VARS = ["--ga", "--gb", "--gc", "--gd", "--ge"];
const VOTE = { a: "agree", d: "disagree", p: "pass", ".": "none" } as const;

interface Dot {
  x: number;
  y: number;
  camp: number;
  v: string;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Convex hull of the core of a camp (the 90 % closest to its centre), padded and smoothed. */
function hullPath(all: Dot[], pad: number): string {
  if (all.length < 3) return "";
  const mx = all.reduce((s, q) => s + q.x, 0) / all.length;
  const my = all.reduce((s, q) => s + q.y, 0) / all.length;
  const dist = (q: Dot) => Math.hypot(q.x - mx, q.y - my);
  const cut = all.map(dist).sort((a, b) => a - b)[Math.floor(all.length * 0.9)] ?? Infinity;
  const p = all.filter((q) => dist(q) <= cut).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Dot, a: Dot, b: Dot) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Dot[] = [];
  const up: Dot[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  if (h.length < 3) return "";
  const cx = h.reduce((s, q) => s + q.x, 0) / h.length;
  const cy = h.reduce((s, q) => s + q.y, 0) / h.length;
  const e = h.map((q) => {
    const l = Math.hypot(q.x - cx, q.y - cy) || 1;
    return { x: q.x + ((q.x - cx) / l) * pad, y: q.y + ((q.y - cy) / l) * pad };
  });
  let d = "";
  for (let i = 0; i < e.length; i++) {
    const p0 = e[i]!;
    const p1 = e[(i + 1) % e.length]!;
    const p2 = e[(i + 2) % e.length]!;
    if (i === 0) d += `M${round((p0.x + p1.x) / 2)},${round((p0.y + p1.y) / 2)}`;
    d += `Q${round(p1.x)},${round(p1.y)} ${round((p1.x + p2.x) / 2)},${round((p1.y + p2.y) / 2)}`;
  }
  return `${d}Z`;
}

const pctOf = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

export function OpinionSpace({ example }: { example: Example }) {
  const { camps, statements } = example;
  const [sel, setSel] = useState<number | null>(null);
  // Positions come rounded from the server (0–1000), so server and browser draw the same picture.
  const dots = useMemo<Dot[]>(
    () =>
      example.people.map((p) => ({
        x: round(14 + (p.x / 1000) * (W - 28)),
        y: round(TOP + (p.y / 1000) * (H - TOP - 12)),
        camp: p.camp,
        v: p.v,
      })),
    [example.people],
  );
  const groups = useMemo(() => camps.map((_, g) => dots.filter((d) => d.camp === g)), [camps, dots]);
  const hulls = useMemo(() => groups.map((g) => hullPath(g, 10)), [groups]);
  const labelX = useMemo(() => {
    // Each camp's name above its cloud, kept apart and inside the picture.
    const xs = groups.map((g, i) => ({ i, x: g.length ? g.reduce((s, d) => s + d.x, 0) / g.length : ((i + 0.5) * W) / camps.length }));
    xs.sort((a, b) => a.x - b.x);
    const gap = Math.min(170, (W - 40) / Math.max(1, camps.length));
    for (let j = 0; j < xs.length; j++) {
      const lo = j ? xs[j - 1]!.x + gap : 20 + gap / 2;
      xs[j]!.x = Math.max(xs[j]!.x, lo);
    }
    for (let j = xs.length - 1; j >= 0; j--) {
      const hi = j < xs.length - 1 ? xs[j + 1]!.x - gap : W - 20 - gap / 2;
      xs[j]!.x = Math.min(xs[j]!.x, hi);
    }
    const out: number[] = [];
    for (const x of xs) out[x.i] = round(x.x);
    return out;
  }, [groups, camps.length]);

  useEffect(() => {
    // The one orchestrated moment: the cloud appears grey, then takes sides.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setSel(0), reduce ? 0 : 900);
    return () => window.clearTimeout(t);
  }, []);

  // The numbers below read in the same order as the clouds above, left to right.
  const order = useMemo(() => camps.map((_, g) => g).sort((a, b) => (labelX[a] ?? 0) - (labelX[b] ?? 0)), [camps, labelX]);
  const cur = sel == null ? null : statements[sel]!;
  const total = camps.reduce((s, c) => s + c.n, 0);
  const campWord = camps.length === 2 ? "zwei Lager" : camps.length === 3 ? "drei Lager" : `${camps.length} Lager`;

  return (
    <figure className="os">
      <div className="os-map">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={
            cur
              ? `Meinungsraum: ${cur.text}. ${camps.map((c, g) => `${pctOf(cur.camps[g]?.agree ?? 0, cur.camps[g]?.seen ?? 0)} Prozent im Lager ${c.name}`).join(", ")} stimmen zu.`
              : `Meinungsraum mit ${total} Menschen in ${campWord}`
          }
        >
          {hulls.map((d, g) => (d ? <path key={g} d={d} className="os-hull" /> : null))}
          {camps.map((c, g) => (
            <g key={g}>
              <text x={labelX[g]} y={18} textAnchor="middle" className="os-lbl">
                {c.name}
              </text>
              <text x={labelX[g]} y={32} textAnchor="middle" className="os-lbl2">
                {c.n} Personen
              </text>
            </g>
          ))}
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={2.9} className={`os-dot ${cur ? VOTE[(d.v[sel!] ?? ".") as keyof typeof VOTE] : "pass"}`} />
          ))}
        </svg>
        <ul className="os-legend" aria-hidden>
          <li><i className="agree" /> stimmt zu</li>
          <li><i className="disagree" /> lehnt ab</li>
          <li><i className="pass" /> enthält sich oder nicht abgestimmt</li>
        </ul>
      </div>

      <div className="os-pick" role="group" aria-label="Aussage wählen">
        {statements.map((s, i) => (
          <button key={s.text} type="button" className="os-chip" aria-pressed={sel === i} onClick={() => setSel(i)}>
            {s.text}
          </button>
        ))}
      </div>

      <figcaption className="os-cap" aria-live="polite">
        {cur ? (
          <>
            <p className={`os-kind ${cur.tone}`}>{cur.label}</p>
            <div className="os-scores" style={{ gridTemplateColumns: `repeat(${camps.length}, 1fr)` }}>
              {order.map((g) => ({ c: camps[g]!, g })).map(({ c, g }) => (
                <div key={g} className="os-score" style={{ borderTopColor: `var(${CAMP_VARS[g] ?? "--ink-3"})` }}>
                  <span className="os-who">{c.name}</span>
                  <span className="os-big num">
                    {pctOf(cur.camps[g]?.agree ?? 0, cur.camps[g]?.seen ?? 0)}
                    <small> %</small>
                  </span>
                  <span className="os-abs num">
                    {cur.camps[g]?.agree ?? 0} von {cur.camps[g]?.seen ?? 0} stimmen zu
                  </span>
                </div>
              ))}
            </div>
            <p className="os-reading">{cur.reading}</p>
          </>
        ) : (
          <p className="os-reading muted">
            {total} Menschen, {campWord}. Wählen Sie eine Aussage.
          </p>
        )}
        <p className="small os-more">
          <Link href={`${example.href}/ergebnis`}>Das ganze Ergebnis ansehen</Link>
        </p>
      </figcaption>
    </figure>
  );
}
