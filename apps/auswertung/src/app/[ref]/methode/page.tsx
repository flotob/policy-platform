import { nf } from "@policy/landkarte";
import { loadMachineWork, loadSaturation, loadSaturationCurve } from "@policy/landkarte/data/method";

import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

/** Above this many statements the page shows the curve instead of one row per statement. */
const ROWS_UP_TO = 40;

/** Known dispute questions after k statements (random order): a line that flattens when nothing new comes. */
function Curve({ curve }: { curve: { k: number; known: number }[] }) {
  const W = 640;
  const H = 180;
  const pad = { l: 36, r: 8, t: 8, b: 26 };
  const n = curve.length;
  const max = Math.max(1, curve[n - 1]?.known ?? 1);
  const x = (k: number) => Math.round((pad.l + ((k - 1) / Math.max(1, n - 1)) * (W - pad.l - pad.r)) * 100) / 100;
  const y = (v: number) => Math.round((H - pad.b - (v / max) * (H - pad.t - pad.b)) * 100) / 100;
  const path = curve.map((c, i) => `${i ? "L" : "M"}${x(c.k)},${y(c.known)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.max(1, Math.round(f * n)));
  return (
    <svg className="sat-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bekannte Streitfragen nach Zahl der Stellungnahmen: ${max} nach ${n}`}>
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="sat-axis" />
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="sat-axis" />
      {ticks.map((k) => (
        <text key={k} x={x(k)} y={H - 8} textAnchor="middle" className="sat-tick">
          {k}
        </text>
      ))}
      <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" className="sat-tick">
        {max}
      </text>
      <text x={pad.l - 6} y={H - pad.b} textAnchor="end" className="sat-tick">
        0
      </text>
      <path d={path} className="sat-line" />
    </svg>
  );
}

export default async function Methode({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const db = getDb();
  const steps = await loadSaturation(db, o.id);
  const many = o.stats.statements > ROWS_UP_TO;
  const curve = many ? await loadSaturationCurve(db, o.id) : [];
  const total = curve[curve.length - 1]?.known ?? 0;
  const lastQuarter = curve.slice(Math.floor(curve.length * 0.75));
  const lateNew = lastQuarter.reduce((s, c) => s + c.newQuestions, 0);
  const ninety = curve.find((c) => c.known >= total * 0.9);
  const work = await loadMachineWork(db, o.id);
  const max = Math.max(...steps.map((s) => s.touchedQuestions), 1);
  const last = steps[steps.length - 1];
  const lastShare = last && last.touchedQuestions ? last.newQuestions / last.touchedQuestions : 0;
  const saturated = lastShare < 0.05;

  return (
    <>
      <header className="page-head">
        <p className="crumbs">Methode</p>
        <h1>Wie die Karte entsteht</h1>
        <p className="lead">
          Die Maschine zerlegt, ordnet und rechnet. Sie entscheidet keine Wertfrage. Jeder Schritt ist protokolliert und lässt sich bis zur Textstelle
          zurückverfolgen.
        </p>
      </header>

      <section>
        <h2>Hat die {o.procedure} alles gehört?</h2>
        {many ? (
          <>
            <p className="prose">
              Eine Debatte ist ausgeschöpft, wenn neue Stellungnahmen keine neuen Streitfragen mehr bringen. Das Konzeptpapier nennt das Sättigung: Statt
              nach Kalender endet ein Verfahren, wenn nichts Neues mehr kommt. Die Kurve zeigt, wie viele der {total} Streitfragen nach einer bestimmten
              Zahl von Stellungnahmen bekannt sind, die Stellungnahmen in zufälliger Reihenfolge gelesen. Flacht sie ab, kommt nichts Neues mehr.
            </p>
            <Curve curve={curve} />
            <Row margin={<span>Reihenfolge zufällig, aber fest, damit das Bild jedes Mal gleich ist.</span>}>
              <p className="prose" style={{ margin: 0 }}>
                {ninety ? `Nach ${ninety.k} von ${curve.length} Stellungnahmen waren neun von zehn Streitfragen bekannt. ` : null}
                {lateNew / Math.max(1, total) < 0.05
                  ? `Das letzte Viertel der Stellungnahmen brachte nur noch ${lateNew} neue Streitfragen: Die Debatte wirkt ausgeschöpft.`
                  : `Das letzte Viertel der Stellungnahmen brachte noch ${lateNew} neue Streitfragen: Die Debatte war noch nicht ausgeschöpft.`}
              </p>
            </Row>
          </>
        ) : (
          <>
        <p className="prose">
          Eine Debatte ist ausgeschöpft, wenn neue Stellungnahmen keine neuen Streitfragen mehr bringen. Das Konzeptpapier nennt das Sättigung: Statt nach
          Kalender endet ein Verfahren, wenn nichts Neues mehr kommt. Hier jede Stellungnahme in der Reihenfolge, in der sie verarbeitet wurde (die kürzeste
          zuerst): wie viele Streitfragen sie berührt und wie viele davon sie als erste aufgeworfen hat.
        </p>
        <div className="sat" role="table" aria-label="Neue und bekannte Streitfragen je Stellungnahme">
          {steps.map((s) => (
            <div className="sat-row" role="row" key={s.k}>
              <span className="sat-name" role="cell">
                {s.k}. {s.short}
              </span>
              <span className="sat-bar" role="cell" aria-label={`${s.newQuestions} neue von ${s.touchedQuestions} Streitfragen`}>
                <i className="sat-new" style={{ width: `${(s.newQuestions / max) * 100}%` }} />
                <i className="sat-known" style={{ width: `${((s.touchedQuestions - s.newQuestions) / max) * 100}%` }} />
              </span>
              <span className="sat-num" role="cell">
                {s.newQuestions} neu von {s.touchedQuestions}
              </span>
            </div>
          ))}
        </div>
        <p className="sat-legend small">
          <span><i className="sat-new" /> zum ersten Mal aufgeworfen</span>
          <span><i className="sat-known" /> schon von einer früheren Stellungnahme angesprochen</span>
        </p>
        {last ? (
          <Row margin={<span>Neue Argumente der letzten Stellungnahme: {last.newArguments}, bereits bekannte: {last.knownArguments}</span>}>
            <p className="prose" style={{ margin: 0 }}>
              {saturated
                ? `Die Debatte wirkt ausgeschöpft: Die letzte Stellungnahme brachte kaum noch neue Streitfragen.`
                : `Die ${o.procedure} war nicht gesättigt. Auch die letzte Stellungnahme (${last.short}) warf noch ${last.newQuestions} von ${last.touchedQuestions} Streitfragen als erste auf. Mehr Stimmen hätten wahrscheinlich weitere Streitfragen auf die Karte gebracht; bei ${steps.length} Stellungnahmen ist das zu erwarten.`}
            </p>
          </Row>
        ) : null}
          </>
        )}
      </section>

      <section>
        <h2>Die Schritte</h2>
        <p className="prose">Drei Arten von Arbeit, sauber getrennt: Ein Sprachmodell schreibt, Jev entscheidet, Code rechnet.</p>
        <Row margin={<span>Sprachmodell (Claude)</span>}>
          <p className="row-title">Zerlegen</p>
          <p className="row-text">
            Jede Stellungnahme wird in einzelne Argumente zerlegt, {nf.format(o.stats.points)} insgesamt. Wo die automatische Prüfung ein Argument beanstandet,
            bessert eine maschinelle Redaktion nach: {work.edits.split ?? 0}-mal geteilt, {work.edits.rewrite ?? 0}-mal umformuliert.
          </p>
          {o.stats.undecomposed > 0 ? (
            <p className="row-text">
              Noch nicht zerlegt sind {o.stats.undecomposed} kurze Stellungnahmen, meist von Privatpersonen: Im Prototyp reichte das Rechenkontingent nicht für
              alle. Ihre Argumente fehlen auf der Karte; wie sie zu den Streitfragen stehen, ist trotzdem aus ihrem Text abgeleitet.
            </p>
          ) : null}
        </Row>
        <Row margin={<span>Jev (TypeSafe), {nf.format(work.jevJudgments)} Einzelentscheidungen, jede mit Wahrscheinlichkeit gespeichert</span>}>
          <p className="row-title">Ordnen</p>
          <p className="row-text">
            Jev prüft jedes Argument (Tatsache oder Wertung, welche kritische Frage), erkennt dasselbe Argument in verschiedenen Stellungnahmen, ordnet es{" "}
            {o.draft.kind === "law" ? "einer Maßnahme des Gesetzentwurfs" : "einem Handlungsfeld des Strategieentwurfs"} zu, findet Verbindungen zwischen Argumenten und leitet aus jedem Text ab, wie die Organisation zu jeder Streitfrage steht.
          </p>
        </Row>
        <Row margin={<span>Jev</span>}>
          <p className="row-title">Belege prüfen</p>
          <p className="row-text">
            Für jede zitierte Textstelle prüft Jev, ob sie ihr Argument belegt: mit Daten und Quelle, einer Studie, einer anderen Rechtsquelle oder einem Beispiel
            aus der Praxis. Am Tatsachenpunkt zählt Beweiskraft, nicht Kopfzahl.
          </p>
        </Row>
        <Row margin={<span>Sprachmodell schlägt vor, Jev ordnet zu</span>}>
          <p className="row-title">Verdichten</p>
          <p className="row-text">
            Je Teilentscheidung werden die Argumente zu höchstens 20 Streitfragen verdichtet, eine je Frage, um die wirklich gestritten wird. Was keiner Frage
            gehört, bleibt als Einzelforderung sichtbar.
          </p>
        </Row>
        <Row margin={<span>Code, keine KI</span>}>
          <p className="row-title">Rechnen</p>
          <p className="row-text">
            Aus den Stimmen bilden sich die Lager (das Verfahren von Polis). Die Diagnose jeder Streitfrage folgt aus festen Schwellen: Brücke, wenn beide Lager
            mehrheitlich zustimmen; Tatsachen-, Wert- oder Gestaltungsstreit, wenn sie auseinanderliegen.
          </p>
        </Row>
        <Row margin={<span>Sprachmodell, gebunden an das Ergebnis</span>}>
          <p className="row-title">Formulieren</p>
          <p className="row-text">
            Der Befund jeder Streitfrage wird ausformuliert. Das Sprachmodell darf das gerechnete Ergebnis nicht ändern, nicht abschwächen und nicht umdrehen.
            Ob eine Brücke trägt, prüft es an den Begründungen beider Seiten.
          </p>
        </Row>
        <p className="small">
          <a href="/pipeline.html">Alle Schritte im Detail, mit den Prompts und Jev-Fragen im Wortlaut</a>
        </p>
      </section>

      <section>
        <h2>Was dieser Prototyp noch nicht kann</h2>
        <div className="prose">
          <p>
            Die Stimmen sind aus den Stellungnahmen abgeleitet, nicht abgegeben. Im echten Verfahren stimmen die Beteiligten selbst ab; die Ableitung ergänzt das
            nur.
          </p>
          <p>
            Eine menschliche Redaktion fehlt noch. Im Konzept prüft ein Mensch jede neue Streitfrage vor der Veröffentlichung; hier hat die maschinelle Redaktion
            allein gearbeitet.
          </p>
          <p>
            Ob eine Textstelle Belege nennt, prüft Jev nur am Zitat selbst: Daten mit Quelle, Studien, andere Rechtsquellen, Beispiele aus der Praxis. Ob der Beleg
            stimmt, prüft niemand; das bleibt Aufgabe der Gutachter.
          </p>
        </div>
      </section>
    </>
  );
}
