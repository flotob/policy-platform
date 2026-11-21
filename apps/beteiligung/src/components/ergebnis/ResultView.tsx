"use client";

import type { Entry, Ergebnis, Quote, StatementOut } from "@policy/pipeline/kern";
import {
  campLabel,
  campName,
  checkLines,
  conclusionText,
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
  schemeConclusion,
  smallHeadline,
  smallNote,
  statusWords,
  stepCountText,
  stepText,
  TALLY_ORDER,
  TALLY_WORDS,
  tallyOf,
  type Tally,
  TYP_WORDS,
  VERDICT_WORDS,
  word,
  type CampNames,
} from "@policy/pipeline/kern/text";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ReportBox } from "@/components/ReportBox";
import { decisionHead, outcomeOf, outcomeSentence, type PublicDecision } from "@/lib/beschluss-words";
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
  const initial = r.core[0] ?? r.statements.find((s) => s.category === "streit")?.nr ?? r.statements[0]?.nr ?? 1;
  const [sel, setSel] = useState(initial);
  const [view, setView] = useState<"befund" | "argument">("befund");
  const [filter, setFilter] = useState<Group | "alle">("alle");
  const [tallyFilter, setTallyFilter] = useState<Tally | "alle">("alle");
  const [mapMode, setMapMode] = useState<"vote" | "camp">("vote");
  const [sheet, setSheet] = useState(false);
  const [source, setSource] = useState<{ s: StatementOut; q: Quote } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cur = byNr.get(sel) ?? r.statements[0]!;

  useEffect(() => {
    const m = window.location.hash.match(/^#a(\d+)$/);
    if (m && byNr.has(Number(m[1]))) setSel(Number(m[1]));
  }, [byNr]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (source) setSource(null);
      else setSheet(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [source]);
  useEffect(() => {
    if (!source) return;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [source]);

  const select = (nr: number, open = true) => {
    setSel(nr);
    window.history.replaceState(null, "", `#a${nr}`);
    // The right column scrolls on its own: a new statement starts at its top, with the opinion space in view.
    if (stageRef.current) stageRef.current.scrollTop = 0;
    if (open && window.innerWidth <= 900) setSheet(true);
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
  const vi = cur.nr - 1;

  const campItems = (s: StatementOut) =>
    s.camps.map((c, g) => ({ g, v: pct(c.agree, c.seen), seen: c.seen }));

  // ———— One statement in the list ————
  const item = (s: StatementOut, head?: ReactNode, foot?: ReactNode, key?: string) => {
    const cs = campItems(s).filter((c) => c.seen);
    const lo = cs.length ? Math.min(...cs.map((c) => c.v)) : 0;
    const hi = cs.length ? Math.max(...cs.map((c) => c.v)) : 0;
    return (
      <button key={key ?? s.nr} type="button" className="item" aria-current={s.nr === sel ? "true" : "false"} onClick={() => select(s.nr)}>
        {head}
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
  const t = r.params.bridgeThreshold;
  const counts = new Map<Group, number>();
  for (const s of r.statements) counts.set(groupOf(s, t), (counts.get(groupOf(s, t)) ?? 0) + 1);

  const tallies = new Map<Tally, number>();
  for (const s of r.statements) tallies.set(tallyOf(s), (tallies.get(tallyOf(s)) ?? 0) + 1);
  const tallyList = (
    <>
      <div className="chips" role="group" aria-label="Filter">
        <button type="button" className="chip" aria-pressed={tallyFilter === "alle"} onClick={() => setTallyFilter("alle")}>
          Alle Aussagen<span className="n num">{N}</span>
        </button>
        {TALLY_ORDER.filter((t) => tallies.get(t)).map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tallyFilter === t} onClick={() => setTallyFilter(t)}>
            {TALLY_WORDS[t]}
            <span className="n num">{tallies.get(t)}</span>
          </button>
        ))}
      </div>
      {TALLY_ORDER.filter((t) => (tallyFilter === "alle" || tallyFilter === t) && tallies.get(t)).map((t) => (
        <section key={t} className="group" data-tally={t}>
          <h3>
            <span className="dot" />
            {TALLY_WORDS[t]}
          </h3>
          <div className="items">{r.statements.filter((s) => tallyOf(s) === t).map((s) => item(s))}</div>
        </section>
      ))}
    </>
  );

  const befundList = (
    <>
      <div className="chips" role="group" aria-label="Filter">
        <button type="button" className="chip" aria-pressed={filter === "alle"} onClick={() => setFilter("alle")}>
          Alle Aussagen<span className="n num">{N}</span>
        </button>
        {GROUP_ORDER.filter((c) => counts.get(c)).map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={filter === c} onClick={() => setFilter(c)}>
            {groupWords(c, k).label}
            <span className="n num">{counts.get(c)}</span>
          </button>
        ))}
      </div>
      {GROUP_ORDER.filter((c) => (filter === "alle" || filter === c) && counts.get(c)).map((c) => (
        <section key={c} className="group" data-cat={c}>
          <h3>
            <span className="dot" />
            {groupWords(c, k).label}
          </h3>
          <div className="items">{r.statements.filter((s) => groupOf(s, t) === c).map((s) => item(s))}</div>
        </section>
      ))}
    </>
  );

  const root = r.statements.find((s) => s.rolle === "schluss");
  const argumentList = (
    <>
      <div className="these lead">
        <div className="who">Die Maßnahme</div>
        <p>{props.measure}</p>
        <div className="who" style={{ marginTop: 8 }}>
          So begründet die Stadt sie, in vier Schritten. Darunter jeweils, was die Teilnehmenden dazu gesagt haben.
        </div>
      </div>
      {root ? item(root) : null}
      {/* The four steps hang on one line like links of a chain; the "Also" is where it ends. */}
      <div className="kt-chain">
      {r.steps.map((st, i) => {
        const sup = r.statements.flatMap((s) => s.entries.filter((e) => e.step === st.key && e.role === "stuetzt").map((e) => ({ s, e })));
        const att = r.statements.flatMap((s) => s.entries.filter((e) => e.step === st.key && e.role === "greift_an").map((e) => ({ s, e })));
        const v = VERDICT_WORDS[st.verdict];
        return (
          <section key={st.key} className={`group step kt-step ${small ? "grey" : v.tone}`}>
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
      {small ? null : (
        <div className="kt-end">
          <span className="kt-node" aria-hidden />
          <h3>Also</h3>
          <div className="kt-also">
            <p>{conclusionText(r)}</p>
          </div>
        </div>
      )}
      </div>
    </>
  );

  const scheme = small ? (
    <div className="scheme">
      <p>
        Wer eine Maßnahme begründet, macht vier Schritte. Jede Aussage aus der Beteiligung stützt einen davon oder greift ihn an. Ob ein Angriff
        steht, entscheidet die Auswertung erst mit Lagern; hier steht, was vorgebracht wurde.
      </p>
      {r.steps.map((st, i) => (
        <div key={st.key} className="row">
          <span className="k">{i + 1}</span>
          <span className="lbl">
            {st.label}
            <span className="sub num">
              {st.supports} stützend · {st.attacks} {st.attacks === 1 ? "Angriff" : "Angriffe"}
              {st.unasked.length ? ` · ${st.unasked.length} ${st.unasked.length === 1 ? "Frage" : "Fragen"} ungestellt` : ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="scheme">
      <p>
        Wer eine Maßnahme begründet, macht vier Schritte. Jede Aussage aus der Beteiligung stützt einen davon oder greift ihn an. Ein Angriff ist
        abgewehrt, klärbar, offen oder er steht. Daraus folgt das Urteil über die Stufe, und aus den vier Urteilen der Schluss.
      </p>
      {r.steps.map((st, i) => {
        const c = st.counts;
        const stand = (c.haelt ?? 0) + (c.verdeckt ?? 0);
        const v = VERDICT_WORDS[st.verdict];
        return (
          <div key={st.key} className="row">
            <span className="k">{i + 1}</span>
            <span className="lbl">
              {st.label}
              <span className="sub num">
                {st.attacks} {st.attacks === 1 ? "Angriff" : "Angriffe"} · {c.abgewehrt ?? 0} abgewehrt · {stand} {stand === 1 ? "steht" : "stehen"}
                {st.unasked.length ? ` · ${st.unasked.length} ${st.unasked.length === 1 ? "Frage" : "Fragen"} ungestellt` : ""}
              </span>
            </span>
            <span className={`st ${v.tone}`}>{v.text}</span>
          </div>
        );
      })}
      <div className="concl">
        <span>Also</span>
        {schemeConclusion(r)}
      </div>
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
          {cur.camps.map((c, g) => (
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
    small
      ? `Die Teilnehmenden haben über ${N} Aussagen abgestimmt. Jede Aussage führt bis zum Originalzitat zurück.`
      : `Die Auswertung hat ${word(k, false)} Lager gefunden und ${N} Aussagen, an denen sich der Streit entscheidet. Jede Aussage führt bis zum Originalzitat zurück.`,
  ].join(" ");
  const showBridges = () => {
    setView("befund");
    if (small) setTallyFilter("zu");
    else setFilter("bruecke");
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const gaps = gapTexts(r, props.questions);
  const sat = r.saturation;
  const person = source?.q.person ? r.people.find((x) => x.n === source.q.person && x.camp >= 0) : undefined;

  return (
    <div className="erg">
      <header className="erg-top">
        <div className="eyebrow">{props.eyebrow}</div>
        <h1>
          {props.title}: Worüber {props.town} wirklich streitet
        </h1>
        <p className="sub">{sub}</p>
        <div className="erg-verdict">
          <span className="mark" />
          <p>
            <b>
              <button type="button" className="lnk" onClick={showBridges}>
                {h.lead}
              </button>
            </b>{" "}
            {h.rest.map((seg, i) =>
              "nr" in seg ? (
                <button
                  key={i}
                  type="button"
                  className="lnk"
                  onClick={() => {
                    select(seg.nr);
                    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {seg.text}
                </button>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        </div>
        {dec ? (
          <div className="erg-decision">
            <b>{decisionHead(dec)}</b> {dec.summary ?? ""} <span>Bei jeder Aussage steht, was aus ihr geworden ist.</span>
          </div>
        ) : null}
        {small ? <p className="erg-notice">{smallNote(r)}</p> : null}
        {props.notice ? <p className="erg-notice">{props.notice}</p> : null}
        <div className="eyebrow" style={{ marginTop: 8 }}>
          Jeder Satz dieser Seite führt per Klick zurück: zur Aussage, zum Zitat, zum Originaldokument.
        </div>
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

        <section className={`erg-stage${sheet ? " open" : ""}`} ref={stageRef} aria-live="polite">
          <button type="button" className="closeb" aria-label="Schließen" onClick={() => setSheet(false)}>
            <span />
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
                      <i className="none" />
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
            <div className="camp-row" style={{ gridTemplateColumns: `repeat(${geo.camps.length}, minmax(0, 1fr))` }}>
              {[...geo.camps]
                .sort((a, b) => a.cx - b.cx)
                .map((c) => (
                  <div key={c.g} className={`c${c.g}`}>
                    <b>
                      <i aria-hidden />
                      {campLabel(names, c.g)}
                    </b>
                    <span className="num">
                      {n(r.camps?.sizes[c.g] ?? 0)} Personen · {pct(r.camps?.sizes[c.g] ?? 0, total)} %
                    </span>
                  </div>
                ))}
            </div>
            <svg
              viewBox={`0 ${TOP - 10} ${W} ${H - TOP + 10}`}
              role="img"
              aria-label={`${total} Punkte, je einer pro teilnehmender Person, in ${k} Lagern; eingefärbt nach ihrer Stimme zur gewählten Aussage`}
              onMouseMove={(e) => {
                const t = e.target as SVGElement;
                const pn = t.getAttribute("data-n");
                if (!pn) return setTip(null);
                const d = geo.dots.find((x) => x.n === Number(pn));
                if (!d) return setTip(null);
                const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: `Person ${d.n} · ${campName(names, d.camp)} · ${VOTE[d.v[vi] ?? "."]}` });
              }}
              onMouseLeave={() => setTip(null)}
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
            <div className="counts">
              {cur.camps.map((c, g) => (
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

      <button type="button" className="erg-sheetbar" aria-label="Auswertung öffnen" onClick={() => setSheet(true)}>
        <span>
          <span style={{ opacity: 0.7 }}>Gewählte Aussage</span>
          <b>{cur.text}</b>
        </span>
        <span className="arr">▲</span>
      </button>

      {source ? (
        <div
          className="erg-source"
          role="dialog"
          aria-modal="true"
          aria-label="Quelle"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSource(null);
          }}
        >
          <div className="spanel">
            <button type="button" className="sclose" aria-label="Schließen" ref={closeRef} onClick={() => setSource(null)}>
              ×
            </button>
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
            {person ? (
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
              </div>
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
