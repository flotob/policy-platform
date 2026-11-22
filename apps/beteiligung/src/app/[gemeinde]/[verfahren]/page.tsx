import Link from "next/link";
import { notFound } from "next/navigation";
import { readNotice } from "@/lib/notice";

import { PublicFrame } from "@/components/PublicFrame";
import { myVotes, participation, ROUND } from "@/lib/abstimmung";
import { publicDecision } from "@/lib/beschluss";
import { decisionHead } from "@/lib/beschluss-words";
import { getPublicCampaign, inviteCounts } from "@/lib/campaigns";
import { STEPS } from "@/lib/params";
import { getParticipant } from "@/lib/teilnahme";

import { CodeForm } from "./DoorForms";
import { FollowForm, FollowPrompt } from "./FollowForm";
import "../public.css";
// The code form (letters, invitations) is a door form: its box and the code field are styled there.
import "./tueren.css";

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const n = (x: number) => x.toLocaleString("de-DE");

export async function generateMetadata({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  return c ? { title: `${c.title}, ${c.tenant.name}`, description: c.question } : { title: "Verfahren nicht gefunden" };
}

/**
 * The entry screen of a campaign (Stephan's Teilnehmeransicht, screen 1):
 * the question, what the town proposes, how to take part. Citizens are
 * addressed with "Sie" (Florian, 2026-11-22: one form on every citizen page; his draft had "du"); no account, ever.
 */
export default async function Einstieg({
  params,
  searchParams,
}: {
  params: Promise<{ gemeinde: string; verfahren: string }>;
  searchParams: Promise<{ hinweis?: string; hs?: string; code?: string }>;
}) {
  const { gemeinde, verfahren } = await params;
  const q = await searchParams;
  const hinweis = readNotice(q.hinweis, q.hs);
  const code = q.code;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const open = c.state === "offen";
  const closed = c.state === "auswertung" || c.state === "bericht" || c.state === "veroeffentlicht";
  const doors = c.params.doors;
  const base = `/${c.tenant.slug}/${c.slug}`;
  const [stats, me, decision, codes] = await Promise.all([
    participation(c),
    open ? getParticipant(c) : null,
    c.state === "veroeffentlicht" ? publicDecision(c.id) : null,
    open ? inviteCounts(c.id) : null,
  ]);
  // A QR code on a letter to residents drawn by lot carries the code (?code=…).
  const letterCode = open && code ? code.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) : "";
  const mine = me ? (await myVotes(c, me.id)).size : 0;
  const needsCode = open && c.params.access === "einladung" && !me;
  // What the machine does, on the first screen (Stephan: "Dass eine KI mitarbeitet, steht auf dem ersten Bildschirm").
  const machine =
    c.params.editorialMode === "ki"
      ? "Ein Sprachmodell liest jeden Beitrag und sortiert ihn ein. Über neue Punkte entscheidet es selbst; die Redaktion der Stadt prüft Stichproben. Bewerten tut es nichts: Wertungsfragen entscheiden Menschen."
      : "Ein Sprachmodell liest jeden Beitrag und schlägt vor, wohin er gehört. Was zur Abstimmung kommt, entscheidet ein Mensch aus der Redaktion der Stadt. Wertungsfragen entscheidet die Maschine nie.";
  // A start date already past on a campaign that is not open yet says nothing useful.
  const upcoming = c.params.start && new Date(c.params.start) > new Date() ? new Date(c.params.start) : null;
  const start = upcoming ? day.format(upcoming) : null;
  const end = c.params.end ? day.format(new Date(c.params.end)) : null;

  const how = [
    doors.abstimmen
      ? {
          title: "Abstimmen",
          text: `Sie sehen kurze Aussagen und sagen zu jeder: zustimmen, ablehnen oder überspringen. Eine Runde hat ${ROUND} Aussagen; danach können Sie aufhören oder weitermachen.`,
        }
      : null,
    doors.kurzaussage ? { title: "Eigenen Punkt einbringen", text: "Wenn Ihnen ein Punkt fehlt, schreiben Sie ihn in zwei Sätzen dazu." } : null,
    doors.stellungnahme ? { title: "Stellungnahme einreichen", text: "Für längere Schreiben, etwa von Vereinen, Betrieben oder Fachleuten." } : null,
  ].filter((x): x is { title: string; text: string } => x !== null);

  return (
    <PublicFrame town={c.tenant}>
      <main className="wrap pub-main">
        {c.preview ? (
          <p className="notice pub-preview">
            Vorschau für Ihr Team: Öffentlich sichtbar wird diese Seite, sobald jemand aus Ihrem Team die E-Mail-Adresse bestätigt hat.
          </p>
        ) : null}
        <section className="pub-intro">
          <h1>{c.question}</h1>
          <p className="pub-lead">
            {c.tenant.name} stellt diese Maßnahme zur Diskussion.
            {open && stats.statements
              ? ` ${n(stats.statements)} Punkte liegen auf dem Tisch${stats.voters ? `, ${n(stats.voters)} ${stats.voters === 1 ? "Mensch hat" : "Menschen haben"} schon abgestimmt${stats.simulated ? `, davon ${n(stats.simulated)} simuliert` : ""}` : ""}.`
              : ""}
          </p>
          <blockquote className="pub-measure">{c.measure}</blockquote>
          {c.summary ? <p className="pub-summary">{c.summary}</p> : null}
          <p className="pub-machine">
            <strong>Eine Maschine liest mit, ein Mensch gibt frei.</strong> {machine}
          </p>
        </section>

        <aside className="pub-join" aria-labelledby="mitmachen">
          <h2 id="mitmachen">{closed ? (c.state === "veroeffentlicht" ? "Das Ergebnis" : "Die Beteiligung ist geschlossen") : "So machen Sie mit"}</h2>
          {closed ? null : (
            <ul className="pub-how">
              {how.map((h) => (
                <li key={h.title}>
                  <strong>{h.title}.</strong> {h.text}
                </li>
              ))}
            </ul>
          )}
          {hinweis ? <p className="notice small pub-hint">{hinweis}</p> : null}
          {c.state === "veroeffentlicht" ? (
            <>
              {decision ? (
                <div className="pub-decision">
                  <p className="pub-decision-head">{decisionHead(decision)}</p>
                  {decision.summary ? <p>{decision.summary}</p> : null}
                  <p className="small muted">Bei jeder Aussage steht im Ergebnis, was aus ihr geworden ist.</p>
                </div>
              ) : (
                <p className="pub-when">Die Beteiligung ist abgeschlossen. Ergebnis und Bericht sind öffentlich. Der Gemeinderat berät darüber.</p>
              )}
              <Link href={`${base}/ergebnis`} className="btn pub-cta">
                Ergebnis ansehen
              </Link>
              <div className="pub-doors">
                <Link href={`${base}/bericht`}>Bericht lesen</Link>
              </div>
            </>
          ) : !open ? (
            <>
              <p className="pub-when">
                {c.state === "vorbereitung"
                  ? `${start ? `Die Beteiligung beginnt am ${start}.` : "Die Beteiligung beginnt in Kürze."}${end ? ` Sie läuft bis spätestens ${end}.` : ""}`
                  : "Die Beteiligung ist geschlossen. Die Auswertung folgt; danach stehen hier Ergebnis und Bericht."}
              </p>
              <button type="button" className="btn pub-cta" disabled>
                Abstimmen starten
              </button>
            </>
          ) : needsCode || (letterCode && !me) ? (
            <CodeForm gemeinde={c.tenant.slug} verfahren={c.slug} code={letterCode} drawn={!!letterCode} />
          ) : (
            <>
              {end ? <p className="pub-when">Die Beteiligung läuft bis {end}.</p> : null}
              <Link href={`${base}/abstimmen`} className="btn pub-cta">
                {mine ? "Weiter abstimmen" : "Abstimmen starten"}
              </Link>
              <div className="pub-doors">
                {doors.kurzaussage ? <Link href={`${base}/punkt`}>Eigenen Punkt einbringen</Link> : null}
                {doors.stellungnahme ? <Link href={`${base}/stellungnahme`}>Stellungnahme einreichen</Link> : null}
              </div>
            </>
          )}
          {open && mine ? (
            <FollowPrompt gemeinde={c.tenant.slug} verfahren={c.slug} />
          ) : c.state === "auswertung" || c.state === "bericht" || (c.state === "veroeffentlicht" && !decision) ? (
            <FollowForm gemeinde={c.tenant.slug} verfahren={c.slug} after={c.state === "veroeffentlicht" ? "decision" : "result"} />
          ) : null}
          {open && !needsCode && !letterCode && !me && codes?.drawn ? (
            <details className="pub-letter">
              <summary>Sie haben einen Brief mit Code bekommen?</summary>
              <CodeForm gemeinde={c.tenant.slug} verfahren={c.slug} drawn />
            </details>
          ) : null}
        </aside>

        {STEPS.some((s) => c.steps[s.key]) ? (
          <section className="pub-why" aria-labelledby="begruendung">
            <h2 id="begruendung">So begründet {c.tenant.name} die Maßnahme</h2>
            <p className="muted">
              Jeder Beitrag aus der Beteiligung stützt einen dieser vier Schritte oder greift ihn an. Am Ende sieht man, welcher Schritt hält und an
              welchem der Streit hängt.
            </p>
            <ol className="pub-steps">
              {STEPS.map((s) =>
                c.steps[s.key] ? (
                  <li key={s.key}>
                    <h3>{s.label}</h3>
                    <p>{c.steps[s.key]}</p>
                  </li>
                ) : null,
              )}
            </ol>
          </section>
        ) : null}
      </main>
    </PublicFrame>
  );
}
