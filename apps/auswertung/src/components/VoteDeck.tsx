"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { BEYOND, DIAG, WHOLE } from "@policy/landkarte";
import type { CampCount } from "@policy/landkarte/data/types";
import type { VoteData, VotePoint, VoteTyp } from "@policy/landkarte/data/vote";

import { ANSWER_TEXT, VoteCard } from "./VoteDeckCard";
import { VoteResult } from "./VoteDeckResult";
import { campCount, type Answer } from "./VoteDeckShared";

type Stage = "start" | "card" | "result";
type Focus = "start" | "statement" | "next" | "result" | null;

interface Saved {
  slug: string;
  stage: Stage;
  index: number;
  answers: Record<string, Answer>;
  revealed: boolean;
}

/**
 * The order of the cards: the three kinds of question spread evenly through
 * the deck (each in map order), so the difference between Tatsache, Wertung
 * and Ausgestaltung shows up again and again instead of in blocks.
 */
export function deckOrder(points: VotePoint[]): VotePoint[] {
  const kinds: VoteTyp[] = ["T", "W", "verfahren"];
  return kinds
    .flatMap((t) => {
      const own = points.filter((p) => p.typ === t).sort((a, b) => a.ord - b.ord);
      return own.map((p, i) => ({ p, key: (i + 0.5) / own.length, k: kinds.indexOf(t) }));
    })
    .sort((a, b) => a.key - b.key || a.k - b.k)
    .map((x) => x.p);
}

/** What a Teilentscheidung covers: the bill's own summary, or what the two catch-all scopes mean. */
function scopeNote(scope: string, description: string | null): string {
  if (description) return `Was der Entwurf hier regelt: ${description}`;
  if (scope === WHOLE) return "Fragen zum Vorhaben insgesamt, nicht zu einer einzelnen Regel.";
  if (scope === BEYOND) return "Forderungen zu Dingen, die der Entwurf nicht regelt.";
  return "";
}

export function VoteDeck({ data, base, initialSlug, fromUrl }: { data: VoteData; base: string; initialSlug: string; fromUrl: boolean }) {
  const [slug, setSlug] = useState(initialSlug);
  const [stage, setStage] = useState<Stage>("start");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [revealed, setRevealed] = useState(false);
  const [restored, setRestored] = useState(false);
  const [announce, setAnnounce] = useState("");
  const focus = useRef<Focus>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLHeadingElement>(null);
  const statementRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const measure = data.measures.find((m) => m.slug === slug) ?? data.measures[0]!;
  const deck = useMemo(() => deckOrder(measure.points), [measure]);
  const point = deck[Math.min(index, deck.length - 1)]!;
  const campA = data.camps.find((c) => c.side === "a");
  const campB = data.camps.find((c) => c.side === "b");
  const storageKey = `abstimmen:${base}`;

  // Restore a run in progress (e.g. after opening a point and coming back). Browser only, never required.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        const m = data.measures.find((x) => x.slug === s.slug);
        if (m && !(fromUrl && s.slug !== initialSlug)) {
          setSlug(s.slug);
          setStage(s.stage);
          setIndex(Math.max(0, Math.min(s.index, m.points.length - 1)));
          setAnswers(s.answers ?? {});
          setRevealed(Boolean(s.revealed));
        }
      }
    } catch {
      /* no storage: start fresh */
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify({ slug, stage, index, answers, revealed } satisfies Saved));
    } catch {
      /* ignore */
    }
  }, [restored, storageKey, slug, stage, index, answers, revealed]);

  // Move focus after a user action (never on first render).
  useEffect(() => {
    const f = focus.current;
    if (!f) return;
    focus.current = null;
    const top = deckRef.current;
    if (f !== "next" && top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
    const el = { start: startRef, statement: statementRef, next: nextRef, result: resultRef }[f].current;
    if (f === "next") {
      el?.closest(".vote-reveal")?.scrollIntoView({ block: "nearest" });
    }
    el?.focus({ preventScroll: f !== "result" });
  });

  const setUrl = (s: string) => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("m", s);
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* ignore */
    }
  };

  const begin = (s = slug) => {
    setSlug(s);
    setAnswers({});
    setIndex(0);
    setRevealed(false);
    setStage("card");
    setAnnounce("");
    setUrl(s);
    focus.current = "statement";
  };

  const advance = () => {
    setAnnounce("");
    if (index + 1 >= deck.length) {
      setStage("result");
      focus.current = "result";
    } else {
      setIndex(index + 1);
      setRevealed(false);
      focus.current = "statement";
    }
  };

  const answer = (v: 1 | -1) => {
    setAnswers((a) => ({ ...a, [point.id]: v }));
    setRevealed(true);
    if (campA && campB) {
      const a = campCount(point, "a", data.orgs, campA.size);
      const b = campCount(point, "b", data.orgs, campB.size);
      const line = (name: string, c: CampCount) =>
        c.agree + c.disagree === 0 ? `${name}: äußert sich nicht.` : `${name}: ${c.agree} von ${c.agree + c.disagree} dafür.`;
      setAnnounce(`${ANSWER_TEXT[v]} ${line(campA.name, a)} ${line(campB.name, b)} ${DIAG[point.diag ?? "offen"].label}.`);
    }
    focus.current = "next";
  };

  const skip = () => {
    setAnswers((a) => ({ ...a, [point.id]: 0 }));
    advance();
  };

  const back = () => {
    if (index === 0) return;
    setIndex(index - 1);
    setRevealed(false);
    setAnnounce("");
    focus.current = "statement";
  };

  const finish = () => {
    setStage("result");
    setRevealed(false);
    focus.current = "result";
  };

  const other = () => {
    setStage("start");
    setAnswers({});
    setIndex(0);
    setRevealed(false);
    focus.current = "start";
  };

  // Shortcuts while a card is open: 1 stimme zu, 2 lehne ab, 3 überspringen; in the reveal, Pfeil rechts = weiter.
  useEffect(() => {
    if (stage !== "card") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!revealed) {
        if (e.key === "1") answer(1);
        else if (e.key === "2") answer(-1);
        else if (e.key === "3") skip();
        else return;
      } else if (e.key === "ArrowRight") {
        advance();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (stage === "start") {
    const chosen = measure;
    return (
      <div className="vote" ref={deckRef}>
        <header className="page-head">
          <p className="crumbs">
            <a href={base}>Lagebild</a> / Wo stehen Sie?
          </p>
          <h1 ref={startRef} tabIndex={-1} className="vote-h1">
            Wo stehen Sie?
          </h1>
          <p className="lead">
            Beantworten Sie die Streitfragen selbst. Danach sehen Sie, welchem Lager und welchen Organisationen Sie am nächsten sind, und
            nebenbei, worüber sich streiten lässt und worüber nicht.
          </p>
        </header>

        <form
          className="vote-start"
          onSubmit={(e) => {
            e.preventDefault();
            begin(chosen.slug);
          }}
        >
          <fieldset className="vote-measures">
            <legend>Zu welcher Teilentscheidung?</legend>
            <p className="vote-hint">Der Entwurf zerfällt in einzelne Maßnahmen, über die getrennt entschieden werden kann. Wählen Sie eine aus.</p>
            {data.measures.map((m) => (
              <label key={m.slug} className={`vote-measure${m.slug === chosen.slug ? " is-on" : ""}`}>
                <input type="radio" name="m" value={m.slug} checked={m.slug === chosen.slug} onChange={() => setSlug(m.slug)} />
                <span className="vote-measure-name">{m.display}</span>
                <span className="vote-measure-n">{m.points.length} Fragen</span>
                {m.slug === chosen.slug ? <span className="vote-measure-desc">{scopeNote(m.scope, m.description)}</span> : null}
              </label>
            ))}
          </fieldset>
          <div className="vote-start-go">
            <button type="submit" className="btn btn-primary vote-go">
              Mit {chosen.points.length} Fragen beginnen
            </button>
            <p className="vote-hint">
              Zu jeder Frage: zustimmen, ablehnen oder überspringen. Danach sehen Sie, wie die Organisationen geantwortet haben
              {campA && campB ? `, getrennt nach den zwei Lagern, die sich in ihren Stellungnahmen zeigen: „${campA.name}“ und „${campB.name}“` : ""}. Ihre
              Antworten verlassen diesen Browser nicht.
            </p>
          </div>
        </form>
      </div>
    );
  }

  if (stage === "result") {
    return (
      <div className="vote" ref={deckRef}>
        <VoteResult
          data={data}
          measure={measure}
          deck={deck}
          answers={answers}
          base={base}
          headingRef={resultRef}
          onAgain={() => begin(measure.slug)}
          onOther={other}
          onBack={() => {
            setStage("card");
            setIndex(Math.max(0, deck.findIndex((p) => !(p.id in answers))));
            setRevealed(false);
            focus.current = "statement";
          }}
          complete={deck.every((p) => p.id in answers)}
        />
      </div>
    );
  }

  return (
    <VoteCard
      data={data}
      measure={measure}
      deck={deck}
      index={index}
      answers={answers}
      revealed={revealed}
      base={base}
      announce={announce}
      deckRef={deckRef}
      statementRef={statementRef}
      nextRef={nextRef}
      onAnswer={answer}
      onSkip={skip}
      onAdvance={advance}
      onBack={back}
      onFinish={finish}
      onOther={other}
    />
  );
}
