"use client";

import type { Entry, Ergebnis, Person, Quote, StatementOut } from "@policy/pipeline/kern";
import {
  campLabel,
  campName,
  checkLines,
  countLine,
  evidenceText,
  firmBridge,
  gapTexts,
  GROUP_ORDER,
  groupOf,
  groupWords,
  type Group,
  headline,
  pct,
  pillOf,
  readingOf,
  smallHeadline,
  smallNote,
  statusWords,
  stepCountText,
  stepText,
  TALLY_ORDER,
  TALLY_WORDS,
  tallyOf,
  tenorText,
  type Tally,
  TYP_WORDS,
  VERDICT_WORDS,
  word,
  type CampNames,
} from "@policy/pipeline/kern/text";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { ReportBox } from "@/components/ReportBox";
import { decisionDate, decisionHead, outcomeOf, outcomeSentence, type PublicDecision } from "@/lib/beschluss-words";
import { STEPS } from "@/lib/params";

/**
 * The results page after Stephan's design (Online-Anhang, Musterstadt),
 * rendered from the stored result object (W9) — or, in the workspace, from
 * the live evaluation. No language model runs here: every word comes from
 * the templates in befund-text.ts, every number from the result.
 */

export interface ResultViewProps {
  r: Ergebnis;
  names: CampNames;
  title: string;
  /** "Musterstadt" */
  town: string;
  measure: string;
  eyebrow: string;
  /** "zwischen dem 12. Mai und dem 26. Juni 2026" */
  period: string | null;
  questions: { key: string; label: string }[];
  /** "Wie diese Seite entstanden ist", built on the server (editorial mode, simulated votes, fictional). */
  method: string[];
  notice?: string | null;
  report?: { href: string; label: string } | null;
  files?: { href: string; label: string }[];
  /** On the public page: citizens can report a statement or a quote ("Hier stimmt etwas nicht"). */
  reportable?: { gemeinde: string; verfahren: string } | null;
  /** The council's decision, once the town published it (the way back). */
  decision?: PublicDecision | null;
}

const W = 640;
const H = 300;
const TOP = 20;
const PAD = 14;
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Up to this width the right column is a sheet from below (ergebnis.css, "Phones"). */
const SHEET_MAX = 900;
const n = (x: number) => x.toLocaleString("de-DE");

type Pt = { x: number; y: number };
function hull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((p, q) => p.x - q.x || p.y - q.y);
  const cr = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [];
  const up: Pt[] = [];
  for (const p of s) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of [...s].reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop();
    up.push(p);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
function hullPath(pts: Pt[], pad: number): string | null {
  const h = hull(pts);
  if (h.length < 3) return null;
  const cx = h.reduce((s, p) => s + p.x, 0) / h.length;
  const cy = h.reduce((s, p) => s + p.y, 0) / h.length;
  const e = h.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: r1(p.x + (dx / l) * pad), y: r1(p.y + (dy / l) * pad) };
  });
  let d = "";
  for (let i = 0; i < e.length; i++) {
    const p0 = e[i]!;
    const p1 = e[(i + 1) % e.length]!;
    const p2 = e[(i + 2) % e.length]!;
    if (!i) d += `M${r1((p0.x + p1.x) / 2)},${r1((p0.y + p1.y) / 2)}`;
    d += `Q${p1.x},${p1.y} ${r1((p1.x + p2.x) / 2)},${r1((p1.y + p2.y) / 2)}`;
  }
  return `${d}Z`;
}

const VOTE: Record<string, string> = { a: "stimmt zu", d: "lehnt ab", p: "enthält sich", ".": "hat nicht abgestimmt" };

export function ResultView(props: ResultViewProps) {
  const { names } = props;
  const dec = props.decision ?? null;
  // Step names as they read today (a stored result keeps the words of its day; the meaning of each key is unchanged).
  const r = useMemo(() => ({ ...props.r, steps: props.r.steps.map((s) => ({ ...s, label: STEPS.find((x) => x.key === s.key)?.label ?? s.label })) }), [props.r]);
  const k = r.camps?.k ?? 0;
  /** Too few people for camps: counts over everyone and the arguments, no verdicts (see smallNote). */
  const small = !r.ready;
  const N = r.statements.length;
  const byNr = useMemo(() => new Map(r.statements.map((s) => [s.nr, s])), [r]);
  const t = r.params.bridgeThreshold;
  // The lists by finding (or, without camps, by tally): within a group the most telling first. The core of the
  // dispute leads; then the largest gap between the camps; where both camps agree, the broadest agreement.
  const lists = useMemo(() => {
    const lowest = (s: StatementOut) => Math.min(100, ...s.camps.filter((c) => c.seen).map((c) => pct(c.agree, c.seen)));
    const share = (a: number, s: StatementOut) => (s.total.seen ? a / s.total.seen : 0);
    const befund = new Map<Group, StatementOut[]>();
    for (const s of r.statements) befund.set(groupOf(s, t), [...(befund.get(groupOf(s, t)) ?? []), s]);
    for (const [g, xs] of befund)
      xs.sort((a, b) =>
        a.nr === r.core[0] ? -1 : b.nr === r.core[0] ? 1 : (g === "bruecke" ? lowest(b) - lowest(a) : b.gap - a.gap) || a.nr - b.nr,
      );
    const tally = new Map<Tally, StatementOut[]>();
    for (const s of r.statements) tally.set(tallyOf(s), [...(tally.get(tallyOf(s)) ?? []), s]);
    for (const [g, xs] of tally)
      xs.sort(
        (a, b) =>
          (g === "zu"
            ? share(b.total.agree, b) - share(a.total.agree, a)
            : g === "ab"
              ? share(b.total.disagree, b) - share(a.total.disagree, a)
              : b.total.seen - a.total.seen) || a.nr - b.nr,
      );
    return { befund, tally };
  }, [r, t]);
  const firstIn = <G,>(order: G[], m: Map<G, StatementOut[]>) => order.map((g) => m.get(g)?.[0]?.nr).find((x) => x !== undefined);
  const initial = (small ? firstIn(TALLY_ORDER, lists.tally) : (r.core[0] ?? firstIn(GROUP_ORDER, lists.befund))) ?? r.statements[0]?.nr ?? 1;
  const [sel, setSel] = useState(initial);
  const [view, setView] = useState<"befund" | "argument">("befund");
  // Which groups are open: at first only the one holding the selected statement; selecting another opens its group.
  const groupKeys = (nr: number) => {
    const s = byNr.get(nr);
    return s ? [`b:${groupOf(s, t)}`, `t:${tallyOf(s)}`] : [];
  };
  const [open, setOpen] = useState<Set<string>>(() => new Set(groupKeys(initial)));
  const reveal = (nr: number) =>
    setOpen((o) => (groupKeys(nr).every((x) => o.has(x)) ? o : new Set([...o, ...groupKeys(nr)])));
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [mapMode, setMapMode] = useState<"vote" | "camp">("vote");
  const [sheet, setSheet] = useState(false);
  const [source, setSource] = useState<{ s: StatementOut; q: Quote } | null>(null);
  /** The person behind a dot in the opinion space (its display number), shown in the same dialog as a quote's source. */
  const [who, setWho] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cur = byNr.get(sel) ?? r.statements[0]!;

  useEffect(() => {
    const m = window.location.hash.match(/^#a(\d+)$/);
    if (m && byNr.has(Number(m[1]))) {
      setSel(Number(m[1]));
      reveal(Number(m[1]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byNr]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // From a quote opened in the person view, Escape goes back to the person first.
      if (source) setSource(null);
      else if (who !== null) setWho(null);
      else setSheet(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [source, who]);
  // The page behind stays still while the source dialog or the phone sheet is open.
  const dialog = source !== null || who !== null;
  useEffect(() => {
    if (!dialog && !(sheet && window.innerWidth <= SHEET_MAX)) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [dialog, sheet]);
  useEffect(() => {
    if (dialog) closeRef.current?.focus({ preventScroll: true });
  }, [source, who, dialog]);
  const closeDialog = () => {
    setSource(null);
    setWho(null);
  };
  // The opened sheet takes the focus (for screen readers), without a ring on the close button.
  useEffect(() => {
    if (sheet) stageRef.current?.focus({ preventScroll: true });
  }, [sheet]);

  const select = (nr: number, openSheet = true) => {
    setSel(nr);
    reveal(nr);
    window.history.replaceState(null, "", `#a${nr}`);
    // The right column scrolls on its own: a new statement starts at its top, with the opinion space in view.
    if (stageRef.current) stageRef.current.scrollTop = 0;
    if (openSheet && window.innerWidth <= SHEET_MAX) setSheet(true);
  };

  // ———— The opinion space ————
  const geo = useMemo(() => {
    const dots = r.people.filter((p) => p.camp >= 0).map((p) => ({
      ...p,
      cx: r1(PAD + (p.x / 1000) * (W - 2 * PAD) + (((p.n * 37) % 7) - 3) * 0.7),
      cy: r1(TOP + (p.y / 1000) * (H - TOP - PAD) + (((p.n * 53) % 7) - 3) * 0.7),
    }));
    const camps = Array.from({ length: k }, (_, g) => {
      const pts = dots.filter((d) => d.camp === g).map((d) => ({ x: d.cx, y: d.cy }));
      const cx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : W / 2;
      return { g, path: hullPath(pts, 10), cx: r1(cx) };
    });
    return { dots, camps };
  }, [r.people, k]);
  const total = geo.dots.length;
  // Organisations are named (their statements are public); everyone else is a number.
  const orgOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of r.statements) for (const q of s.quotes) if (q.person && q.source?.kind === "organisation" && !m.has(q.person)) m.set(q.person, q.sender);
    return m;
  }, [r]);
  const whoLabel = (nr: number) => orgOf.get(nr) ?? `Person ${nr}`;
  /** The dot nearest to the pointer, within `px` screen pixels — the dots are too small to hit exactly, above all on phones. */
  const nearest = (e: ReactMouseEvent<SVGSVGElement>, px: number) => {
    const svg = e.currentTarget;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const lim = px / (svg.getBoundingClientRect().width / W || 1);
    let best: (typeof geo.dots)[number] | null = null;
    let bd = lim * lim;
    for (const d of geo.dots) {
      const dd = (d.cx - at.x) ** 2 + (d.cy - at.y) ** 2;
      if (dd <= bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  };
  // The camps left to right as their clouds lie. Names, counts and the detail's columns all follow this order,
  // so the numbers under a cloud are that cloud's.
  const order = [...geo.camps].sort((a, b) => a.cx - b.cx).map((c) => c.g);
  const cols = { gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` };
  const byCloud = (s: StatementOut) => order.flatMap((g) => (s.camps[g] ? [{ g, c: s.camps[g]! }] : []));
  const vi = cur.nr - 1;

  const campItems = (s: StatementOut) => byCloud(s).map(({ g, c }) => ({ g, v: pct(c.agree, c.seen), seen: c.seen }));

  // ———— One statement in the list ————
  const item = (s: StatementOut, head?: ReactNode, foot?: ReactNode, key?: string) => {
    const cs = campItems(s).filter((c) => c.seen);
    const lo = cs.length ? Math.min(...cs.map((c) => c.v)) : 0;
    const hi = cs.length ? Math.max(...cs.map((c) => c.v)) : 0;
    return (
      <button key={key ?? s.nr} type="button" className="item" aria-current={s.nr === sel ? "true" : "false"} onClick={() => select(s.nr)}>
        {head}
        {!small && s.nr === r.core[0] ? <div className="kern">Kern des Streits</div> : null}
        <div className="t">{s.text}</div>
        {!small && s.category === "bruecke" && !firmBridge(s) ? <div className="vb">Brücke unter Vorbehalt</div> : null}
        {dec?.points[s.id] ? <div className={`bt o-${dec.points[s.id]!.outcome}`}>Beschluss: {outcomeOf(dec.points[s.id]!.outcome)?.lower}</div> : null}
        {foot}
        {small && s.total.seen ? (
          <>
            <div className="tally" aria-hidden>
              <i className="a" style={{ width: `${pct(s.total.agree, s.total.seen)}%` }} />
              <i className="p" style={{ width: `${pct(s.total.pass, s.total.seen)}%` }} />
              <i className="d" style={{ width: `${pct(s.total.disagree, s.total.seen)}%` }} />
            </div>
            <div className="vals num">
              <span>
                {s.total.agree} von {s.total.seen} {s.total.agree === 1 ? "stimmt" : "stimmen"} zu
              </span>
            </div>
          </>
        ) : null}
        {k >= 2 ? (
          <>
            <div className="bar" aria-hidden>
              <div className="track" />
              <div className="thr" style={{ left: `${r.params.bridgeThreshold * 100}%` }} />
              <div className="span" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
              {cs.map((c) => (
                <div key={c.g} className={`pt c${c.g}`} style={{ left: `${c.v}%` }} />
              ))}
            </div>
            <div className="vals num">
              {cs.map((c) => (
                <span key={c.g}>
                  {campName(names, c.g)} {c.v} %
                </span>
              ))}
            </div>
          </>
        ) : null}
      </button>
    );
  };

  const qLabel = (key: string | null) => (key ? (props.questions.find((q) => q.key === key)?.label ?? null) : null);
  const stChip = (e: Entry) => {
    if (small) return null;
    const w = statusWords(e.status, k);
    return <span className={`st ${w.tone}`}>{w.text}</span>;
  };
  const reads = (e: Entry) => (e.camp !== null ? <span className={`lgr c${e.camp}`}>so liest es das {campLabel(names, e.camp)}</span> : null);

  // ———— Lists ————
  // "Nach Befund": the five findings, with the fact questions where proof stands on one side only apart.
  // Each group folds; its header names it and counts its statements.
  const fold = (key: string, attr: { "data-cat"?: Group; "data-tally"?: Tally }, label: string, xs: StatementOut[]) => {
    const isOpen = open.has(key);
    const id = `gruppe-${key.slice(2)}`;
    return (
      <section key={key} className="group fold" id={id} {...attr}>
        <h3>
          <button type="button" className="grp" aria-expanded={isOpen} aria-controls={`${id}-liste`} onClick={() => toggle(key)}>
            <span className="dot" />
            <span className="gl">{label}</span>
            <span className="gn num">{xs.length}</span>
            <i className="chev" aria-hidden />
          </button>
        </h3>
        {isOpen ? (
          <div className="items" id={`${id}-liste`}>
            {xs.map((s) => item(s))}
          </div>
        ) : null}
      </section>
    );
  };
  const tallyList = (
    <>{TALLY_ORDER.filter((g) => lists.tally.get(g)?.length).map((g) => fold(`t:${g}`, { "data-tally": g }, TALLY_WORDS[g], lists.tally.get(g)!))}</>
  );
  const befundList = (
    <>{GROUP_ORDER.filter((g) => lists.befund.get(g)?.length).map((g) => fold(`b:${g}`, { "data-cat": g }, groupWords(g, k).label, lists.befund.get(g)!))}</>
  );

  const root = r.statements.find((s) => s.rolle === "schluss");
  const argumentList = (
    <>
      <p className="kt-intro">Die {r.steps.length === 4 ? "vier" : r.steps.length} Stufen im Einzelnen. Unter jeder steht, was die Teilnehmenden dazu gesagt haben.</p>
      {/* The four steps hang on one line like links of a chain. */}
      <div className="kt-chain">
      {r.steps.map((st, i) => {
        const sup = r.statements.flatMap((s) => s.entries.filter((e) => e.step === st.key && e.role === "stuetzt").map((e) => ({ s, e })));
        const att = r.statements.flatMap((s) => s.entries.filter((e) => e.step === st.key && e.role === "greift_an").map((e) => ({ s, e })));
        const v = VERDICT_WORDS[st.verdict];
        return (
          <section key={st.key} id={`stufe-${st.key}`} tabIndex={-1} className={`group step kt-step ${small ? "grey" : v.tone}`}>
            <span className="kt-node" aria-hidden>
              {i + 1}
            </span>
            <h3>
              <span className="visually-hidden">Stufe {i + 1}: </span>
              {st.label}
            </h3>
            {/* One card: the town's claim, and joined beneath it what became of it. The two lists below are the evidence. */}
            <div className="kt-card">
              {st.these ? (
                <div className="kt-claim">
                  <div className="who">Die Stadt sagt</div>
                  <p>{st.these}</p>
                </div>
              ) : null}
              <div className="kt-verdict">
                {small ? (
                  <p>{stepCountText(st)}</p>
                ) : (
                  <p>
                    {/* "Hält." leads; the sentence's own "Die Stufe hält." would only repeat it. */}
                    <b>{v.text.charAt(0).toUpperCase() + v.text.slice(1)}.</b> {stepText(st, r).replace(/^Die Stufe \S+\.\s*/, "")}
                  </p>
                )}
              </div>
            </div>
            <div className="kt-lists">
            <details className="rolle">
              <summary className="role sup">
                <span className="rl">Stützt die These</span>
                <span className="rn num">
                  {sup.length}
                  <i className="chev" aria-hidden />
                </span>
              </summary>
              <div className="items sup">
              {sup.length ? (
                sup.map(({ s, e }, j) =>
                  item(
                    s,
                    s.rolle === "praemisse" ? <div className="own">Behauptung der Stadt</div> : undefined,
                    <div className="in">
                      {stChip(e)}
                      {reads(e)}
                    </div>,
                    `s${s.nr}-${j}`,
                  ),
                )
              ) : (
                <div className="none">Keine Aussage aus der Beteiligung stützt diese Stufe ausdrücklich.</div>
              )}
              </div>
            </details>
            <details className="rolle">
              <summary className="role att">
                <span className="rl">Greift die These an</span>
                <span className="rn num">
                  {att.length}
                  {st.unasked.length ? ` + ${st.unasked.length} ungestellt` : ""}
                  <i className="chev" aria-hidden />
                </span>
              </summary>
              <div className="items att">
              {att.map(({ s, e }, j) => {
                const q = qLabel(e.question);
                const head = e.attack ? (
                  <>
                    <div className="ang">„{e.attack}“</div>
                    <div className="ex2">{q ? `Einwand: ${q} · ` : ""}Stand nach der Beteiligung:</div>
                  </>
                ) : q ? (
                  <div className="ex2">Einwand: {q}</div>
                ) : undefined;
                return item(
                  s,
                  head,
                  <div className="in">
                    {stChip(e)}
                    {reads(e)}
                  </div>,
                  `a${s.nr}-${j}`,
                );
              })}
              {st.unasked.map((q) => (
                <div key={q} className="luecke">
                  <div className="who">Einwand, den niemand erhoben hat</div>
                  <div className="ang">{qLabel(q)}</div>
                  <div className="ex2">
                    {r.statements.some((s) => s.rolle === "beitrag" && s.schritt === st.key && s.frage === q)
                      ? "Dazu liegt nur Stützendes vor, kein einziger Einwand. Vor einem Beschluss zu prüfen."
                      : "Weder Angriff noch Antwort liegen vor. Vor einem Beschluss zu schließen."}
                  </div>
                </div>
              ))}
              {!att.length && !st.unasked.length ? <div className="none">Niemand hat diese Stufe angegriffen.</div> : null}
              </div>
            </details>
            </div>
          </section>
        );
      })}
      </div>
    </>
  );

  // The overview's rows lead to their step in the chain below.
  const goStep = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  const scheme = small ? (
    <div className="scheme">
      <p>
        Wer eine Maßnahme begründet, macht vier Schritte. Jede Aussage aus der Beteiligung stützt einen davon oder greift ihn an. Ob ein Angriff
        steht, entscheidet die Auswertung erst mit Lagern; hier steht, was vorgebracht wurde.
      </p>
      {r.steps.map((st, i) => (
        <button key={st.key} type="button" className="row" onClick={() => goStep(`stufe-${st.key}`)}>
          <span className="k">{i + 1}</span>
          <span className="lbl">
            <span className="t">{st.label}</span>
            <span className="sub num">
              {st.supports} stützend · {st.attacks} {st.attacks === 1 ? "Angriff" : "Angriffe"}
              {st.unasked.length ? ` · ${st.unasked.length} ${st.unasked.length === 1 ? "Frage" : "Fragen"} ungestellt` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  ) : (
    <div className="scheme">
      <p>
        Wer eine Maßnahme begründet, macht vier Schritte. Jede Aussage aus der Beteiligung stützt einen davon oder greift ihn an. Ein Angriff ist
        abgewehrt, klärbar, offen oder er steht. Daraus folgt das Urteil über jede Stufe, und aus den vier Urteilen das Ergebnis oben.
      </p>
      {r.steps.map((st, i) => {
        const c = st.counts;
        const stand = (c.haelt ?? 0) + (c.verdeckt ?? 0);
        const v = VERDICT_WORDS[st.verdict];
        return (
          <button key={st.key} type="button" className="row" onClick={() => goStep(`stufe-${st.key}`)}>
            <span className="k">{i + 1}</span>
            <span className="lbl">
              <span className="t">{st.label}</span>
              <span className="sub num">
                {st.attacks} {st.attacks === 1 ? "Angriff" : "Angriffe"} · {c.abgewehrt ?? 0} abgewehrt · {stand} {stand === 1 ? "steht" : "stehen"}
                {st.unasked.length ? ` · ${st.unasked.length} ${st.unasked.length === 1 ? "Frage" : "Fragen"} ungestellt` : ""}
              </span>
            </span>
            <span className={`st ${v.tone}`}>{v.text}</span>
          </button>
        );
      })}
    </div>
  );

  // ———— Detail ————
  const pillCls = cur.profile === "abgelehnt" ? "bruecke" : groupOf(cur, t);
  const where =
    cur.rolle === "schluss" ? (
      <div className="where">
        <div>Die Maßnahme selbst. Über sie stimmen alle ab, sie ist der Schluss der vier Schritte.</div>
      </div>
    ) : cur.entries.length ? (
      <div className="where">
        {cur.entries.map((e, i) => {
          const si = r.steps.findIndex((s) => s.key === e.step);
          return (
            <div key={i}>
              {e.camp !== null ? <span className={`lg c${e.camp}`}>{campName(names, e.camp)}</span> : null}
              <span>
                {e.role === "stuetzt" ? "Stützt" : "Greift an"}: Stufe <span className="k">{si + 1}</span> <b>{r.steps[si]?.label}</b>
              </span>
              {qLabel(e.question) ? <span>· {qLabel(e.question)}</span> : null}
              {stChip(e)}
            </div>
          );
        })}
      </div>
    ) : null;
  const ev = cur.typ === "T" ? evidenceText(cur) : null;
  const checks = small ? [] : checkLines(cur, r, names);
  const reading = readingOf(cur, r, names);
  const idx = r.statements.indexOf(cur);
  const prev = r.statements[(idx + N - 1) % N]!;
  const next = r.statements[(idx + 1) % N]!;

  const sourceLabel = (q: Quote) =>
    q.source?.kind === "kurzaussage" ? (q.camp !== null ? `Aus dem ${campLabel(names, q.camp)}` : "Eigener Punkt aus der Beteiligung") : q.sender;
  const detail = (
    <article className="detail">
      <div className="kind">
        {small ? (
          <span className={`pill tally-${tallyOf(cur)}`}>{TALLY_WORDS[tallyOf(cur)]}</span>
        ) : (
          <span className={`pill ${pillCls}`}>{pillOf(cur, k, t)}</span>
        )}
        <span className="typ">{TYP_WORDS[cur.typ]}</span>
      </div>
      <h2>{cur.text}</h2>
      {where}
      {small ? (
        <div className="scores">
          <div className="score all">
            <div className="who">Alle Teilnehmenden</div>
            <div className="big num">
              {pct(cur.total.agree, cur.total.seen)}
              <small>%</small>
            </div>
            <div className="abs num">{countLine(cur)}</div>
            <div className="mini" aria-hidden>
              <i className="a" style={{ width: `${pct(cur.total.agree, cur.total.seen)}%` }} />
              <i className="p" style={{ width: `${pct(cur.total.pass, cur.total.seen)}%` }} />
              <i className="d" style={{ width: `${pct(cur.total.disagree, cur.total.seen)}%` }} />
            </div>
          </div>
        </div>
      ) : null}
      {k >= 2 ? (
        <div className="scores">
          {byCloud(cur).map(({ g, c }) => (
            <div key={g} className={`score c${g}`}>
              <div className="who">{campName(names, g)}</div>
              <div className="big num">
                {pct(c.agree, c.seen)}
                <small>%</small>
              </div>
              <div className="abs num">
                {n(c.agree)} von {n(c.seen)} {c.seen === 1 ? "Person stimmt" : "Personen stimmen"} zu
              </div>
              <div className="mini" aria-hidden>
                <i className="a" style={{ width: `${pct(c.agree, c.seen)}%` }} />
                <i className="p" style={{ width: `${pct(c.pass, c.seen)}%` }} />
                <i className="d" style={{ width: `${pct(c.disagree, c.seen)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {small ? (
        <div className="reading">
          <b>{cur.rolle === "schluss" ? "Die Maßnahme selbst." : countLine(cur)}</b> Bei so wenigen Stimmen ist das eine Zählung, kein Befund.
        </div>
      ) : (
        <div className="reading">
          <b>{reading[0]}</b> {reading.slice(1).join(" ")}
        </div>
      )}
      {ev ? (
        <p className="evidence">
          <span>Belege</span>
          {ev}
        </p>
      ) : null}
      {checks.length ? (
        <div className="checks">
          <span className="eyebrow">Trägt die Brücke? Drei Prüfungen</span>
          <ul>
            {checks.map((c) => (
              <li key={c.title} className={c.ok === true ? "ok" : c.ok === false ? "bad" : "grey"}>
                <span className="mk" aria-hidden>
                  {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
                </span>
                <span>
                  <b>{c.title}.</b> {c.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dec?.points[cur.id] ? (
        <div className={`council o-${dec.points[cur.id]!.outcome}`}>
          <span className="eyebrow">Was der {dec.gremium} daraus gemacht hat</span>
          <p>{outcomeSentence(dec.points[cur.id]!)}</p>
        </div>
      ) : dec && cur.rolle === "schluss" && dec.summary ? (
        <div className="council">
          <span className="eyebrow">{decisionHead(dec)}</span>
          <p>{dec.summary}</p>
        </div>
      ) : null}
      {cur.quotes.length ? (
        <div className="quotes">
          <span className="eyebrow">Originalzitate · Klick öffnet die Quelle</span>
          {cur.quotes.map((q) => (
            <blockquote
              key={q.move}
              className={`q${q.camp !== null ? ` c${q.camp}` : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => setSource({ s: cur, q })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSource({ s: cur, q });
                }
              }}
            >
              <p>„{q.text}“</p>
              <div className="src">
                <b>{sourceLabel(q)}</b> · {q.stance === 1 ? "stimmt zu" : "widerspricht"} <span className="go">Im Original lesen →</span>
              </div>
            </blockquote>
          ))}
        </div>
      ) : (
        <div className="noq">Zu dieser Aussage liegen nur Abstimmungen vor, keine Textbeiträge.</div>
      )}
      <div className="ref">
        <span className="num">
          Aussage {cur.nr} von {N}
          {small ? "" : ` · Brückenschwelle ${Math.round(r.params.bridgeThreshold * 100)} % in ${k === 2 ? "beiden" : "allen"} Lagern`}
        </span>
        {props.reportable && cur.rolle !== "schluss" ? (
          <ReportBox key={`n${cur.id}`} gemeinde={props.reportable.gemeinde} verfahren={props.reportable.verfahren} kind="node" id={cur.id} label="Aussage melden" />
        ) : null}
        <span className="nav">
          <button type="button" onClick={() => select(prev.nr)}>
            ← Vorige
          </button>
          <button type="button" onClick={() => select(next.nr)}>
            Nächste →
          </button>
        </span>
      </div>
    </article>
  );

  // ———— Head ————
  const h = small ? smallHeadline(r) : headline(r);
  const p = r.participation;
  const statements = p.files + p.uploads;
  const sub = [
    `${n(p.voters)} ${p.voters === 1 ? "Mensch hat" : "Menschen und Organisationen haben"}${props.period ? ` ${props.period}` : ""} abgestimmt${p.shortPoints ? ", eigene Punkte geschickt" : ""}${statements ? " und Stellung genommen" : ""}.`,
    "Jeder Satz dieser Seite führt per Klick zurück zur Aussage, zum Zitat und zum Originaldokument.",
  ].join(" ");
  const showBridges = () => {
    setView("befund");
    const key = small ? "t:zu" : "b:bruecke";
    setOpen((o) => new Set([...o, key]));
    // After the group has opened: scroll to its header.
    requestAnimationFrame(() =>
      (document.getElementById(`gruppe-${key.slice(2)}`) ?? listRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  // The tenor's links: a statement opens on the right; "im Einzelnen" opens a reading of the list below.
  const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pick = (nr: number) => {
    select(nr);
    // On phones the statement opens in the sheet; the page stays where it is.
    if (window.innerWidth > SHEET_MAX) stageRef.current?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
  };
  const goList = (v: "befund" | "argument") => {
    setView(v);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" }));
  };
  const w2 = (x: number, of: number) => (of ? Math.round((x / of) * 10000) / 100 : 0);
  const down = (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />
    </svg>
  );
  const decided = dec ? decisionDate(dec.datum) : null;

  const gaps = gapTexts(r, props.questions);
  const sat = r.saturation;
  const person = source?.q.person ? r.people.find((x) => x.n === source.q.person && x.camp >= 0) : undefined;
  const personShown = who !== null ? r.people.find((x) => x.n === who && x.camp >= 0) : undefined;

  return (
    <div className="erg">
      <header className="erg-top">
        <div className="eyebrow">
          {/* Breaks only between its parts, never inside one. */}
          {props.eyebrow.split(" · ").map((part, i) => (
            <span key={i}>
              {i ? " · " : null}
              <span className="nw">{part}</span>
            </span>
          ))}
        </div>
        <h1>
          {props.title}: Worüber {props.town} wirklich streitet
        </h1>
        <p className="sub">{sub}</p>
        {/* The tenor (Urteilsstil): what was put to the vote and how each camp voted on it, the two findings — each
            opening its reading below — and the council's decision. The two readings are the reasons for the findings. */}
        <div className={`erg-tenor${root ? "" : " solo"}`}>
          <div className="et-grid">
            {root ? (
              <div className="et-side">
                <div className="et-lbl">Zur Diskussion stand</div>
                <button type="button" className="et-measure" onClick={() => pick(root.nr)}>
                  {root.text}
                </button>
                <div className="et-votes">
                  {k >= 2
                    ? byCloud(root).map(({ g, c }) => (
                        <div key={g} className={`et-vote c${g}`}>
                          <div className="et-vh">
                            <i className="et-dot" aria-hidden />
                            <span className="et-nm">{campLabel(names, g)}</span>
                            <span className="et-ct num">{n(r.camps?.sizes[g] ?? 0)} Personen</span>
                          </div>
                          <div className="et-bar" aria-hidden>
                            <i className="a" style={{ width: `${w2(c.agree, c.seen)}%` }} />
                            <i className="p" style={{ width: `${w2(c.pass, c.seen)}%` }} />
                            <i className="d" style={{ width: `${w2(c.disagree, c.seen)}%` }} />
                          </div>
                          <div className="et-vv num">
                            <b>{pct(c.agree, c.seen)} %</b> stimmen zu, {pct(c.disagree, c.seen)} % lehnen ab
                          </div>
                        </div>
                      ))
                    : null}
                  {root.total.seen ? (
                    <div className={`et-all num${k >= 2 ? "" : " only"}`}>
                      {k >= 2 ? "Alle zusammen: " : ""}
                      {n(root.total.agree)} von {n(root.total.seen)} stimmen zu ({pct(root.total.agree, root.total.seen)} %), {n(root.total.disagree)}{" "}
                      {root.total.disagree === 1 ? "lehnt" : "lehnen"} ab.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="et-side">
              <div className="et-finding">
                <div className="et-lbl">{small ? "Wie abgestimmt wurde" : "Wo die Lager stehen"}</div>
                <p>
                  {/* Links, not buttons: a button never wraps inside a sentence. */}
                  <b>
                    <a
                      className="lnk"
                      href={`#gruppe-${small ? "zu" : "bruecke"}`}
                      onClick={(e) => {
                        e.preventDefault();
                        showBridges();
                      }}
                    >
                      {h.lead}
                    </a>
                  </b>{" "}
                  {h.rest.map((seg, i) =>
                    "nr" in seg ? (
                      <a
                        key={i}
                        className="lnk"
                        href={`#a${seg.nr}`}
                        onClick={(e) => {
                          e.preventDefault();
                          pick(seg.nr);
                        }}
                      >
                        {seg.text}
                      </a>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </p>
                <button type="button" className="et-more" onClick={() => goList("befund")}>
                  Die {N} Aussagen {small ? "nach Zustimmung" : "nach Befund"} {down}
                </button>
              </div>
              <div className="et-finding">
                <div className="et-lbl">Die Begründung der Stadt</div>
                {small ? (
                  <p>Ob sie trägt, zeigt die Auswertung erst, wenn sich Lager bilden. Zu jedem der vier Schritte steht unten, was vorgebracht wurde.</p>
                ) : (
                  <p>{tenorText(r).map((x, i) => (i === 0 ? <b key={i}>{x}</b> : ` ${x}`))}</p>
                )}
                <button type="button" className="et-more" onClick={() => goList("argument")}>
                  Die vier Schritte im Einzelnen {down}
                </button>
              </div>
            </div>
          </div>
          {dec ? (
            <div className="et-beschluss">
              <div className="et-lbl">{decided ? `Beschluss vom ${decided}` : "Beschluss"}</div>
              <p>
                {dec.summary?.trim() || decisionHead(dec)} <span>Bei jeder Aussage steht, was aus ihr geworden ist.</span>
              </p>
            </div>
          ) : null}
        </div>
        {small ? <p className="erg-notice">{smallNote(r)}</p> : null}
        {props.notice ? <p className="erg-notice">{props.notice}</p> : null}
      </header>

      <div className="erg-app">
        <aside className="erg-list" aria-label="Aussagen" ref={listRef}>
          <div className="seg" role="group" aria-label="Lesart">
            <button type="button" aria-pressed={view === "befund"} onClick={() => setView("befund")}>
              {small ? "Nach Zustimmung" : "Nach Befund"}
            </button>
            <button type="button" aria-pressed={view === "argument"} onClick={() => setView("argument")}>
              Nach Argument
            </button>
          </div>
          {view === "argument" ? scheme : null}
          <div>{view === "befund" ? (small ? tallyList : befundList) : argumentList}</div>
        </aside>

        <section className={`erg-stage${sheet ? " open" : ""}`} ref={stageRef} tabIndex={-1} aria-live="polite">
          <button type="button" className="closeb" onClick={() => setSheet(false)}>
            Schließen
            <svg viewBox="0 0 12 12" aria-hidden>
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
          {small ? (
            <div className="map map-small">
              <div className="head">
                <span className="eyebrow">Alle zusammen · {n(p.voters)} Teilnehmende</span>
              </div>
              <div className="tally big" aria-hidden>
                <i className="a" style={{ width: `${pct(cur.total.agree, cur.total.seen)}%` }} />
                <i className="p" style={{ width: `${pct(cur.total.pass, cur.total.seen)}%` }} />
                <i className="d" style={{ width: `${pct(cur.total.disagree, cur.total.seen)}%` }} />
              </div>
              <div className="counts">
                <div>
                  <b className="num">{n(cur.total.agree)}</b> stimmen zu
                </div>
                <div>
                  <b className="num">{n(cur.total.disagree)}</b> lehnen ab
                </div>
                <div>
                  <b className="num">{n(cur.total.pass)}</b> enthalten sich
                </div>
              </div>
              <p className="small-why">Für einen Meinungsraum mit Lagern braucht es mindestens {n(r.needed)} Menschen, die genug Aussagen bewertet haben.</p>
            </div>
          ) : (
          <div className="map">
            <div className="head">
              <span className="eyebrow">Der Meinungsraum · {n(total)} Teilnehmende</span>
              <div className="legend">
                {mapMode === "vote" ? (
                  <>
                    <span>
                      <i style={{ background: "var(--agree)" }} />
                      stimmt zu
                    </span>
                    <span>
                      <i style={{ background: "var(--disagree)" }} />
                      lehnt ab
                    </span>
                    <span>
                      <i style={{ background: "var(--pass)" }} />
                      enthält sich
                    </span>
                    <span>
                      <i className="nv" />
                      nicht abgestimmt
                    </span>
                  </>
                ) : (
                  geo.camps.map((c) => (
                    <span key={c.g} className={`c${c.g}`}>
                      <i style={{ background: "var(--c)" }} />
                      {campName(names, c.g)}
                    </span>
                  ))
                )}
                <button type="button" className="modebtn" aria-pressed={mapMode === "camp"} onClick={() => setMapMode(mapMode === "vote" ? "camp" : "vote")}>
                  {mapMode === "camp" ? "Stimmen zeigen" : "Lager zeigen"}
                </button>
              </div>
            </div>
            {/* Camp names as text above the clouds, left to right as they lie: readable at any width. */}
            <div className="camp-row" style={cols}>
              {order.map((g) => (
                <div key={g} className={`c${g}`}>
                  <b>
                    <i aria-hidden />
                    {campLabel(names, g)}
                  </b>
                  <span className="num">
                    {n(r.camps?.sizes[g] ?? 0)} Personen · {pct(r.camps?.sizes[g] ?? 0, total)} %
                  </span>
                </div>
              ))}
            </div>
            <svg
              viewBox={`0 ${TOP - 10} ${W} ${H - TOP + 10}`}
              role="img"
              aria-label={`${total} Punkte, je einer pro teilnehmender Person, in ${k} Lagern; eingefärbt nach ihrer Stimme zur gewählten Aussage`}
              onMouseMove={(e) => {
                const d = nearest(e, 8);
                e.currentTarget.style.cursor = d ? "pointer" : "";
                if (!d) return setTip(null);
                const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: `${whoLabel(d.n)} · ${campName(names, d.camp)} · ${VOTE[d.v[vi] ?? "."]}` });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={(e) => {
                const d = nearest(e, window.matchMedia("(pointer: coarse)").matches ? 18 : 10);
                if (!d) return;
                setTip(null);
                setSource(null);
                setWho(d.n);
              }}
            >
              {geo.camps.map((c) => (c.path ? <path key={c.g} className="hull" d={c.path} /> : null))}
              {geo.dots.map((d) => {
                const v = d.v[vi] ?? ".";
                const cls = mapMode === "camp" ? `p v-g c${d.camp}` : `p v-${v === "." ? "n" : v}`;
                return <circle key={d.n} className={cls} cx={d.cx} cy={d.cy} r={3.1} data-n={d.n} />;
              })}
            </svg>
            {tip ? (
              <div className="tip" style={{ left: tip.x, top: tip.y }}>
                {tip.text}
              </div>
            ) : null}
            <p className="dot-hint">Ein Klick auf einen Punkt zeigt, woher die Stimmen dieser Person kommen.</p>
            <div className="counts" style={cols}>
              {byCloud(cur).map(({ g, c }) => (
                <div key={g}>
                  <b className="num">{n(c.agree)}</b> von {n(c.seen)} im {campLabel(names, g)} stimmen zu
                </div>
              ))}
            </div>
          </div>
          )}
          {detail}
        </section>
      </div>

      {/* Phones: the sheet opens only when a statement is tapped; a tap beside it closes it again. */}
      {sheet ? <div className="erg-scrim" aria-hidden onClick={() => setSheet(false)} /> : null}

      {source || personShown ? (
        <div
          className="erg-source"
          role="dialog"
          aria-modal="true"
          aria-label={source ? "Quelle" : personShown ? whoLabel(personShown.n) : "Person"}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="spanel">
            <button type="button" className="sclose" aria-label="Schließen" ref={closeRef} onClick={closeDialog}>
              <span className="sx" aria-hidden>
                ×
              </span>
              <span className="sl">Schließen</span>
            </button>
            {/* Kept while a quote of this person is open, so "Zurück" finds the lists as they were. */}
            {personShown ? (
              <div hidden={source !== null}>
              <PersonPanel
                key={personShown.n}
                r={r}
                names={names}
                p={personShown}
                name={orgOf.get(personShown.n) ?? null}
                cur={cur}
                onQuote={(s, q) => setSource({ s, q })}
                onPick={(nr) => {
                  closeDialog();
                  select(nr);
                }}
              />
              </div>
            ) : null}
            {source ? (
            <>
            {personShown ? (
              <button type="button" className="sback" onClick={() => setSource(null)}>
                ← Zurück zu {whoLabel(personShown.n)}
              </button>
            ) : null}
            <div className="chain">
              <span>Bericht</span>
              <i>→</i>
              <span>Aussage {source.s.nr}</span>
              <i>→</i>
              <span>Zitat</span>
              <i>→</i>
              <b>Original</b>
            </div>
            <div className="eyebrow">
              {source.q.source?.kind === "kurzaussage" ? "Eigener Punkt aus der Beteiligung" : source.q.source?.kind === "privat" ? "Stellungnahme einer Privatperson" : "Stellungnahme"}
              {source.q.source?.date ? ` · ${source.q.source.date}` : ""}
            </div>
            <h3>
              {source.q.source?.kind === "organisation"
                ? source.q.sender
                : source.q.person
                  ? `Person ${source.q.person}${source.q.camp !== null ? ` · ${campLabel(names, source.q.camp)}` : ""}`
                  : source.q.sender}
            </h3>
            <div className="meta">
              {source.q.source?.kind === "organisation"
                ? `Markiert ist die Stelle, die zur Aussage ${source.s.nr} führt.`
                : `Pseudonymisiert. ${
                    {
                      verfasser: `Die Maschine hat die Aussage ${source.s.nr} vorgeschlagen, die Person hat bestätigt: „Ja, das meine ich.“`,
                      regel: `Automatisch der Aussage ${source.s.nr} zugeordnet; die Redaktion prüft Stichproben.`,
                      maschine: `Von der Maschine der Aussage ${source.s.nr} zugeordnet; die Redaktion prüft Stichproben.`,
                      redaktion: `Zuordnung zur Aussage ${source.s.nr} von der Maschine vorgeschlagen, von der Redaktion entschieden.`,
                    }[source.q.confirmedBy ?? "redaktion"]
                  }`}
            </div>
            <div className="doc">
              {source.q.source?.before ? <p>{source.q.source.before}</p> : null}
              <p className="hit">{source.q.text}</p>
              {source.q.source?.after ? <p>{source.q.source.after}</p> : null}
            </div>
            {source.q.source?.kind === "organisation" ? (
              <p className="hint">Der Text davor und danach steht mit, damit man prüfen kann, ob das Zitat den Text fair wiedergibt.</p>
            ) : source.q.source?.kind === "kurzaussage" ? (
              <p className="hint">So ist der eigene Punkt eingegangen, ganz und unverändert.</p>
            ) : (
              <p className="hint">Bei Privatpersonen zeigen wir nur die zitierte Stelle, nie den Text darum herum.</p>
            )}
            {props.reportable ? (
              <ReportBox
                key={`m${source.q.move}`}
                gemeinde={props.reportable.gemeinde}
                verfahren={props.reportable.verfahren}
                kind="move"
                id={source.q.move}
                label="Hier stimmt etwas nicht: Zitat melden"
              />
            ) : null}
            {person && !personShown ? (
              <div className="also">
                <div className="eyebrow">Dieselbe Person hat außerdem bewertet</div>
                {r.statements
                  .filter((x) => x.nr !== source.s.nr && (person.v[x.nr - 1] === "a" || person.v[x.nr - 1] === "d"))
                  .slice(0, 5)
                  .map((x) => (
                    <div key={x.nr} className="ov">
                      <span className={`st ${person.v[x.nr - 1] === "a" ? "ok" : "bad"}`}>{person.v[x.nr - 1] === "a" ? "stimmt zu" : "lehnt ab"}</span>
                      <span>{x.text}</span>
                    </div>
                  ))}
                <p className="hint">So wird aus einem Zitat eine Stimme: Man sieht, wo diese Person sonst steht, und ob der Bericht sie fair einordnet.</p>
                <button
                  type="button"
                  className="pv-more"
                  onClick={() => {
                    setWho(person.n);
                    setSource(null);
                  }}
                >
                  Alle Stimmen und Texte von {whoLabel(person.n)} ansehen
                </button>
              </div>
            ) : null}
            </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="erg-bottom">
        <section className="erg-gaps">
          <h2>Was niemand beantwortet hat</h2>
          {gaps.length ? (
            gaps.map((g, i) => (
              <div key={i} className="gap">
                <div className="f">{g.title}</div>
                <p>{g.text}</p>
              </div>
            ))
          ) : (
            <div className="gap">
              <p>Jeder Einwand wurde erhoben, und auf jeden gab es eine Antwort.</p>
            </div>
          )}
        </section>
        <section className="erg-method">
          <h2>Wie diese Seite entstanden ist</h2>
          {props.method.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
          <p>
            {sat.saturated
              ? `Die Debatte gilt als ausgeschöpft: Die letzten ${n(sat.streak)} Eingaben brachten keinen neuen Punkt.`
              : `Von ${n(sat.inputs)} Eingaben brachten ${n(sat.newPoints)} einen neuen Punkt, ${sat.streak ? `zuletzt ${n(sat.streak)} in Folge keinen` : "auch die letzte noch"}. Ausgeschöpft wäre die Debatte erst nach ${n(sat.window)} Eingaben ohne Neues.`}
          </p>
          {sat.series.length ? (
            <div className="sat" aria-label="Eingaben in der Reihenfolge ihres Eingangs; grün: brachte einen neuen Punkt">
              {sat.series.map((x, i) => (
                <i key={i} className={x ? "new" : undefined} />
              ))}
            </div>
          ) : null}
          {props.report || props.files?.length ? (
            <div className="files">
              {props.report ? <a href={props.report.href}>{props.report.label}</a> : null}
              {props.files?.map((f) => (
                <a key={f.href} href={f.href}>
                  {f.label}
                </a>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

// ———— One person behind a dot ————
// Stephan: every dot leads back to what this person actually put in — their own clicks, the passages of their
// texts that count as votes (each opening the original), or the plain note that the person is simulated.
const HOW_SHORT = { k: "selbst", t: "aus dem Text", z: "simuliert" } as const;
type How = keyof typeof HOW_SHORT;
const SHOW = 8;
const tone = (v: string) => (v === "a" ? "ok" : v === "d" ? "bad" : "grey");

function PersonPanel(props: {
  r: Ergebnis;
  names: CampNames;
  p: Person;
  /** The organisation's name; private persons stay a number. */
  name: string | null;
  /** The statement the opinion space is coloured by. */
  cur: StatementOut;
  onQuote: (s: StatementOut, q: Quote) => void;
  onPick: (nr: number) => void;
}) {
  const { r, names, p, name, cur } = props;
  const [all, setAll] = useState<Set<string>>(() => new Set());
  const more = (key: string) => setAll((x) => new Set([...x, key]));
  const label = name ?? `Person ${p.n}`;
  const sender = p.via === "datei" || p.via === "stellungnahme";
  const texts = r.statements.flatMap((s) => s.quotes.filter((q) => q.person === p.n).map((q) => ({ s, q })));
  const withText = new Set(texts.map((x) => x.s.nr));
  const how = (nr: number): How | null => {
    const c = p.o?.[nr - 1];
    if (c === "k" || c === "t" || c === "z") return c;
    // Older results do not record it: what the published passages and the way the person came in show.
    if (withText.has(nr)) return "t";
    if (p.via === "simulation") return "z";
    if (sender) return "t";
    return null;
  };
  const voted = r.statements.filter((s) => (p.v[s.nr - 1] ?? ".") !== ".");
  const by = (c: "a" | "d" | "p") => voted.filter((s) => p.v[s.nr - 1] === c);
  const tally: Record<How, number> = { k: 0, t: 0, z: 0 };
  for (const s of voted) {
    const h = how(s.nr);
    if (h) tally[h]++;
  }
  const fromText = sender ? "aus der Stellungnahme" : "aus eigenen Texten";
  const only = (Object.keys(tally) as How[]).find((h) => tally[h] && tally[h] === voted.length);
  const parts = only
    ? [{ k: "alle selbst abgestimmt", t: `alle ${fromText} gelesen`, z: "alle simuliert" }[only]]
    : [
        tally.k ? `davon ${n(tally.k)} selbst abgestimmt` : null,
        tally.t ? `${tally.k ? "" : "davon "}${n(tally.t)} ${fromText} gelesen` : null,
        tally.z ? `${tally.k || tally.t ? "" : "davon "}${n(tally.z)} simuliert` : null,
      ].filter(Boolean);

  const kind =
    p.via === "simulation"
      ? "Simulierte Person"
      : sender
        ? name
          ? "Stellungnahme"
          : "Stellungnahme einer Privatperson"
        : p.drawn
          ? "Per Los eingeladen"
          : "Aus der Beteiligung";
  const intro =
    p.via === "simulation"
      ? `Diese Person ist simuliert: Ihre Stimmen hat ein Rechenmodell erzeugt${texts.length ? ", auch ihre Texte gehören zur Simulation" : ""}.`
      : sender
        ? "Die Stimmen sind aus der Stellungnahme gelesen: Wo sie eine Aussage stützt, zählt das als Zustimmung, wo sie ihr widerspricht, als Ablehnung."
        : `${p.drawn ? "Per Los ausgewählt und mit einem Brief eingeladen. " : ""}Hat selbst abgestimmt${
            texts.length || tally.t ? ". Was die Person geschrieben hat, zählt dort als Stimme, wo es eine Aussage stützt oder ihr widerspricht" : ""
          }.`;

  const quotes = (xs: { s: StatementOut; q: Quote }[], withStatement: boolean) => (
    <div className="quotes">
      {xs.map(({ s, q }) => (
        <blockquote
          key={q.move}
          className={`q${q.camp !== null ? ` c${q.camp}` : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => props.onQuote(s, q)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onQuote(s, q);
            }
          }}
        >
          {withStatement ? (
            <div className="pv-for">
              Zu Aussage {s.nr}: {s.text}
            </div>
          ) : null}
          <p>„{q.text}“</p>
          <div className="src">
            {q.stance === 1 ? "stimmt zu" : "widerspricht"} <span className="go">Im Original lesen →</span>
          </div>
        </blockquote>
      ))}
    </div>
  );

  const v = p.v[cur.nr - 1] ?? ".";
  const h = how(cur.nr);
  const here = texts.filter((x) => x.s.nr === cur.nr);
  const others = texts.filter((x) => x.s.nr !== cur.nr);
  const src = sender ? "der Stellungnahme" : "dem eigenen Text";
  const now =
    v === "."
      ? sender
        ? "Dazu sagt die Stellungnahme nichts."
        : "Zu dieser Aussage hat die Person nicht abgestimmt."
      : h === "k"
        ? "Selbst abgestimmt."
        : h === "z"
          ? "Vom Rechenmodell erzeugt."
          : h === "t"
            ? here.length
              ? `Gelesen aus ${src}:`
              : `Gelesen aus ${src}. Die Stelle zeigen wir nicht: Sie nennt eine Privatperson oder wurde nach einer Meldung verborgen.`
            : null;

  return (
    <div className="pv">
      <div className="chain">
        <span>Meinungsraum</span>
        <i>→</i>
        <b>{sender ? "Absender" : "Person"}</b>
        <i>→</i>
        <span>Stimmen und Texte</span>
        <i>→</i>
        <span>Original</span>
      </div>
      <div className="eyebrow">{kind}</div>
      <h3>{label}</h3>
      <div className="meta">
        {p.camp >= 0 ? `${campLabel(names, p.camp)} · ` : ""}
        {n(voted.length)} {voted.length === 1 ? "Stimme" : "Stimmen"}
        {parts.length ? `, ${parts.join(", ")}` : ""}
      </div>
      <p className="pv-intro">{intro}</p>

      <section className="pv-sec">
        <div className="eyebrow">Zur gewählten Aussage {cur.nr}</div>
        <p className="pv-st">{cur.text}</p>
        <div className="pv-how">
          <span className={`st ${tone(v)}`}>{VOTE[v]}</span>
          {now ? <span>{now}</span> : null}
        </div>
        {here.length ? quotes(here, false) : null}
      </section>

      {others.length ? (
        <section className="pv-sec">
          <div className="eyebrow">
            {here.length ? "Weitere Textstellen" : "Textstellen"} · {n(others.length)}
          </div>
          {quotes(all.has("texte") ? others : others.slice(0, SHOW), true)}
          {others.length > SHOW && !all.has("texte") ? (
            <button type="button" className="pv-more" onClick={() => more("texte")}>
              Alle {n(others.length)} Textstellen zeigen
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="pv-sec">
        <div className="eyebrow">Alle Stimmen · {n(voted.length)}</div>
        {(["a", "d", "p"] as const).map((c) => {
          const xs = by(c);
          if (!xs.length) return null;
          const open = all.has(c);
          return (
            <div key={c} className="pv-group">
              <h4>
                <span className={`st ${tone(c)}`}>{VOTE[c]}</span>
                <span className="num">{n(xs.length)}</span>
              </h4>
              {(open ? xs : xs.slice(0, SHOW)).map((s) => {
                const hw = how(s.nr);
                return (
                  <button key={s.nr} type="button" className="pv-row" onClick={() => props.onPick(s.nr)}>
                    <span className="nr num">{s.nr}</span>
                    <span className="t">{s.text}</span>
                    <span className="how">{hw ? HOW_SHORT[hw] : ""}</span>
                  </button>
                );
              })}
              {xs.length > SHOW && !open ? (
                <button type="button" className="pv-more" onClick={() => more(c)}>
                  Alle {n(xs.length)} zeigen
                </button>
              ) : null}
            </div>
          );
        })}
        <p className="hint">Ein Klick auf eine Aussage färbt den Meinungsraum nach ihr.</p>
      </section>
    </div>
  );
}
