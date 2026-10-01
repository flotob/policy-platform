"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { DIAG, DIAG_ORDER, DiagLabel, displayScope, shortOrg, slugOf } from "@policy/landkarte";
import type { AskCitedArgument, AskCitedPoint, AskFocus, AskResponse } from "@policy/landkarte/data/ask";

import { cited, KEYS, sentencesOf, uncitedSentences } from "@/components/AskBoxText";
import { Row } from "@/components/rows";

type Answer = Extract<AskResponse, { ok: true }>;
type State =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "done"; res: Answer }
  | { status: "error"; question: string; error: string };

const MAX = 400;

const FOCUS_LABEL: Record<AskFocus, string> = {
  bruecke: "Brücken (beide Lager stimmen zu)",
  warnung: "Scheinbrücken",
  klaerbar: "Tatsachenfragen",
  wert: "Wertfragen und Kernkonflikte",
  gestaltung: "Streit um die Ausgestaltung",
  luecke: "Lücken",
};

/** "Frag die Landkarte": question form, waiting state, answer with citation links, and the source list. */
export function AskBox({ base, examples, howItWorks }: { base: string; examples: string[]; howItWorks: ReactNode }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  const result = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function ask(q: string) {
    const text = q.replace(/\s+/g, " ").trim();
    if (text.length < 3) {
      setState({ status: "error", question: text, error: "Bitte schreiben Sie eine Frage in das Feld." });
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ status: "loading", question: text });
    try {
      const r = await fetch(`${base}/fragen/antwort`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: ctrl.signal,
      });
      let body: AskResponse | null = null;
      try {
        body = (await r.json()) as AskResponse;
      } catch {
        body = null;
      }
      if (ctrl.signal.aborted) return;
      if (!body) {
        setState({ status: "error", question: text, error: `Der Server hat keine lesbare Antwort geschickt (Status ${r.status}). Bitte stellen Sie die Frage noch einmal.` });
      } else if (!body.ok) {
        setState({ status: "error", question: text, error: body.error });
      } else {
        setState({ status: "done", res: body });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState({ status: "error", question: text, error: "Die Verbindung zum Server ist abgebrochen. Bitte stellen Sie die Frage noch einmal." });
    }
  }

  // When the answer arrives: focus it for screen readers, and bring it into view if it starts below the fold.
  useEffect(() => {
    const el = result.current;
    if (!el || (state.status !== "done" && state.status !== "error")) return;
    el.focus({ preventScroll: true });
    if (el.getBoundingClientRect().top > window.innerHeight * 0.6) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  }, [state.status]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(question);
    }
  };
  const loading = state.status === "loading";

  return (
    <>
      <Row margin={howItWorks}>
        <form className="ask-form" onSubmit={onSubmit}>
          <label htmlFor="ask-q" className="ask-label">
            Ihre Frage
          </label>
          <textarea
            id="ask-q"
            className="ask-input"
            rows={3}
            maxLength={MAX}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKey}
            placeholder="Zum Beispiel: Was sagen die Organisationen zu den Fristen für die Wärmepläne?"
          />
          <div className="ask-actions">
            <button type="submit" className="btn btn-primary" disabled={loading || question.trim().length < 3}>
              Frage stellen
            </button>
            <span className="small muted">Oder mit der Eingabetaste abschicken.</span>
          </div>
        </form>
        <div className="ask-examples">
          <p className="small muted">Oder eine dieser Fragen:</p>
          <ul>
            {examples.map((x) => (
              <li key={x}>
                <button
                  type="button"
                  className="ask-example"
                  disabled={loading}
                  onClick={() => {
                    setQuestion(x);
                    void ask(x);
                  }}
                >
                  {x}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Row>

      <div className="ask-result" aria-live="polite" aria-busy={loading} ref={result} tabIndex={-1}>
        {state.status === "loading" ? (
          <div className="ask-wait">
            <p className="ask-asked">„{state.question}“</p>
            <p className="ask-wait-line">
              <span className="ask-pulse" aria-hidden />
              Die Landkarte wird durchsucht …
            </p>
            <p className="small muted">Danach formuliert ein Sprachmodell die Antwort aus den Fundstellen. Das dauert meist 15 bis 40 Sekunden.</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="ask-error" role="alert">
            {state.question ? <p className="ask-asked">„{state.question}“</p> : null}
            <p>{state.error}</p>
            {state.question.length >= 3 ? (
              <button type="button" className="btn" onClick={() => void ask(state.question)}>
                Noch einmal versuchen
              </button>
            ) : null}
          </div>
        ) : null}

        {state.status === "done" ? <AnswerView res={state.res} base={base} /> : null}
      </div>
    </>
  );
}

function AnswerView({ res, base }: { res: Answer; base: string }) {
  const points = new Map(res.points.map((p) => [p.key, p]));
  const args = new Map(res.arguments.map((a) => [a.key, a]));
  const s = res.searched;
  const uncited = res.nothing ? 0 : uncitedSentences(res.answer).length;
  const usedFound = res.citations.filter((k) => k !== "L0").length;
  return (
    <section className="ask-answer-block" aria-label="Antwort">
      <h2>Antwort</h2>
      <Row
        margin={
          <>
            <p>
              Zur Frage passen {s.foundPoints} {s.foundPoints === 1 ? "Streitfrage" : "Streitfragen"} und {s.foundArguments}{" "}
              {s.foundArguments === 1 ? "Argument" : "Argumente"}.
              {res.nothing
                ? ""
                : usedFound
                  ? ` Die Antwort stützt sich auf ${usedFound} davon.`
                  : " Die Antwort stützt sich auf die Zahlen der ganzen Landkarte."}
            </p>
            {s.orgs.length ? (
              <p>
                {s.orgs.length === 1 ? "Erkannte Organisation: " : "Erkannte Organisationen: "}
                {s.orgs.map((o, i) => (
                  <Fragment key={o.submissionId}>
                    {i ? ", " : ""}
                    <a href={`${base}/organisationen/${o.submissionId}`}>{shortOrg(o.name)}</a>
                  </Fragment>
                ))}
              </p>
            ) : null}
            {s.focus.length ? <p>Gesucht nach: {s.focus.map((f) => FOCUS_LABEL[f]).join(", ")}</p> : null}
            {s.focus.includes("klaerbar") ? (
              <p>
                <a href={`${base}/gutachten`}>Alle Tatsachenfragen in der Gutachten-Agenda</a>
              </p>
            ) : null}
            {uncited ? (
              <p>
                {uncited === 1 ? "Ein Satz nennt" : `${uncited} Sätze nennen`} keine Quelle und {uncited === 1 ? "ist" : "sind"} grau gesetzt. Prüfen Sie
                {uncited === 1 ? " ihn" : " sie"} an den Quellen der Nachbarsätze.
              </p>
            ) : null}
            {res.dropped.length ? (
              <p>
                {res.dropped.length === 1
                  ? "Ein Verweis des Sprachmodells passte zu keiner Fundstelle und wurde entfernt."
                  : `${res.dropped.length} Verweise des Sprachmodells passten zu keiner Fundstelle und wurden entfernt.`}
              </p>
            ) : null}
          </>
        }
      >
        <p className="ask-asked">„{res.question}“</p>
        {res.nothing ? (
          <div className="ask-nothing">
            <p className="prose">{res.answer}</p>
            <p className="small muted">
              {s.foundPoints + s.foundArguments > 0
                ? "Die gefundenen Stellen beantworten die Frage nicht. "
                : "Die Suche hat keine passende Streitfrage und kein passendes Argument gefunden. "}
              Versuchen Sie es mit anderen Worten, mit dem Namen einer Maßnahme oder einer Organisation.
            </p>
          </div>
        ) : (
          <div className="ask-answer prose">
            {res.answer.split(/\n\s*\n/).map((para, i) => (
              <p key={i}>
                {sentencesOf(para).map((sen, j) => (
                  <Fragment key={j}>
                    {j ? " " : ""}
                    {cited(sen) ? (
                      withCitations(sen, points, args, base)
                    ) : (
                      <span className="ask-uncited" title="Dieser Satz nennt keine Quelle.">
                        {sen}
                      </span>
                    )}
                  </Fragment>
                ))}
              </p>
            ))}
          </div>
        )}
      </Row>

      {!res.nothing && res.citations.length ? (
        <>
          <h2>Quellen</h2>
          <p className="small muted ask-sources-intro">
            L steht für eine Streitfrage auf der Landkarte, A für ein Argument mit dem wörtlichen Zitat aus einer Stellungnahme.
          </p>
          <ol className="ask-sources">
            {res.citations.map((k) => {
              if (k === "L0") return <WholeSource key={k} res={res} base={base} />;
              const p = points.get(k);
              if (p) return <PointSource key={k} p={p} base={base} />;
              const a = args.get(k);
              if (a) return <ArgumentSource key={k} a={a} base={base} pointCited={a.mapPointKey != null && points.has(a.mapPointKey)} />;
              return null;
            })}
          </ol>
        </>
      ) : null}
    </section>
  );
}

function withCitations(text: string, points: Map<string, AskCitedPoint>, args: Map<string, AskCitedArgument>, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(KEYS)) {
    const at = m.index ?? 0;
    // Drop the space before the bracket; the citation sits on the sentence like a footnote mark.
    out.push(text.slice(last, at).replace(/\s+$/, ""));
    const keys = m[1]!.split(/\s*[,;]\s*/);
    out.push(
      <span className="ask-cites" key={`c${at}`}>
        {keys.map((k) => {
          const p = points.get(k);
          const a = args.get(k);
          if (k === "L0") {
            return (
              <a key={k} className="ask-cite" href={`#ask-src-L0`} title="Die ganze Landkarte: Zahlen und Lager">
                {k}
              </a>
            );
          }
          if (p) {
            const d = DIAG[p.diag ?? "offen"];
            return (
              <a key={k} className={`ask-cite ask-cite-l lk-tone-${d.tone}`} href={`${base}/punkt/${p.id}`} title={`Streitfrage: ${p.text}`}>
                {k}
              </a>
            );
          }
          if (a) {
            const orgs = [...new Set(a.sources.map((x) => shortOrg(x.org)))].join(", ");
            return (
              <a key={k} className="ask-cite" href={`#ask-src-${k}`} title={`${orgs}: ${a.label}`}>
                {k}
              </a>
            );
          }
          return null;
        })}
      </span>,
    );
    last = at + m[0].length;
  }
  out.push(text.slice(last));
  return out.map((x, i) => (typeof x === "string" ? <Fragment key={`t${i}`}>{x}</Fragment> : x));
}

function WholeSource({ res, base }: { res: Answer; base: string }) {
  const w = res.whole;
  const parts = DIAG_ORDER.filter((d) => d !== "luecke" && w.byDiag[d]).map((d) => `${DIAG[d].label}: ${w.byDiag[d]}`);
  return (
    <li id="ask-src-L0" className="ask-source">
      <span className="ask-key">L0</span>
      <div className="ask-source-body">
        <p className="ask-source-title">
          <a href={base}>Die ganze Landkarte</a>
        </p>
        <p className="small">
          {w.mapPoints} Streitfragen. {parts.join(", ")}.
          {w.byDiag.luecke ? ` Dazu ${w.byDiag.luecke} ${w.byDiag.luecke === 1 ? "Lücke" : "Lücken"}: kritische Fragen, die niemand gestellt hat.` : ""}
        </p>
        {w.camps.map((c) => (
          <p key={c.name} className="small muted">
            Lager „{c.name}“: {c.orgs.map(shortOrg).join(", ")}
          </p>
        ))}
        {w.orgs.map((o) => (
          <p key={o.name} className="small">
            {shortOrg(o.name)}: {o.total} Argumente in der Stellungnahme
            {o.onTopic != null
              ? `, ${o.onTopic === 0 ? "keines" : o.onTopic} davon mit ${w.words.length === 1 ? "dem Stichwort" : "den Stichworten"} ${w.words.map((x) => `„${x}“`).join(", ")}`
              : ""}
            .
          </p>
        ))}
      </div>
    </li>
  );
}

function PointSource({ p, base }: { p: AskCitedPoint; base: string }) {
  return (
    <li id={`ask-src-${p.key}`} className="ask-source">
      <span className="ask-key">{p.key}</span>
      <div className="ask-source-body">
        <p className="ask-source-meta">
          <DiagLabel diag={p.diag} />
          <span className="small muted">
            Streitfrage zu <a href={`${base}/massnahmen/${slugOf(p.scope)}`}>{displayScope(p.scope)}</a>
          </span>
        </p>
        {p.question ? <p className="small muted ask-source-question">{p.question}</p> : null}
        <p className="ask-source-title">
          <a href={`${base}/punkt/${p.id}`}>{p.text}</a>
        </p>
      </div>
    </li>
  );
}

function ArgumentSource({ a, base, pointCited }: { a: AskCitedArgument; base: string; pointCited: boolean }) {
  const seen = new Set<string>();
  const quotes = a.sources.filter((s) => {
    const k = `${s.submissionId}|${s.quote ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <li id={`ask-src-${a.key}`} className="ask-source">
      <span className="ask-key">{a.key}</span>
      <div className="ask-source-body">
        <p className="ask-source-title ask-source-arg">{a.label}</p>
        {quotes.map((s, i) =>
          s.quote ? (
            <blockquote key={i} className="lk-quote">
              <p>„{s.quote.replace(/\s+/g, " ")}“</p>
              <footer>
                <a href={`${base}/organisationen/${s.submissionId}`}>{s.org}</a>
              </footer>
            </blockquote>
          ) : (
            <p key={i} className="small">
              <a href={`${base}/organisationen/${s.submissionId}`}>{s.org}</a>
            </p>
          ),
        )}
        <p className="small muted">
          {a.mapPointId ? (
            <>
              Gehört zur Streitfrage <a href={`${base}/punkt/${a.mapPointId}`}>{a.mapPointLabel ?? "auf der Landkarte"}</a>
              {pointCited ? (
                <>
                  {" ("}
                  <a href={`#ask-src-${a.mapPointKey}`}>{a.mapPointKey}</a>
                  {")"}
                </>
              ) : null}
            </>
          ) : (
            "Einzelforderung: keiner Streitfrage auf der Landkarte zugeordnet."
          )}
        </p>
      </div>
    </li>
  );
}
