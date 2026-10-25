import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublicCampaign } from "@/lib/campaigns";
import { STEPS } from "@/lib/params";

import "../public.css";

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

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
export default async function Einstieg({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const open = c.state === "offen";
  const doors = c.params.doors;
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
    <div className="pub">
      {c.fictional ? (
        <div className="pub-fiction">
          <div className="wrap">Ein Beispiel mit erfundenen Inhalten. Musterstadt gibt es nicht.</div>
        </div>
      ) : null}
      <header className="pub-head wrap">
        <Link href={`/${c.tenant.slug}`} className="pub-town">
          {c.tenant.name}
        </Link>
      </header>

      <main className="wrap pub-main">
        <section className="pub-intro">
          <h1>{c.question}</h1>
          <p className="pub-lead">{c.tenant.name} stellt diese Maßnahme zur Diskussion:</p>
          <blockquote className="pub-measure">{c.measure}</blockquote>
          {c.summary ? <p className="pub-summary">{c.summary}</p> : null}
        </section>

        <aside className="pub-join" aria-labelledby="mitmachen">
          <h2 id="mitmachen">So machst du mit</h2>
          <ul className="pub-how">
            {how.map((h) => (
              <li key={h.title}>
                <strong>{h.title}.</strong> {h.text}
              </li>
            ))}
          </ul>
          {open ? (
            // The voting screens come with milestone 3; until then the open campaign announces them.
            <>
              <p className="pub-when">Die Beteiligung ist eröffnet. Die Abstimmung startet in Kürze.</p>
              <button type="button" className="btn pub-cta" disabled>
                Abstimmen starten
              </button>
            </>
          ) : (
            <>
              <p className="pub-when">
                {start ? `Die Beteiligung beginnt am ${start}.` : "Die Beteiligung beginnt in Kürze."}
                {end ? ` Sie läuft bis spätestens ${end}.` : ""}
              </p>
              <button type="button" className="btn pub-cta" disabled>
                Abstimmen starten
              </button>
            </>
          )}
          <p className="small muted pub-anon">Ohne Anmeldung. Deine Stimmen bleiben anonym.</p>
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

      <footer className="site-foot">
        <div className="wrap small muted">
          Eine Beteiligung mit der <Link href="/">Landkarte des Streits</Link>.
        </div>
      </footer>
    </div>
  );
}
