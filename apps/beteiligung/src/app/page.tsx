import Link from "next/link";

import { OpinionSpace, type DemoStatement } from "@/components/OpinionSpace";
import { SiteHeader } from "@/components/SiteHeader";

import "./landing.css";

/** Stephan's fictional Musterstadt example (camp values from his results page). */
const DEMO: DemoStatement[] = [
  {
    id: 14,
    text: "Mehrkosten von 1,5 bis 2 Prozent der Bausumme sind Bauherren zumutbar.",
    a: 72,
    b: 18,
    kind: "streit",
    reading: "Eine Wertfrage, und an ihr hängt der ganze Streit. Kein Gutachten kann sie beantworten. Sie gehört in den Rat, ausdrücklich als Wertentscheidung.",
  },
  {
    id: 4,
    text: "Der Fachkräftemangel gefährdet die Umsetzung.",
    a: 81,
    b: 77,
    kind: "bruecke",
    reading: "Beide Lager teilen die Sorge, und aus demselben Grund. Darauf lässt sich ein Beschluss bauen, der in beiden Lagern trägt.",
  },
  {
    id: 17,
    text: "Übergangsfristen sind sinnvoll.",
    a: 84,
    b: 79,
    kind: "warnung",
    reading: "Die höchste Zustimmung des Verfahrens, und sie trägt nicht. Die einen wollen Fristen, damit die Pflicht sicher kommt, die anderen, damit sie sich erledigt.",
  },
  {
    id: 9,
    text: "Die Mehrkosten liegen bei etwa 1,5 bis 2 Prozent der Bausumme.",
    a: 69,
    b: 63,
    kind: "klaerbar",
    reading: "Eine Tatsachenfrage. Ein Kurzgutachten von vier bis sechs Wochen nimmt den letzten Zahlenstreit aus der Debatte.",
  },
];

const STEPS = [
  {
    title: "Maßnahme einstellen",
    text: "Sie beschreiben, was die Stadt vorhat, und begründen es: wie die Lage ist, was die Maßnahme bewirkt, warum der Weg der richtige ist und warum sich der Eingriff lohnt. Vorhandene Stellungnahmen laden Sie dazu.",
  },
  {
    title: "Punkte vorbereiten",
    text: "Die Maschine zerlegt Begründung und Stellungnahmen in einzelne Aussagen, über die man abstimmen kann. Ihre Redaktion prüft jede, bevor sie öffentlich wird.",
  },
  {
    title: "Die Stadt beteiligen",
    text: "Bürgerinnen und Bürger stimmen ab, schreiben in zwei Sätzen, was fehlt, oder reichen eine ganze Stellungnahme ein. Doppeltes erkennt die Maschine, Neues prüft die Redaktion.",
  },
  {
    title: "Landkarte und Bericht",
    text: "Wenn nichts Neues mehr kommt, endet die Beteiligung. Der Rat bekommt einen Bericht: was zu klären ist und von wem.",
  },
];

const RESULTS = [
  { cls: "agree", title: "Darauf einigen sich beide Lager", text: "Aussagen, die in beiden Lagern eine Mehrheit haben, aus denselben Gründen. Ein Beschluss, der darauf baut, hält." },
  { cls: "warn", title: "Mit einem Gutachten klärbar", text: "Streit über Tatsachen, Zahlen und Wirkungen. Hier hilft keine Abstimmung, sondern ein Kurzgutachten vor dem Beschluss." },
  { cls: "disagree", title: "Hier liegt der Streit", text: "Wertfragen, an denen sich die Lager scheiden. Keine Studie entscheidet sie. Das ist die Aufgabe des Rats." },
  { cls: "warn", title: "Vorsicht, Scheinkonsens", text: "Hohe Zustimmung aus unvereinbaren Gründen. Sie zerbricht bei der ersten Detailfrage, und die Landkarte zeigt das vorher." },
  { cls: "pass", title: "Was niemand gefragt hat", text: "Prüffragen, die in der ganzen Beteiligung offen blieben. Vor einem Beschluss gezielt nachfragen." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero wrap">
          <div className="hero-text">
            <h1>Worüber streitet Ihre Stadt wirklich?</h1>
            <p className="hero-lead">
              Sie stellen eine Maßnahme zur Diskussion, etwa eine Solarpflicht für Neubauten. Bürgerinnen und Bürger stimmen ab, ergänzen
              eigene Punkte oder reichen Stellungnahmen ein. Die Landkarte des Streits zeigt dem Rat, worüber man sich längst einig ist, was
              ein Gutachten klären kann und was er selbst entscheiden muss.
            </p>
            <div className="hero-cta">
              <Link href="/registrieren" className="btn">
                Verfahren anlegen
              </Link>
              <Link href="/musterstadt/solarpflicht" className="btn btn-quiet">
                Beispiel ansehen
              </Link>
            </div>
          </div>
          <div className="hero-map">
            <OpinionSpace statements={DEMO} />
            <p className="small muted hero-note">Beispiel mit erfundenen Zahlen: eine Solarpflicht für Neubauten in Musterstadt.</p>
          </div>
        </section>

        <section className="band" id="ablauf" aria-labelledby="ablauf-h">
          <div className="wrap">
            <h2 id="ablauf-h">So läuft ein Verfahren</h2>
            <ol className="steps">
              {STEPS.map((s) => (
                <li key={s.title}>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="wrap results" aria-labelledby="ergebnis-h">
          <div className="results-head">
            <h2 id="ergebnis-h">Was der Rat bekommt</h2>
            <p className="muted">
              Keine Stimmungskurve, sondern eine Arbeitsliste. Jede Aussage landet dort, wo sie hingehört, und jede führt per Klick zurück zum
              Originalzitat.
            </p>
          </div>
          <ul className="result-list">
            {RESULTS.map((r) => (
              <li key={r.title}>
                <span className={`mark ${r.cls}`} aria-hidden />
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="band" aria-labelledby="vertrauen-h">
          <div className="wrap trust">
            <h2 id="vertrauen-h">Warum man dem Ergebnis trauen kann</h2>
            <dl>
              <div>
                <dt>Jeder Satz hat eine Quelle</dt>
                <dd>Vom Bericht zur Aussage, zum Zitat, zur markierten Stelle im Original. Niemand muss dem Bericht glauben, man kann nachsehen.</dd>
              </div>
              <div>
                <dt>Menschen geben frei</dt>
                <dd>Die Maschine schlägt vor, Ihre Redaktion entscheidet. Arbeitet ein Verfahren ohne Redaktion, steht das im Bericht.</dd>
              </div>
              <div>
                <dt>Wertfragen bleiben beim Rat</dt>
                <dd>Lager und Zustimmung werden nachrechenbar aus den Stimmen ermittelt, nach dem Verfahren von Polis. Was eine Wertung ist, entscheidet keine Maschine.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="wrap closing">
          <h2>Ein Verfahren, eine Frage</h2>
          <p className="muted">Legen Sie ein Konto für Ihre Kommune an und stellen Sie Ihre erste Maßnahme zur Diskussion. Öffentlich wird es erst, wenn Sie es freischalten.</p>
          <Link href="/registrieren" className="btn">
            Verfahren anlegen
          </Link>
        </section>
      </main>
      <footer className="site-foot">
        <div className="wrap">
          <p className="small muted">Landkarte des Streits ist ein Prototyp. Das Beispiel Musterstadt ist erfunden.</p>
        </div>
      </footer>
    </>
  );
}
