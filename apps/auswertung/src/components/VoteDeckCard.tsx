"use client";

import type { Ref } from "react";

import { DIAG, DiagLabel, TYP, TypTag, Voices } from "@policy/landkarte";
import type { VoteData, VoteMeasure, VotePoint } from "@policy/landkarte/data/vote";

import { AnswerIcon, campCount, type Answer } from "./VoteDeckShared";

const FACT_NOTE = "Über Tatsachen entscheidet keine Abstimmung. Ihre Stimme zeigt, ob Sie es glauben.";
export const ANSWER_TEXT: Record<1 | -1, string> = { 1: "Sie stimmen zu.", [-1]: "Sie lehnen ab." };

/** One question card: the statement, three answers, then how the camps answered. */
export function VoteCard({
  data,
  measure,
  deck,
  index,
  answers,
  revealed,
  base,
  announce,
  deckRef,
  statementRef,
  nextRef,
  onAnswer,
  onSkip,
  onAdvance,
  onBack,
  onFinish,
  onOther,
}: {
  data: VoteData;
  measure: VoteMeasure;
  deck: VotePoint[];
  index: number;
  answers: Record<string, Answer>;
  revealed: boolean;
  base: string;
  announce: string;
  deckRef?: Ref<HTMLDivElement>;
  statementRef?: Ref<HTMLHeadingElement>;
  nextRef?: Ref<HTMLButtonElement>;
  onAnswer: (v: 1 | -1) => void;
  onSkip: () => void;
  onAdvance: () => void;
  onBack: () => void;
  onFinish: () => void;
  onOther: () => void;
}) {
  const point = deck[Math.min(index, deck.length - 1)]!;
  const campA = data.camps.find((c) => c.side === "a");
  const campB = data.camps.find((c) => c.side === "b");
  const answeredCount = deck.filter((p) => answers[p.id] === 1 || answers[p.id] === -1).length;
  const given = answers[point.id];
  const a = campA ? campCount(point, "a", data.orgs, campA.size) : null;
  const b = campB ? campCount(point, "b", data.orgs, campB.size) : null;
  const mine = given === 1 || given === -1 ? given : null;
  const same = mine ? data.orgs.filter((o) => point.positions[o.id] === mine) : [];
  const differ = mine ? data.orgs.filter((o) => point.positions[o.id] === -mine) : [];
  const d = DIAG[point.diag ?? "offen"];
  const last = index + 1 >= deck.length;

  return (
    <div className="vote" ref={deckRef}>
      <p className="crumbs vote-crumbs">
        <a href={base}>Lagebild</a> / Wo stehen Sie? / {measure.display}
      </p>

      <div className="vote-progress">
        <span className="vote-progress-text">
          Frage {index + 1} von {deck.length}
        </span>
        <ol className="vote-ticks" aria-hidden>
          {deck.map((p, i) => {
            const v = answers[p.id];
            const cls = i === index ? "is-now" : v === 1 || v === -1 ? "is-done" : v === 0 ? "is-skip" : "";
            return <li key={p.id} className={cls} />;
          })}
        </ol>
      </div>

      <section className="vote-card" aria-labelledby="vote-statement">
        {point.question ? <p className="vote-question">{point.question}</p> : null}
        <h2 id="vote-statement" className="vote-statement" ref={statementRef} tabIndex={-1}>
          {point.text}
        </h2>
        <p className="vote-typ">
          <TypTag typ={point.typ} />
          <span>{TYP[point.typ].explain}</span>
        </p>
        {point.typ === "T" ? <p className="vote-fact">{FACT_NOTE}</p> : null}

        {!revealed ? (
          <div className="vote-actions" role="group" aria-label="Ihre Antwort">
            <button type="button" className="vote-btn" aria-pressed={given === 1} onClick={() => onAnswer(1)}>
              <AnswerIcon v={1} /> Stimme zu
            </button>
            <button type="button" className="vote-btn" aria-pressed={given === -1} onClick={() => onAnswer(-1)}>
              <AnswerIcon v={-1} /> Lehne ab
            </button>
            <button type="button" className="vote-btn vote-btn-skip" onClick={onSkip}>
              Überspringen
            </button>
          </div>
        ) : (
          <div className="vote-reveal">
            <p className="vote-yours">
              {mine ? <AnswerIcon v={mine} /> : null}
              <span>
                Ihre Antwort: <strong>{mine ? ANSWER_TEXT[mine] : ""}</strong>
              </span>
            </p>
            {a && b && campA && campB ? (
              <>
                <p className="vote-reveal-head">So sehen es die beiden Lager:</p>
                <div className="lk-campvoices vote-voices">
                  <Voices count={a} side="a" name={campA.name} />
                  <Voices count={b} side="b" name={campB.name} />
                </div>
              </>
            ) : null}
            <p className="vote-who">
              {same.length + differ.length === 0 ? (
                "Keine Organisation hat sich dazu geäußert."
              ) : (
                <>
                  {same.length ? (
                    <span>
                      <strong>Wie Sie:</strong> {same.map((o) => o.short).join(", ")}.
                    </span>
                  ) : (
                    <span>
                      <strong>Wie Sie:</strong> keine Organisation.
                    </span>
                  )}{" "}
                  {differ.length ? (
                    <span>
                      <strong>Anders als Sie:</strong> {differ.map((o) => o.short).join(", ")}.
                    </span>
                  ) : null}
                </>
              )}
            </p>
            <p className="vote-diag">
              <DiagLabel diag={point.diag} />
              <span>{d.explain}</span>
            </p>
            <div className="vote-reveal-go">
              <button type="button" ref={nextRef} className="btn btn-primary vote-next" onClick={onAdvance}>
                {last ? "Zum Ergebnis" : "Weiter"}
              </button>
              <a className="small" href={`${base}/punkt/${point.id}`}>
                Mehr zu dieser Frage
              </a>
            </div>
          </div>
        )}
      </section>

      <div className="vote-foot">
        <span className="vote-foot-nav">
          {index > 0 && !revealed ? (
            <button type="button" className="vote-link" onClick={onBack}>
              Vorige Frage
            </button>
          ) : null}
          {answeredCount > 0 && !last ? (
            <button type="button" className="vote-link" onClick={onFinish}>
              Jetzt auswerten ({answeredCount} {answeredCount === 1 ? "Antwort" : "Antworten"})
            </button>
          ) : null}
          <button type="button" className="vote-link" onClick={onOther}>
            Andere Teilentscheidung
          </button>
        </span>
        <span className="vote-keys">
          {revealed ? (
            <>
              Tastatur: <kbd>Eingabe</kbd> oder <kbd>Pfeil rechts</kbd> weiter
            </>
          ) : (
            <>
              Tastatur: <kbd>1</kbd> stimme zu, <kbd>2</kbd> lehne ab, <kbd>3</kbd> überspringen
            </>
          )}
        </span>
      </div>

      <p className="vote-sr" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
