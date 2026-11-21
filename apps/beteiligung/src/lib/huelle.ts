/** The outline of a camp's cloud of people: convex hull of its core (the 90 % closest to its centre), padded outwards and smoothed. */

export interface Pt {
  x: number;
  y: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** SVG path data; coordinates rounded so server and browser draw the same outline. Empty below three points. */
export function hullPath(all: Pt[], pad: number): string {
  if (all.length < 3) return "";
  const mx = all.reduce((s, q) => s + q.x, 0) / all.length;
  const my = all.reduce((s, q) => s + q.y, 0) / all.length;
  const dist = (q: Pt) => Math.hypot(q.x - mx, q.y - my);
  const cut = all.map(dist).sort((a, b) => a - b)[Math.floor(all.length * 0.9)] ?? Infinity;
  const p = all.filter((q) => dist(q) <= cut).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [];
  const up: Pt[] = [];
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
