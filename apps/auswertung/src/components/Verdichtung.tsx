"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The one motion moment (idea 7): from the statements to the Landkarte in
 * seconds. Each organisation's statement is a bar (height = length); its
 * arguments burst out as dots, flow into the measures they concern, and
 * condense into Landkarten-Punkte coloured by diagnosis. Static final frame
 * under prefers-reduced-motion.
 */

interface Props {
  orgs: { short: string; chars: number; points: number; camp: "a" | "b" | null }[];
  measures: { display: string; points: number; extraction: number; counts: Partial<Record<string, number>> }[];
  stats: { pages: number; points: number; mapPoints: number; statements: number };
  camps: { name: string; size: number; side: "a" | "b" }[];
}

const STAGES = [
  (p: Props) => `${p.stats.statements} Stellungnahmen, rund ${p.stats.pages.toLocaleString("de-DE")} Seiten`,
  (p: Props) => `${p.stats.points.toLocaleString("de-DE")} einzelne Argumente`,
  (p: Props) => `${p.stats.mapPoints} Streitfragen in ${p.measures.length} Teilentscheidungen`,
  (p: Props) => `Zwei Lager: ${p.camps.map((c) => `${c.name} (${c.size})`).join(" und ")}`,
];
const T = { docs: 900, burst: 2400, flow: 4300, condense: 5800, camps: 6800 };
const TONE: Record<string, string> = {
  bruecke: "--bridge", warnung: "--political", klaerbar: "--evidence", wert: "--political", kern: "--political",
  gestaltung: "--design", offen: "--open",
};

/** Largest-remainder allocation of n items by weights. */
function allocate(n: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (w / total) * n);
  const out = raw.map(Math.floor);
  let rest = n - out.reduce((s, x) => s + x, 0);
  raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (rest-- > 0) out[i]!++;
  });
  return out;
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// Deterministic jitter (no Math.random: the picture is the same every time).
const jit = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function Verdichtung(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [run, setRun] = useState(0);

  const draw = useCallback(
    (elapsed: number) => {
      const c = canvas.current;
      const b = box.current;
      if (!c || !b) return;
      const W = b.clientWidth;
      const H = Math.max(220, Math.min(300, W * 0.32));
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        c.style.height = `${H}px`;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const css = getComputedStyle(document.documentElement);
      const col = (v: string) => css.getPropertyValue(v).trim() || "#888";
      const ink = col("--ink");
      const campB = col("--camp-b");

      // Geometry: documents left, measures right.
      const docsW = W * 0.24;
      const base = H - 28;
      const maxChars = Math.max(...props.orgs.map((o) => o.chars));
      // Hundreds of statements: hairline bars without gaps.
      const gap = props.orgs.length > 40 ? 0 : 4;
      const bw = Math.max(0.5, Math.min(16, (docsW - 8) / props.orgs.length - gap));
      const docX = (i: number) => 4 + i * (bw + gap);
      const docH = (o: Props["orgs"][number]) => 18 + (o.chars / maxChars) * (base - 40);
      const mx0 = W * 0.42;
      const mw = (W - mx0 - 4) / props.measures.length;
      const sq = Math.max(4, Math.min(9, mw / 3.2));

      // Documents.
      const pDocs = ease(elapsed / T.docs);
      props.orgs.forEach((o, i) => {
        const h = docH(o) * pDocs;
        const showCamp = elapsed > T.camps && o.camp;
        g.fillStyle = showCamp ? (o.camp === "a" ? ink : campB) : col("--rule-strong");
        g.fillRect(docX(i), base - h, bw, h);
      });

      // Arguments: allocated to documents by their points, to measures by extraction counts.
      const n = props.stats.points;
      const perDoc = allocate(n, props.orgs.map((o) => o.points));
      const perMeasure = allocate(n, props.measures.map((m) => m.extraction));
      const docOf: number[] = [];
      perDoc.forEach((k, i) => { for (let j = 0; j < k; j++) docOf.push(i); });
      const measOf: number[] = [];
      perMeasure.forEach((k, i) => { for (let j = 0; j < k; j++) measOf.push(i); });
      const seen = new Array(props.measures.length).fill(0) as number[];
      // Dot grid per measure: as dense as the fullest measure needs to fit the height.
      const fullest = Math.max(1, ...perMeasure);
      const cell = Math.max(1.2, Math.min(3.4, Math.sqrt(((mw - 6) * (base - 28)) / fullest)));
      const dot = Math.min(2, cell * 0.6);
      const pBurst = ease((elapsed - T.docs) / (T.burst - T.docs));
      const pFlow = ease((elapsed - T.burst) / (T.flow - T.burst));
      const pCond = ease((elapsed - T.flow) / (T.condense - T.flow));
      if (pBurst > 0 && pCond < 1) {
        g.globalAlpha = 1 - pCond;
        g.fillStyle = col("--ink-2");
        for (let i = 0; i < n; i++) {
          const d = docOf[(i * 7919) % n] ?? 0;
          const m = measOf[i] ?? 0;
          const slot = seen[m]!++;
          const sx = docX(d) + bw / 2;
          const sy = base - docH(props.orgs[d]!) * jit(i, 1);
          const cx = docsW + 12 + jit(i, 2) * (mx0 - docsW - 24);
          const cy = 14 + jit(i, 3) * (base - 28);
          const rows = Math.max(1, Math.floor((mw - 6) / cell));
          const tx = mx0 + m * mw + 3 + (slot % rows) * cell;
          const ty = base - 2 - Math.floor(slot / rows) * cell;
          const x = sx + (cx - sx) * pBurst + (tx - cx) * pFlow;
          const y = sy + (cy - sy) * pBurst + (ty - cy) * pFlow;
          g.fillRect(x, y, dot, dot);
        }
        g.globalAlpha = 1;
      }

      // Landkarten-Punkte: squares per measure, coloured by diagnosis.
      if (pCond > 0) {
        props.measures.forEach((m, mi) => {
          const tones: string[] = [];
          for (const k of ["bruecke", "warnung", "klaerbar", "kern", "wert", "gestaltung", "offen"]) {
            for (let j = 0; j < (m.counts[k] ?? 0); j++) tones.push(TONE[k]!);
          }
          const per = Math.max(1, Math.floor((mw - 4) / (sq + 2)));
          tones.forEach((t, j) => {
            const x = mx0 + mi * mw + 2 + (j % per) * (sq + 2);
            const y = base - sq - Math.floor(j / per) * (sq + 2);
            g.globalAlpha = Math.min(1, pCond * 1.4 - j * 0.01);
            g.fillStyle = col(t);
            g.fillRect(x, y, sq, sq);
          });
          g.globalAlpha = pCond;
          g.fillStyle = col("--muted");
          g.font = `500 11px ${css.getPropertyValue("--sans")}`;
          g.textAlign = "left";
          g.fillText(String(m.points), mx0 + mi * mw + 2, base - Math.ceil(tones.length / per) * (sq + 2) - 6);
          g.globalAlpha = 1;
        });
      }

      // Baseline and region labels.
      g.fillStyle = col("--rule");
      g.fillRect(0, base + 1, W, 1);
      g.fillStyle = col("--muted");
      g.font = `400 12px ${css.getPropertyValue("--sans")}`;
      g.textAlign = "left";
      g.fillText("Stellungnahmen", 4, H - 8);
      if (elapsed > T.flow) g.fillText(W < 640 ? "Teilentscheidungen" : "Teilentscheidungen und ihre Streitfragen", mx0 + 2, H - 8);

      setStage(elapsed < T.docs ? 0 : elapsed < T.flow ? 1 : elapsed < T.camps ? 2 : 3);
    },
    [props],
  );

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      draw(T.camps + 1000);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const e = now - start;
      draw(e);
      if (e < T.camps + 400) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => draw(Math.min(performance.now() - start, T.camps + 1000)));
    if (box.current) ro.observe(box.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [draw, run]);

  return (
    <figure className="verdichtung" aria-label="Wie aus den Stellungnahmen die Landkarte wird">
      <div ref={box} className="verdichtung-canvas">
        <canvas ref={canvas} aria-hidden />
      </div>
      <figcaption>
        <ol>
          {STAGES.map((s, i) => (
            <li key={i} className={i <= stage ? "on" : undefined}>
              {s(props)}
            </li>
          ))}
        </ol>
        <button type="button" className="btn no-print" onClick={() => setRun((r) => r + 1)}>
          Noch einmal abspielen
        </button>
      </figcaption>
    </figure>
  );
}
