import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readNotice } from "@/lib/notice";

import { PublicFrame } from "@/components/PublicFrame";
import { lastVotedTyp, myVotes, nextFor, poolFor, ROUND, statementsUnderVote, themaOf, type Statement } from "@/lib/abstimmung";
import { myContributions } from "@/lib/beitraege";
import { getPublicCampaign } from "@/lib/campaigns";
import { QUESTIONS, STEPS, type StepKey } from "@/lib/params";
import { REASONS } from "@/lib/meldungen";
import { getParticipant } from "@/lib/teilnahme";

import { vote } from "../actions";
import { reportFromDeck } from "../melden-actions";
import { Beitraege } from "../Beitraege";
import { FollowPrompt } from "../FollowForm";
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
  else if (q) parts.push(s.richtung === "greift_an" ? `Einwand: ${q.label}` : `Antwort auf den Einwand: ${q.label}`);
  for (const k of ["messdaten", "studie", "vergleichsfall"] as const) {
    const n = s.evidence[k];
    if (n) parts.push(`${n} ${EVIDENCE[k][n === 1 ? 0 : 1]}`);
  }
  return parts.join(" · ");
}

/** The four steps as topics to go on with after a round: plain names, and what each covers. */
const TOPICS: Record<StepKey, { name: string; hint: string }> = {
  lage: { name: "Die Lage", hint: "Wie es heute ist: die Tatsachen, von denen die Stadt ausgeht." },
  wirkung: { name: "Die Wirkung", hint: "Was sich ändert, wenn die Stadt die Maßnahme beschließt." },
  weg: { name: "Der Weg", hint: "Ob der Weg gangbar ist, und ob es anders besser ginge." },
  eingriff: { name: "Der Eingriff", hint: "Ob sich die Last lohnt und den Betroffenen zuzumuten ist." },
};

/** The round travels with every vote: where it began, and the topic, if one was chosen. */
function RoundFields({ ab, thema }: { ab: number; thema: StepKey | null }) {
  return (
    <>
      <input type="hidden" name="ab" value={ab} />
      {thema ? <input type="hidden" name="thema" value={thema} /> : null}
    </>
  );
}

/**
 * Door 1 (Stephan's screen 2): one statement at a time, its label above it
 * — fact or value — three buttons, no answer field. Rounds of ROUND
 * statements, each with a clear end: stop, another round, go on by topic, or
 * write one's own point. When everything is voted, the participant sees
 * their own votes. How the others voted is not shown while the procedure
 * runs (Stephan's paper, step 4: no public interim counts); the published
 * result shows it.
 */
export default async function Abstimmen({
  params,
  searchParams,
}: {
  params: Promise<{ gemeinde: string; verfahren: string }>;
  searchParams: Promise<{ hinweis?: string; hs?: string; ab?: string; thema?: string; wahl?: string }>;
}) {
  const { gemeinde, verfahren } = await params;
  const q = await searchParams;
  const hinweis = readNotice(q.hinweis, q.hs);
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  if (c.state !== "offen") redirect(base);
  const me = await getParticipant(c);
  if (!me && c.params.access === "einladung") redirect(base);

  const statements = await statementsUnderVote(c);
  const voted = me ? await myVotes(c, me.id) : new Map<string, number>();
  const thema = themaOf(q.thema);
  // Where this round began (votes the person had then); a fresh visit starts a fresh round.
  const abRaw = Number(q.ab);
  const ab = q.ab !== undefined && Number.isInteger(abRaw) && abRaw >= 0 ? Math.min(abRaw, voted.size) : voted.size;
  const done = voted.size - ab;
  const openIn = (xs: Statement[]) => xs.filter((s) => !voted.has(s.id)).length;
  const allOpen = openIn(statements);
  const poolOpen = openIn(poolFor(statements, thema));
  const roundOver = done >= ROUND;
  const choosing = roundOver || q.wahl === "1";
  const next = choosing ? null : nextFor(statements, voted, me?.id ?? "neu", me ? await lastVotedTyp(me.id) : null, thema);
  const size = Math.min(ROUND, done + poolOpen);
  const position = done + 1;
  const doors = c.params.doors;
  const these = next?.schritt ? c.steps[next.schritt as keyof typeof c.steps] : null;
  const topics = STEPS.map((x) => ({ key: x.key, ...TOPICS[x.key], open: openIn(statements.filter((s) => s.rolle !== "schluss" && s.schritt === x.key)) })).filter(
    (x) => x.open > 0,
  );
  const more = Math.min(ROUND, allOpen);
  // The person's own points, on the screens between rounds and at the very end.
  const contributions = me && !next ? await myContributions(c, me.id) : [];

  return (
    <PublicFrame town={c.tenant} campaign={c} back>
      <main className="wrap deck">
        {next ? (
          <>
            <div className="deck-top">
              <p className="deck-q">{c.question}</p>
              <p className="deck-count num" aria-label={`Aussage ${position} von ${size} in dieser Runde`}>
                {position} von {size}
              </p>
            </div>
            <div className="deck-progress" aria-hidden>
              <i style={{ width: `${Math.round(((position - 1) / size) * 100)}%` }} />
            </div>
            {thema ? (
              <p className="deck-thema small">
                Thema: {TOPICS[thema].name} ·{" "}
                <Link href={`${base}/abstimmen?wahl=1&thema=${thema}`}>wechseln</Link>
              </p>
            ) : null}
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
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, next.version, 1)}>
                  <RoundFields ab={ab} thema={thema} />
                  <button type="submit" className="vote vote-a">
                    <span aria-hidden className="vote-dot" />
                    Zustimmen
                  </button>
                </form>
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, next.version, -1)}>
                  <RoundFields ab={ab} thema={thema} />
                  <button type="submit" className="vote vote-d">
                    <span aria-hidden className="vote-dot" />
                    Ablehnen
                  </button>
                </form>
                <form action={vote.bind(null, c.tenant.slug, c.slug, next.id, next.version, 0)}>
                  <RoundFields ab={ab} thema={thema} />
                  <button type="submit" className="vote vote-p">
                    Überspringen
                  </button>
                </form>
              </div>
              {next.rolle !== "schluss" ? (
                <details className="card-report">
                  <summary>Hier stimmt etwas nicht</summary>
                  <form action={reportFromDeck.bind(null, c.tenant.slug, c.slug, next.id)} className="report-box">
                    <RoundFields ab={ab} thema={thema} />
                    <fieldset>
                      <legend>Was stimmt an dieser Aussage nicht?</legend>
                      {REASONS.map((r, i) => (
                        <label key={r.key}>
                          <input type="radio" name="grund" value={r.key} defaultChecked={i === 0} /> {r.label}
                        </label>
                      ))}
                    </fieldset>
                    <label className="report-note">
                      Kurz erklären (freiwillig)
                      <textarea name="notiz" maxLength={300} rows={2} />
                    </label>
                    <div className="report-actions">
                      <button type="submit">Melden</button>
                    </div>
                    <p className="small muted">Die Redaktion entscheidet. Bis dahin bleibt die Aussage stehen; Sie können sie überspringen.</p>
                  </form>
                </details>
              ) : null}
            </article>

            <div className="deck-foot">
              {doors.kurzaussage ? (
                <Link href={`${base}/punkt`} className="deck-missing">
                  + Mir fehlt ein Punkt
                </Link>
              ) : null}
              <span className="small muted">
                {next.typ === "W"
                  ? "Bei einer Wertungsfrage gibt es kein Richtig oder Falsch. Es zählt, wie Sie abwägen."
                  : next.typ === "T"
                    ? "Bei einer Tatsachenfrage zählt, was Sie für zutreffend halten. Wissen Sie es nicht, überspringen Sie sie."
                    : "Ein Vorschlag, wie die Maßnahme gestaltet werden könnte."}
              </span>
            </div>
            {voted.size ? <FollowPrompt gemeinde={c.tenant.slug} verfahren={c.slug} /> : null}
          </>
        ) : allOpen > 0 ? (
          <section className="deck-done round-end">
            {roundOver ? (
              <>
                <h1 className="serif">{ab === 0 ? "Danke, das reicht." : `Danke. Sie haben jetzt ${voted.size} Aussagen bewertet.`}</h1>
                <p className="pub-lead">
                  {ab === 0 ? "Ihre Stimmen zählen jetzt voll. " : ""}Sie können hier aufhören oder weitermachen. Jede weitere Stimme hilft, dass
                  keine Aussage untergeht.
                </p>
              </>
            ) : thema && !poolOpen ? (
              <>
                <h1 className="serif">Zum Thema „{TOPICS[thema].name}“ haben Sie alles bewertet.</h1>
                <p className="pub-lead">Sie können ein anderes Thema wählen oder hier aufhören.</p>
              </>
            ) : (
              <h1 className="serif">Wie möchten Sie weitermachen?</h1>
            )}
            {hinweis ? <p className="notice small">{hinweis}</p> : null}
            <div className="deck-done-links">
              <Link href={`${base}/abstimmen`} className="btn">
                Noch {more} {more === 1 ? "Aussage" : "Aussagen"}
              </Link>
              <Link href={base} className="btn btn-quiet">
                Für heute aufhören
              </Link>
            </div>

            {topics.length ? (
              <>
                <h2>Nach Thema weiter</h2>
                <p className="small muted">Sie wählen das Thema. Darin kommt zuerst, was bisher die wenigsten bewertet haben.</p>
                <ul className="round-topics">
                  {topics.map((t) => (
                    <li key={t.key}>
                      <Link href={`${base}/abstimmen?thema=${t.key}`} aria-current={t.key === thema ? "true" : undefined}>
                        <span className="rt-name">{t.name}</span>
                        <span className="rt-n num">noch {t.open}</span>
                        <span className="rt-hint">{t.hint}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {doors.kurzaussage || doors.stellungnahme ? (
              <>
                <h2>Fehlt Ihnen etwas?</h2>
                <div className="deck-done-links">
                  {doors.kurzaussage ? (
                    <Link href={`${base}/punkt`} className="btn btn-quiet">
                      Eigenen Punkt einbringen
                    </Link>
                  ) : null}
                  {doors.stellungnahme ? (
                    <Link href={`${base}/stellungnahme`} className="btn btn-quiet">
                      Stellungnahme einreichen
                    </Link>
                  ) : null}
                </div>
              </>
            ) : null}
            <Beitraege items={contributions} base={base} />
            {voted.size || contributions.length ? <FollowPrompt gemeinde={c.tenant.slug} verfahren={c.slug} open /> : null}
          </section>
        ) : (
          <section className="deck-done">
            <h1 className="serif">Danke. Sie haben zu allen {statements.length} Aussagen abgestimmt.</h1>
            <p className="pub-lead">
              Kommen neue Punkte dazu, können Sie später auch über sie abstimmen. Fehlt Ihnen etwas, schreiben Sie es dazu.
            </p>
            <div className="deck-done-links">
              {doors.kurzaussage ? (
                <Link href={`${base}/punkt`} className="btn">
                  Mir fehlt ein Punkt
                </Link>
              ) : null}
              {doors.stellungnahme ? (
                <Link href={`${base}/stellungnahme`} className="btn btn-quiet">
                  Stellungnahme einreichen
                </Link>
              ) : null}
            </div>
            <FollowPrompt gemeinde={c.tenant.slug} verfahren={c.slug} open />
            <Beitraege items={contributions} base={base} />
            <h2>Ihre Stimmen</h2>
            <p className="small muted">
              Wie die anderen abgestimmt haben, zeigt das Ergebnis. Es erscheint, wenn die Beteiligung abgeschlossen und ausgewertet ist.
            </p>
            <ul className="done-list">
              {statements.map((s) => {
                const v = voted.get(s.id);
                return (
                  <li key={s.id}>
                    <p className="done-text">{s.text}</p>
                    <p className="done-meta">
                      <span className={`mine mine-${v === 1 ? "a" : v === -1 ? "d" : "p"}`}>
                        Ihre Stimme: {v === 1 ? "Zustimmung" : v === -1 ? "Ablehnung" : "übersprungen"}
                      </span>
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
