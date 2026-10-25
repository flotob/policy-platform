import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { lastVotedTyp, myVotes, nextFor, statementsUnderVote, type Statement } from "@/lib/abstimmung";
import { getPublicCampaign } from "@/lib/campaigns";
import { QUESTIONS, STEPS } from "@/lib/params";
import { getParticipant } from "@/lib/teilnahme";

import { vote } from "../actions";
import "../../public.css";
import "../tueren.css";

export const metadata = { title: "Abstimmen" };

const TYP_LABEL = { T: "Tatsachenfrage", W: "Wertungsfrage", verfahren: "Ausgestaltung" } as const;
const EVIDENCE = { messdaten: ["Beleg mit Messdaten", "Belege mit Messdaten"], studie: ["Studie", "Studien"], vergleichsfall: ["Vergleichsfall", "Vergleichsfälle"] } as const;

/** One line under the statement: which question of the justification it answers, and what evidence stands behind it. */
function context(s: Statement): string {
  if (s.rolle === "schluss") return "Die Maßnahme selbst";
  const parts: string[] = [];
  const q = QUESTIONS.find((x) => x.key === s.frage);
  const step = STEPS.find((x) => x.key === s.schritt);
  if (s.rolle === "praemisse") parts.push(`Aus der Begründung der Stadt: ${step?.label ?? ""}`);
  else if (q) parts.push(`Prüffrage: ${q.label}`);
  for (const k of ["messdaten", "studie", "vergleichsfall"] as const) {
    const n = s.evidence[k];
    if (n) parts.push(`${n} ${EVIDENCE[k][n === 1 ? 0 : 1]}`);
  }
  return parts.join(" · ");
}

function Bar({ s }: { s: Statement }) {
  const total = s.agree + s.disagree + s.pass;
  if (!total) return <span className="small muted">Noch keine Stimmen</span>;
  const pct = (x: number) => `${Math.round((x / total) * 100)}%`;
  return (
    <span className="tally">
      <span className="tally-bar" aria-hidden>
        <i className="a" style={{ width: pct(s.agree) }} />
        <i className="p" style={{ width: pct(s.pass) }} />
        <i className="d" style={{ width: pct(s.disagree) }} />
      </span>
      <span className="small muted num">
        {s.agree} dafür · {s.disagree} dagegen{s.pass ? ` · ${s.pass} übersprungen` : ""}
      </span>
    </span>
  );
}

/**
 * Door 1 (Stephan's screen 2): one statement at a time, its label above it
 * — fact or value — three buttons, no answer field. When everything is
 * voted, the participant sees how the others voted (only then: no anchoring).
 */
export default async function Abstimmen({
  params,
  searchParams,
}: {
  params: Promise<{ gemeinde: string; verfahren: string }>;
  searchParams: Promise<{ hinweis?: string }>;
}) {
  const { gemeinde, verfahren } = await params;
  const { hinweis } = await searchParams;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  if (c.state !== "offen") redirect(base);
  const me = await getParticipant(c);
  if (!me && c.params.access === "einladung") redirect(base);

  const statements = await statementsUnderVote(c);
  const voted = me ? await myVotes(c, me.id) : new Map<string, number>();
  const next = nextFor(statements, voted, me?.id ?? "neu", me ? await lastVotedTyp(me.id) : null);
  const position = voted.size + 1;
  const doors = c.params.doors;
  const these = next?.schritt ? c.steps[next.schritt as keyof typeof c.steps] : null;

  return (
    <PublicFrame town={c.tenant} campaign={c} back>
      <main className="wrap deck">
        {next ? (
          <>
            <div className="deck-top">
              <p className="deck-q">{c.question}</p>
              <p className="deck-count num" aria-label={`Aussage ${position} von ${statements.length}`}>
                {position} von {statements.length}
              </p>
            </div>
            <div className="deck-progress" aria-hidden>
              <i style={{ width: `${Math.round(((position - 1) / statements.length) * 100)}%` }} />
            </div>
            {hinweis ? <p className="notice small">{hinweis}</p> : null}

            <article className={`card card-${next.typ}`} aria-labelledby="aussage">
              <p className="card-typ">{TYP_LABEL[next.typ]}</p>
              <h1 id="aussage" className="card-text">
                {next.text}
              </h1>
              <p className="card-ctx">{context(next)}</p>
              {these ? (
                <details className="card-more">
                  <summary>Worum geht es?</summary>
                  <p>
                    <span>Die Stadt sagt:</span> {these}
                  </p>
                </details>
              ) : null}
              <div className="card-buttons">
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, 1)}>
                  <button type="submit" className="vote vote-a">
                    <span aria-hidden className="vote-dot" />
                    Stimme zu
                  </button>
                </form>
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, -1)}>
                  <button type="submit" className="vote vote-d">
                    <span aria-hidden className="vote-dot" />
                    Lehne ab
                  </button>
                </form>
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, 0)}>
                  <button type="submit" className="vote vote-p">
                    Überspringen
                  </button>
                </form>
              </div>
            </article>

            <div className="deck-foot">
              {doors.kurzaussage ? (
                <Link href={`${base}/punkt`} className="deck-missing">
                  + Mir fehlt ein Punkt
                </Link>
              ) : null}
              <span className="small muted">
                {next.typ === "W"
                  ? "Bei einer Wertungsfrage gibt es kein Richtig oder Falsch. Es zählt, wie du abwägst."
                  : next.typ === "T"
                    ? "Bei einer Tatsachenfrage zählt, was du für zutreffend hältst. Weißt du es nicht, überspring sie."
                    : "Ein Vorschlag, wie die Maßnahme gestaltet werden könnte."}
              </span>
            </div>
          </>
        ) : (
          <section className="deck-done">
            <h1 className="serif">Danke. Du hast zu allen {statements.length} Aussagen abgestimmt.</h1>
            <p className="pub-lead">
              Kommen neue Punkte dazu, kannst du später auch über sie abstimmen. Fehlt dir etwas, schreib es dazu.
            </p>
            <div className="deck-done-links">
              {doors.kurzaussage ? (
                <Link href={`${base}/punkt`} className="btn">
                  Mir fehlt ein Punkt
                </Link>
              ) : null}
              {doors.stellungnahme ? (
                <Link href={`${base}/stellungnahme`} className="btn btn-quiet">
                  Stellungnahme hochladen
                </Link>
              ) : null}
            </div>
            <h2>So haben die anderen bisher abgestimmt</h2>
            <ul className="done-list">
              {statements.map((s) => {
                const v = voted.get(s.id);
                return (
                  <li key={s.id}>
                    <p className="done-text">{s.text}</p>
                    <p className="done-meta">
                      <span className={`mine mine-${v === 1 ? "a" : v === -1 ? "d" : "p"}`}>
                        Du: {v === 1 ? "stimmst zu" : v === -1 ? "lehnst ab" : "übersprungen"}
                      </span>
                      <Bar s={s} />
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </PublicFrame>
  );
}
