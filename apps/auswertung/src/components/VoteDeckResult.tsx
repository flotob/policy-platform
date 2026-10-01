"use client";

import type { Ref } from "react";

import { TypTag, Voices } from "@policy/landkarte";
import type { CampCount } from "@policy/landkarte/data/types";
import type { VoteCamp, VoteData, VoteMeasure, VoteOrg, VotePoint, VoteTyp } from "@policy/landkarte/data/vote";

import { AnswerIcon, campCount, type Answer } from "./VoteDeckShared";

interface Score {
  /** Questions where both you and they have a position. */
  n: number;
  /** …of which the same position. */
  k: number;
}

/** A camp's position on a point: what the majority of its organisations that said something says; null on a tie or silence. */
function majority(c: CampCount): 1 | -1 | null {
  return c.agree > c.disagree ? 1 : c.disagree > c.agree ? -1 : null;
}

/** How clear a camp's majority is (for ordering the differences). */
function clarity(c: CampCount): number {
  const said = c.agree + c.disagree;
  return said ? Math.abs(c.agree - c.disagree) / said : 0;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "7 von 9 Fragen", "0 von 1 Frage". */
const ofQ = (k: number, n: number) => `${k} von ${plural(n, "Frage", "Fragen")}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);

/** n small squares, k of them filled: the same answer k times out of n. */
function Meter({ k, n, side }: { k: number; n: number; side?: "a" | "b" | null }) {
  if (n === 0) return null;
  return (
    <span className={`vote-meter${side ? ` vote-meter-${side}` : ""}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < k ? "is-same" : undefined} />
      ))}
    </span>
  );
}

function CampDot({ side }: { side: "a" | "b" | null }) {
  if (!side) return <span className="vote-campdot" aria-hidden />;
  return (
    <span className={`vote-campdot lk-side-${side}`} aria-hidden>
      <i className="lk-dot lk-dot-agree" />
    </span>
  );
}

function YourAnswer({ v }: { v: 1 | -1 }) {
  return (
    <span className="vote-mine">
      <AnswerIcon v={v} />
      Sie {v === 1 ? "stimmen zu" : "lehnen ab"}
    </span>
  );
}

function DiffRow({ p, base, v, camps }: { p: VotePoint; base: string; v: 1 | -1; camps: { camp: VoteCamp; count: CampCount }[] }) {
  return (
    <div className="row">
      <div className="row-main">
        {p.question ? <p className="muted small" style={{ margin: "0 0 0.2rem" }}>{p.question}</p> : null}
        <p className="row-title">
          <a href={`${base}/punkt/${p.id}`}>{p.text}</a>
        </p>
        <p className="vote-diff-typ">
          <TypTag typ={p.typ} />
        </p>
      </div>
      <aside className="margin">
        <YourAnswer v={v} />
        <div className="lk-campvoices">
          {camps.map(({ camp, count }) => (
            <Voices key={camp.side} count={count} side={camp.side} name={camp.name} />
          ))}
        </div>
      </aside>
    </div>
  );
}

const TYP_CONSEQUENCE: Record<VoteTyp, (n: number) => string> = {
  T: (n) => `${plural(n, "Tatsachenfrage", "Tatsachenfragen")}: Hier kann ein Gutachten klären, wer recht hat.`,
  W: (n) => `${plural(n, "Wertfrage", "Wertfragen")}: Die entscheidet die Politik, kein Beleg.`,
  verfahren: (n) => `${plural(n, "Frage", "Fragen")} der Ausgestaltung: Darüber lässt sich verhandeln.`,
};

export function VoteResult({
  data,
  measure,
  deck,
  answers,
  base,
  headingRef,
  onAgain,
  onOther,
  onBack,
  complete,
}: {
  data: VoteData;
  measure: VoteMeasure;
  deck: VotePoint[];
  answers: Record<string, Answer>;
  base: string;
  headingRef: Ref<HTMLHeadingElement>;
  onAgain: () => void;
  onOther: () => void;
  onBack: () => void;
  complete: boolean;
}) {
  const answered = deck.filter((p) => answers[p.id] === 1 || answers[p.id] === -1);
  const mine = (p: VotePoint) => answers[p.id] as 1 | -1;
  const skipped = deck.filter((p) => answers[p.id] === 0).length;
  const unseen = deck.length - answered.length - skipped;
  const camps = data.camps.length >= 2 ? data.camps : [];
  const countOf = (p: VotePoint, c: VoteCamp) => campCount(p, c.side, data.orgs, c.size);

  // Camps: on how many answered questions with a clear camp majority do you answer like that majority?
  const campScores = camps.map((c) => {
    const s: Score = { n: 0, k: 0 };
    for (const p of answered) {
      const m = majority(countOf(p, c));
      if (m == null) continue;
      s.n++;
      if (m === mine(p)) s.k++;
    }
    return { camp: c, ...s };
  });
  const rated = campScores.filter((c) => c.n > 0);
  let nearest: (typeof campScores)[number] | null = null;
  let tie = false;
  let narrow = false;
  if (rated.length === 1) nearest = rated[0]!;
  else if (rated.length === 2) {
    const [x, y] = rated as [(typeof rated)[number], (typeof rated)[number]];
    const cmp = x.k * y.n - y.k * x.n;
    if (cmp === 0) tie = true;
    else nearest = cmp > 0 ? x : y;
    narrow = Math.abs(x.k / x.n - y.k / y.n) < 0.1;
  }
  const others = campScores.filter((c) => c !== nearest);

  // Organisations: same position on the questions both answered; few shared questions count for less.
  const orgScores = data.orgs
    .map((o: VoteOrg) => {
      const s: Score = { n: 0, k: 0 };
      for (const p of answered) {
        const v = p.positions[o.id];
        if (v == null) continue;
        s.n++;
        if (v === mine(p)) s.k++;
      }
      return { org: o, ...s };
    })
    .sort((x, y) => (y.k + 1) / (y.n + 2) - (x.k + 1) / (x.n + 2) || y.n - x.n || x.org.short.localeCompare(y.org.short, "de"));
  const first = orgScores.find((x) => x.n > 0);
  const tops = first ? orgScores.filter((x) => x.k === first.k && x.n === first.n) : [];

  // Where you leave your nearest camp (clearest camp majority first) — or, on a tie, where the camps part.
  const diffs = nearest
    ? answered
        .filter((p) => {
          const m = majority(countOf(p, nearest!.camp));
          return m != null && m !== mine(p);
        })
        .sort((p, q) => clarity(countOf(q, nearest!.camp)) - clarity(countOf(p, nearest!.camp)))
    : [];
  const parting =
    tie && camps.length === 2
      ? answered.filter((p) => {
          const ma = majority(countOf(p, camps[0]!));
          const mb = majority(countOf(p, camps[1]!));
          return ma != null && mb != null && ma !== mb;
        })
      : [];
  const byTyp = (list: VotePoint[]) =>
    (["T", "W", "verfahren"] as VoteTyp[]).map((t) => ({ t, n: list.filter((p) => p.typ === t).length })).filter((x) => x.n > 0);

  const actions = (
    <div className="vote-result-actions">
      {!complete && answered.length + skipped > 0 ? (
        <button type="button" className="btn btn-primary" onClick={onBack}>
          Weiter abstimmen
        </button>
      ) : null}
      <button type="button" className={`btn${complete || answered.length + skipped === 0 ? " btn-primary" : ""}`} onClick={onAgain}>
        Noch einmal
      </button>
      <button type="button" className="btn" onClick={onOther}>
        Andere Teilentscheidung
      </button>
    </div>
  );

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Wo stehen Sie? / {measure.display}
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="vote-h1">
          Ihr Ergebnis
        </h1>
        <p className="lead">
          {answered.length === 0
            ? "Sie haben keine Frage beantwortet. Ohne Antworten lässt sich nichts vergleichen."
            : `Sie haben ${answered.length} von ${deck.length} Fragen zu „${measure.display}“ beantwortet${
                skipped ? ` und ${skipped} übersprungen` : ""
              }.${unseen ? ` ${plural(unseen, "Frage haben", "Fragen haben")} Sie noch nicht gesehen.` : ""}`}
        </p>
      </header>

      {answered.length === 0 ? (
        actions
      ) : (
        <>
          {camps.length === 2 ? (
            <section>
              <h2>Ihr nächstes Lager</h2>
              <div className="row">
                <div className="row-main">
                  {nearest ? (
                    <>
                      <p className="row-title">
                        {narrow ? "Knapp am nächsten" : "Am nächsten"} sind Sie dem Lager „{nearest.camp.name}“.
                      </p>
                      {nearest.camp.summary ? <p className="row-text">{nearest.camp.summary}</p> : null}
                      <p className="row-text">
                        Dieses Lager hat zu {nearest.n} Ihrer Fragen eine klare Mehrheit. Bei {nearest.k} davon antworten Sie wie diese Mehrheit.
                        {others.map((c) =>
                          c.n > 0
                            ? ` Beim Lager „${c.camp.name}“ sind es ${c.k} von ${c.n}.`
                            : ` Das Lager „${c.camp.name}“ hat zu Ihren Fragen keine klare Mehrheit.`,
                        )}
                      </p>
                    </>
                  ) : tie ? (
                    <>
                      <p className="row-title">Sie liegen genau zwischen den beiden Lagern.</p>
                      <p className="row-text">
                        {campScores.map((c, i) => `${i ? " " : ""}Mit „${c.camp.name}“ antworten Sie in ${ofQ(c.k, c.n)} wie die Mehrheit.`)}
                      </p>
                    </>
                  ) : (
                    <p className="row-title">Zu Ihren Fragen hat keines der beiden Lager eine klare Mehrheit.</p>
                  )}
                </div>
                <aside className="margin">
                  {campScores.map((c) => (
                    <div key={c.camp.side} className="vote-campscore">
                      <span className="vote-campscore-name">
                        <CampDot side={c.camp.side} /> {c.camp.name}
                      </span>
                      <Meter k={c.k} n={c.n} side={c.camp.side} />
                      <span>{c.n ? `${ofQ(c.k, c.n)} wie Sie` : "keine klare Mehrheit"}</span>
                    </div>
                  ))}
                  <div className="muted">
                    Ein Lager sind Organisationen, die ähnlich Stellung nehmen. Eine Frage zählt, wenn die Mehrheit eines Lagers zustimmt oder ablehnt; bei
                    Gleichstand zählt sie nicht.
                  </div>
                </aside>
              </div>
            </section>
          ) : null}

          {nearest ? (
            <section>
              <h2>Wo Sie von Ihrem Lager abweichen</h2>
              {diffs.length === 0 ? (
                <p className="prose">Bei keiner Ihrer Antworten weichen Sie von der Mehrheit des Lagers „{nearest.camp.name}“ ab.</p>
              ) : (
                <>
                  <p className="prose">
                    Bei {plural(diffs.length, "Frage", "Fragen")} antworten Sie anders als die Mehrheit des Lagers „{nearest.camp.name}“, die deutlichsten
                    zuerst. Nach Art der Frage:
                  </p>
                  <ul className="vote-kinds">
                    {byTyp(diffs).map((x) => (
                      <li key={x.t}>{TYP_CONSEQUENCE[x.t](x.n)}</li>
                    ))}
                  </ul>
                  {diffs.map((p) => (
                    <DiffRow key={p.id} p={p} base={base} v={mine(p)} camps={[{ camp: nearest!.camp, count: countOf(p, nearest!.camp) }]} />
                  ))}
                </>
              )}
            </section>
          ) : tie && parting.length > 0 ? (
            <section>
              <h2>Wo die Lager verschieden antworten</h2>
              <p className="prose">Bei diesen Fragen stimmt die Mehrheit des einen Lagers zu und die des anderen nicht. Hier entscheidet sich, wo Sie stehen.</p>
              {parting.map((p) => (
                <DiffRow key={p.id} p={p} base={base} v={mine(p)} camps={camps.map((c) => ({ camp: c, count: countOf(p, c) }))} />
              ))}
            </section>
          ) : null}

          <section>
            <h2>Die Organisationen, nach Übereinstimmung</h2>
            <p className="prose">
              {first
                ? `Die größte Übereinstimmung: ${list(tops.map((x) => x.org.short))}, ${tops.length > 1 ? "je " : ""}in ${ofQ(first.k, first.n)}. `
                : "Zu Ihren Fragen hat sich keine Organisation geäußert. "}
              Gezählt werden nur Fragen, zu denen sich eine Organisation geäußert hat.
            </p>
            {camps.length === 2 ? (
              <ul className="vote-legend">
                {camps.map((c) => (
                  <li key={c.side}>
                    <CampDot side={c.side} /> Lager „{c.name}“
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="row">
              <div className="row-main">
                <ol className="vote-orgs">
                  {orgScores.map((x) => {
                    const camp = camps.find((c) => c.side === x.org.side);
                    return (
                      <li key={x.org.id} className={x.n === 0 ? "is-silent" : undefined}>
                        <CampDot side={x.org.side} />
                        <span className="vote-org-name">
                          <a href={`${base}/organisationen/${x.org.id}`} title={x.org.name}>
                            {x.org.short}
                          </a>
                          {camp ? <span className="vote-sr">, Lager „{camp.name}“</span> : null}
                        </span>
                        <span className="vote-org-count">
                          {x.n === 0 ? "hat sich zu Ihren Fragen nicht geäußert" : `${ofQ(x.k, x.n)} gleich`}
                        </span>
                        <Meter k={x.k} n={x.n} />
                      </li>
                    );
                  })}
                </ol>
              </div>
              <aside className="margin">
                <div>
                  Die Positionen der Organisationen sind aus ihren schriftlichen Stellungnahmen abgeleitet (Jev), nicht von ihnen selbst abgestimmt.
                </div>
                <div className="muted">Wer nur wenige Fragen mit Ihnen teilt, steht weiter unten, auch bei voller Übereinstimmung.</div>
              </aside>
            </div>
          </section>

          <p className="vote-note">
            Ihre Antworten verlassen diesen Browser nicht. Ein Ergebnis über wenige Fragen ist eine Richtung, kein Urteil.
          </p>
          {actions}
        </>
      )}
    </>
  );
}
