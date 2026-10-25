import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { myVotes, participation } from "@/lib/abstimmung";
import { getPublicCampaign } from "@/lib/campaigns";
import { STEPS } from "@/lib/params";
import { getParticipant } from "@/lib/teilnahme";

import { CodeForm } from "./DoorForms";
import "../public.css";

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
 * addressed with "du" as in his draft; no account, ever.
 */
export default async function Einstieg({
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
  const open = c.state === "offen";
  const closed = c.state === "auswertung" || c.state === "bericht" || c.state === "veroeffentlicht";
  const doors = c.params.doors;
  const base = `/${c.tenant.slug}/${c.slug}`;
  const [stats, me] = await Promise.all([participation(c), open ? getParticipant(c) : null]);
  const mine = me ? (await myVotes(c, me.id)).size : 0;
  const needsCode = open && c.params.access === "einladung" && !me;
  // A start date already past on a campaign that is not open yet says nothing useful.
  const upcoming = c.params.start && new Date(c.params.start) > new Date() ? new Date(c.params.start) : null;
  const start = upcoming ? day.format(upcoming) : null;
  const end = c.params.end ? day.format(new Date(c.params.end)) : null;

  const how = [
    doors.abstimmen ? { title: "Abstimmen", text: "Du siehst kurze Aussagen und sagst zu jeder: stimme zu, lehne ab oder überspringe." } : null,
    doors.kurzaussage ? { title: "Eigenen Punkt einbringen", text: "Wenn dir ein Punkt fehlt, schreibst du ihn in zwei Sätzen dazu." } : null,
    doors.stellungnahme ? { title: "Stellungnahme einreichen", text: "Für längere Schreiben, etwa von Vereinen, Betrieben oder Fachleuten." } : null,
  ].filter((x): x is { title: string; text: string } => x !== null);

  return (
    <PublicFrame town={c.tenant} fictional={c.fictional}>
      <main className="wrap pub-main">
        <section className="pub-intro">
          <h1>{c.question}</h1>
          <p className="pub-lead">
            {c.tenant.name} stellt diese Maßnahme zur Diskussion.
            {open && stats.statements
              ? ` ${n(stats.statements)} Punkte liegen auf dem Tisch${stats.voters ? `, ${n(stats.voters)} ${stats.voters === 1 ? "Mensch hat" : "Menschen haben"} schon abgestimmt` : ""}.`
              : ""}
          </p>
          <blockquote className="pub-measure">{c.measure}</blockquote>
          {c.summary ? <p className="pub-summary">{c.summary}</p> : null}
        </section>

        <aside className="pub-join" aria-labelledby="mitmachen">
          <h2 id="mitmachen">{closed ? (c.state === "veroeffentlicht" ? "Das Ergebnis" : "Die Beteiligung ist geschlossen") : "So machst du mit"}</h2>
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
              <p className="pub-when">Die Beteiligung ist abgeschlossen. Ergebnis und Bericht sind öffentlich.</p>
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
          ) : needsCode ? (
            <CodeForm gemeinde={c.tenant.slug} verfahren={c.slug} />
          ) : (
            <>
              {end ? <p className="pub-when">Die Beteiligung läuft bis {end}.</p> : null}
              <Link href={`${base}/abstimmen`} className="btn pub-cta">
                {mine ? `Weiter abstimmen (${mine} von ${stats.statements})` : "Abstimmen starten"}
              </Link>
              <div className="pub-doors">
                {doors.kurzaussage ? <Link href={`${base}/punkt`}>Eigenen Punkt einbringen</Link> : null}
                {doors.stellungnahme ? <Link href={`${base}/stellungnahme`}>Stellungnahme hochladen</Link> : null}
              </div>
            </>
          )}
          {c.state === "veroeffentlicht" ? null : <p className="small muted pub-anon">Ohne Anmeldung. Deine Stimmen bleiben anonym.</p>}
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
