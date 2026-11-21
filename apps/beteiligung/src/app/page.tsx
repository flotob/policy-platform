import Link from "next/link";

import { BeispielFlow, HeroAnswers, HeroStage } from "@/components/Beispiel";
import { SiteHeader } from "@/components/SiteHeader";
import { landingExample } from "@/lib/beispiel";

import "./landing.css";

/** The example in the opening picture is read from the published Musterstadt result on every visit (kept in memory per report). */
export const dynamic = "force-dynamic";

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
  { cls: "pass", title: "Was niemand gefragt hat", text: "Einwände, die in der ganzen Beteiligung niemand erhoben oder beantwortet hat. Vor einem Beschluss gezielt nachfragen." },
];

const NUMBER = ["", "ein", "zwei", "drei", "vier", "fünf"];
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}` : (xs[0] ?? ""));

export default async function Home() {
  const example = await landingExample();
  const total = example ? example.camps.reduce((s, c) => s + c.n, 0) : 0;
  return (
    <>
      <SiteHeader />
      <main>
        <section className={example ? "hero hero-full" : "hero"} aria-labelledby="hero-h">
          <HeroStage example={example}>
            <h1 id="hero-h">Worüber streitet Ihre Stadt wirklich?</h1>
            <p className="hero-lead">
              Sie stellen eine Maßnahme zur Diskussion, etwa eine Solarpflicht für Neubauten. Die Bürgerinnen und Bürger stimmen ab und
              ergänzen, was fehlt. Am Ende weiß der Rat, woran er ist.
            </p>
            <div className="hero-cta">
              <Link href="/musterstadt" className="btn">
                Musterstadt erkunden
              </Link>
            </div>
          </HeroStage>
          <div className="hero-base">
            <div className="wrap">
              <h2 className="hero-answers-h">Was der Rat am Ende bekommt</h2>
              <HeroAnswers linked={!!example} />
            </div>
          </div>
        </section>

        {example ? (
          <section className="bx" id="beispiel" aria-labelledby="beispiel-h">
            <div className="wrap">
              <div className="bx-top">
                <h2 id="beispiel-h">So sieht das aus: {example.title} in Musterstadt</h2>
                <p className="bx-intro">
                  {total.toLocaleString("de-DE")} Menschen haben abgestimmt. Aus ihren Stimmen ergeben sich{" "}
                  {NUMBER[example.camps.length] ?? example.camps.length} Lager: {listed(example.camps.map((c) => `„${c.name}“`))}. Wählen Sie
                  eine Aussage: Sie sehen, wie jedes Lager abgestimmt hat, und was daraus für den Rat folgt.
                </p>
              </div>
              <BeispielFlow example={example} />
              <p className="bx-foot">Beispiel mit erfundenen Zahlen. Die Aussagen und alle Stimmen stammen aus dem veröffentlichten Ergebnis von Musterstadt.</p>
            </div>
          </section>
        ) : null}

        <section className="lp-sec" id="ablauf" aria-labelledby="ablauf-h">
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

        <section className="band" aria-labelledby="ergebnis-h">
          <div className="wrap results">
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
                <span className={`lp-mark ${r.cls}`} aria-hidden />
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.text}</p>
                </div>
              </li>
            ))}
          </ul>
          </div>
        </section>

        <section className="lp-sec" aria-labelledby="vertrauen-h">
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
            Konto anlegen
          </Link>
        </section>
      </main>
      <footer className="site-foot">
        <div className="wrap">
          <p className="small muted">streit.bar ist ein Prototyp. Das Beispiel Musterstadt ist erfunden.</p>
        </div>
      </footer>
    </>
  );
}
