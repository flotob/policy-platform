"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Example, ExampleStatement } from "@/lib/beispiel";
import { hullPath, type Pt } from "@/lib/huelle";

/**
 * The landing page's example, read from the published Musterstadt result (lib/beispiel.ts):
 * - HeroStage: the opening picture. Its people, scattered at first, gather into their camps; then the picture
 *   alternates between the statement the camps split on and one both camps carry.
 * - HeroAnswers: the three things the council gets; each opens its statement in the example below.
 * - BeispielFlow: the example read left to right: a statement, how each camp voted on it, what that means for the council.
 */

const EVENT = "streitbar:beispiel";
const CAMP_VARS = ["--ga", "--gb", "--gc", "--gd", "--ge"];
const VOTE = { a: "agree", d: "disagree", p: "pass", ".": "none" } as const;

type Want = "einig" | "tatsache" | "rat";

/** The statement each of the three answers stands for; -1 when the example has none. */
function pick(statements: ExampleStatement[], want: Want): number {
  if (want !== "rat") return statements.findIndex((s) => s.role === want);
  const dispute = statements.findIndex((s) => s.tone === "disagree");
  return dispute >= 0 ? dispute : statements.findIndex((s) => s.role === "kern");
}

const pctOf = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const round = (n: number) => Math.round(n * 10) / 10;

const ANSWERS: { want: Want; cls: string; title: string; text: string }[] = [
  {
    want: "einig",
    cls: "agree",
    title: "Worüber man sich einig ist",
    text: "Aussagen, die in allen Lagern eine Mehrheit haben. Darauf kann ein Beschluss bauen.",
  },
  {
    want: "tatsache",
    cls: "warn",
    title: "Was ein Gutachten klären kann",
    text: "Streit über Zahlen und Wirkungen. Hier hilft eine Untersuchung, keine Abstimmung.",
  },
  {
    want: "rat",
    cls: "disagree",
    title: "Was der Rat entscheiden muss",
    text: "Wertfragen, an denen sich die Lager scheiden. Die nimmt ihm keine Studie ab.",
  },
];

export function HeroAnswers({ linked }: { linked: boolean }) {
  return (
    <ul className="hero-answers">
      {ANSWERS.map((a) => {
        const body = (
          <>
            <span className={`lp-mark ${a.cls}`} aria-hidden />
            <span>
              <b>{a.title}</b>
              <span>{a.text}</span>
            </span>
          </>
        );
        return (
          <li key={a.want}>
            {linked ? (
              <a href="#beispiel" onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: a.want }))}>
                {body}
              </a>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Rgba = [number, number, number, number];

export function HeroStage({ example, children }: { example: Example | null; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  // Only beside the text on wide screens. On phones the picture would sit under the button as a long moving strip,
  // and the example right below shows the same people anyway: no canvas, no animation running there.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 961px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const cv = canvasRef.current;
    const textEl = textRef.current;
    const capEl = capRef.current;
    const ctx = cv?.getContext("2d");
    if (!example || !wide || !stage || !cv || !textEl || !capEl || !ctx) return;
    const ex = example;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const rgb = (name: string): [number, number, number] => {
      const h = css.getPropertyValue(name).trim().replace("#", "");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
    };
    const COL: Record<string, Rgba> = {
      a: [...rgb("--agree"), 1],
      d: [...rgb("--disagree"), 1],
      p: [...rgb("--pass"), 0.65],
      ".": [...rgb("--pass"), 0.35],
    };
    const campCol = ex.camps.map((_, g) => rgb(CAMP_VARS[g] ?? "--ink-3"));
    const ink2 = rgb("--ink-2");
    const font = getComputedStyle(document.body).fontFamily;
    const cycle = [pick(ex.statements, "rat"), pick(ex.statements, "einig")].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);

    // A fixed seed: the same scatter on every visit.
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const people = ex.people.map((p) => ({
      u: p.x / 1000,
      v: p.y / 1000,
      camp: p.camp,
      votes: p.v,
      su: rand(),
      sv: rand(),
      delay: rand() * 700,
      ph: rand() * 6.2832,
      from: COL.p!,
      to: COL.p!,
      at: 0,
      sx: 0,
      sy: 0,
      tx: 0,
      ty: 0,
    }));
    const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const colourAt = (p: (typeof people)[number], now: number): Rgba => {
      const k = Math.min(1, Math.max(0, (now - p.at) / 550));
      return p.from.map((v, i) => v + (p.to[i]! - v) * k) as Rgba;
    };

    let W = 0;
    let H = 0;
    let dpr = 1;
    let box = { x: 0, y: 0, w: 1, h: 1 };
    let camps: { name: string; cx: number; cy: number; rad: number; top: number; path: Path2D | null; col: [number, number, number] }[] = [];

    function layout() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv!.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv!.width = Math.round(W * dpr);
      cv!.height = Math.round(H * dpr);
      if (W >= 960) {
        // Beside the text, reaching a little past the page's right edge.
        const left = textEl!.getBoundingClientRect().right - r.left + 64;
        const right = W - Math.max(28, (W - 1180) / 2 - 40);
        box = { x: left, y: H * 0.18, w: Math.max(240, right - left), h: H * 0.56 };
      } else {
        box = { x: 20, y: 44, w: W - 40, h: H - 68 };
      }
      for (const p of people) {
        p.tx = box.x + p.u * box.w;
        p.ty = box.y + p.v * box.h;
        p.sx = box.x - box.w * 0.15 + p.su * box.w * 1.3;
        p.sy = box.y - box.h * 0.25 + p.sv * box.h * 1.5;
      }
      camps = ex.camps.map((c, g) => {
        const pts: Pt[] = people.filter((p) => p.camp === g).map((p) => ({ x: p.tx, y: p.ty }));
        const n = pts.length || 1;
        const cx = pts.reduce((s, q) => s + q.x, 0) / n;
        const cy = pts.reduce((s, q) => s + q.y, 0) / n;
        const rad = (pts.reduce((s, q) => s + Math.hypot(q.x - cx, q.y - cy), 0) / n) * 2.1;
        const top = pts.length ? Math.min(...pts.map((q) => q.y)) : cy;
        const d = hullPath(pts, 14);
        return { name: c.name, cx, cy, rad, top, path: d ? new Path2D(d) : null, col: campCol[g]! };
      });
      const sr = stage!.getBoundingClientRect();
      capEl!.style.left = `${r.left - sr.left + box.x}px`;
      capEl!.style.top = `${r.top - sr.top + box.y + box.h + 22}px`;
      capEl!.style.maxWidth = `${box.w}px`;
    }

    let t0: number | null = null;
    let shown = -1;
    let raf = 0;
    let visible = true;

    function recolour(i: number, now: number) {
      for (const p of people) {
        const to = COL[p.votes[i] ?? "."] ?? COL["."]!;
        p.from = still ? to : colourAt(p, now);
        p.to = to;
        p.at = still ? 0 : now + rand() * 300;
      }
      setCap(i);
    }

    function draw(now: number) {
      if (t0 === null) t0 = now;
      const t = still ? 1e7 : now - t0;
      if (t >= 3700 && cycle.length) {
        const i = still ? cycle[0]! : cycle[Math.floor((t - 3700) / 4600) % cycle.length]!;
        if (i !== shown) {
          shown = i;
          recolour(i, now);
        }
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);
      const pool = ease((t - 2000) / 1600);
      if (pool > 0) {
        for (const c of camps) {
          const g = ctx!.createRadialGradient(c.cx, c.cy, 0, c.cx, c.cy, c.rad);
          g.addColorStop(0, `rgba(${c.col.join(",")},${0.16 * pool})`);
          g.addColorStop(1, `rgba(${c.col.join(",")},0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath();
          ctx!.arc(c.cx, c.cy, c.rad, 0, 6.2832);
          ctx!.fill();
        }
      }
      const line = ease((t - 2700) / 900);
      if (line > 0) {
        ctx!.setLineDash([5, 4]);
        ctx!.lineWidth = 1.6;
        for (const c of camps) {
          if (!c.path) continue;
          ctx!.strokeStyle = `rgba(${c.col.join(",")},${0.9 * line})`;
          ctx!.stroke(c.path);
        }
        ctx!.setLineDash([]);
        ctx!.font = `600 13px ${font}`;
        ctx!.textAlign = "center";
        ctx!.fillStyle = `rgba(${ink2.join(",")},${line})`;
        for (const c of camps) ctx!.fillText(c.name, c.cx, c.top - 20);
      }
      const rad = Math.max(2.6, Math.min(4.2, box.w / 160));
      for (const p of people) {
        const k = ease((t - 600 - p.delay) / 2000);
        const a = Math.min(1, Math.max(0, (t - p.delay * 0.6) / 500));
        const wob = still ? 0 : 1.4 * k;
        const x = p.sx + (p.tx - p.sx) * k + Math.sin(now / 1500 + p.ph) * wob;
        const y = p.sy + (p.ty - p.sy) * k + Math.cos(now / 1800 + p.ph) * wob;
        const c = colourAt(p, now);
        ctx!.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3] * a})`;
        ctx!.beginPath();
        ctx!.arc(x, y, rad, 0, 6.2832);
        ctx!.fill();
      }
      if (!still && visible) raf = requestAnimationFrame(draw);
    }

    layout();
    if (still) draw(performance.now());
    else raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      layout();
      if (still) draw(performance.now());
    });
    ro.observe(stage);
    // Nothing moves while the picture is out of sight.
    const io = new IntersectionObserver((es) => {
      const v = es.some((e) => e.isIntersecting);
      if (still) return;
      if (v && !visible) {
        visible = true;
        raf = requestAnimationFrame(draw);
      } else if (!v && visible) {
        visible = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(stage);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [example, wide]);

  const cur = example && wide && cap != null ? example.statements[cap] : null;
  return (
    <div className="hero-stage" ref={stageRef}>
      {example && wide ? <canvas className="hero-field" ref={canvasRef} aria-hidden /> : null}
      <div className="wrap hero-main">
        <div className="hero-text" ref={textRef}>
          {children}
        </div>
      </div>
      {example && wide ? (
        <p className={cur ? "hero-cap on" : "hero-cap"} ref={capRef} aria-hidden>
          {cur ? (
            <>
              <span className={`bx-kind ${cur.tone}`}>{cur.label}</span>
              <q>{cur.text}</q>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

const MW = 560;
const MH = 330;
const PAD = 14;

interface Dot {
  x: number;
  y: number;
  camp: number;
  v: string;
}

export function BeispielFlow({ example }: { example: Example }) {
  const { camps, statements } = example;
  const [sel, setSel] = useState(0);
  const [shown, setShown] = useState(false);
  const mapRef = useRef<SVGSVGElement>(null);

  // Positions come rounded from the server (0–1000), so server and browser draw the same picture.
  const dots = useMemo<Dot[]>(
    () =>
      example.people.map((p) => ({
        x: round(PAD + (p.x / 1000) * (MW - 2 * PAD)),
        y: round(PAD + (p.y / 1000) * (MH - 2 * PAD)),
        camp: p.camp,
        v: p.v,
      })),
    [example.people],
  );
  const groups = useMemo(() => camps.map((_, g) => dots.filter((d) => d.camp === g)), [camps, dots]);
  const hulls = useMemo(() => groups.map((g) => hullPath(g, 11)), [groups]);
  // Each camp's numbers stand above its own cloud: the heads read in the clouds' order, left to right.
  const order = useMemo(() => {
    const cx = groups.map((g) => (g.length ? g.reduce((s, d) => s + d.x, 0) / g.length : MW / 2));
    return camps.map((_, g) => g).sort((a, b) => cx[a]! - cx[b]!);
  }, [camps, groups]);

  useEffect(() => {
    // The one moment of motion: the grey crowd takes sides when the example comes into view.
    const svg = mapRef.current;
    if (!svg || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        timer = window.setTimeout(() => setShown(true), 600);
      },
      { threshold: 0.35 },
    );
    io.observe(svg);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // The hero's three answers open their statement here.
    const on = (e: Event) => {
      const i = pick(statements, (e as CustomEvent<Want>).detail);
      if (i >= 0) setSel(i);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [statements]);

  const cur = statements[sel]!;
  return (
    <div className="bx-flow">
      <div>
        <h3 className="bx-step">
          <span className="bx-step-n">1</span>Eine Aussage wählen
        </h3>
        <div className="bx-picks" role="group" aria-label="Aussage wählen">
          {statements.map((s, i) => (
            <button key={s.text} type="button" className="bx-pick" aria-pressed={sel === i} onClick={() => setSel(i)}>
              <span className="bx-pick-text">{s.text}</span>
              <span className={`bx-pick-kind ${s.tone}`}>
                <i aria-hidden />
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="bx-step">
          <span className="bx-step-n">2</span>So haben die Lager abgestimmt
        </h3>
        <figure className="bx-space">
          <div className="bx-heads" style={{ gridTemplateColumns: `repeat(${camps.length}, minmax(0, 1fr))` }}>
            {order.map((g) => {
              const v = cur.camps[g] ?? { agree: 0, seen: 0 };
              return (
                <div key={g} className="bx-head">
                  <span className="bx-head-name">
                    <i style={{ borderColor: `var(${CAMP_VARS[g] ?? "--ink-3"})` }} aria-hidden />
                    {camps[g]!.name}
                  </span>
                  <span className="bx-head-big num">
                    {pctOf(v.agree, v.seen)}
                    <small> %</small>
                  </span>
                  <span className="bx-head-abs num">
                    {v.agree} von {v.seen} stimmen zu
                  </span>
                </div>
              );
            })}
          </div>
          <svg
            ref={mapRef}
            viewBox={`0 0 ${MW} ${MH}`}
            role="img"
            aria-label={`Meinungsraum zu „${cur.text}“: ${camps
              .map((c, g) => `im Lager ${c.name} stimmen ${pctOf(cur.camps[g]?.agree ?? 0, cur.camps[g]?.seen ?? 0)} Prozent zu`)
              .join(", ")}.`}
          >
            {hulls.map((d, g) => (d ? <path key={g} d={d} className="bx-hull" style={{ stroke: `var(${CAMP_VARS[g] ?? "--ink-3"})` }} /> : null))}
            {dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={3.4} className={`bx-dot ${shown ? VOTE[(d.v[sel] ?? ".") as keyof typeof VOTE] : "pass"}`} />
            ))}
          </svg>
          <ul className="bx-legend" aria-hidden>
            <li>
              <i className="agree" />
              stimmt zu
            </li>
            <li>
              <i className="disagree" />
              lehnt ab
            </li>
            <li>
              <i className="pass" />
              enthält sich oder nicht abgestimmt
            </li>
          </ul>
          <figcaption className="bx-note">Jeder Punkt ist eine Person. Wer ähnlich abgestimmt hat, steht nah beieinander; so entstehen die Lager.</figcaption>
        </figure>
      </div>

      <div aria-live="polite">
        <h3 className="bx-step">
          <span className="bx-step-n">3</span>Was das für den Rat heißt
        </h3>
        <p>
          <span className={`bx-kind ${cur.tone}`}>{cur.label}</span>
        </p>
        <p className="bx-reading">{cur.reading}</p>
        <p className="bx-more">
          <Link href={`${example.href}/ergebnis`}>Das ganze Ergebnis ansehen</Link>
        </p>
      </div>
    </div>
  );
}
