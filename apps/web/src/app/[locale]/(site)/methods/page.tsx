import { setRequestLocale } from "next-intl/server";
import { DEFAULT_THRESHOLDS } from "@policy/math";
import {
  AI_REVIEW_POINTS_SYSTEM,
  AI_REVIEW_STATEMENTS_SYSTEM,
  DECOMPOSE_SYSTEM,
  MATCH_SYSTEM,
  NAME_CAMPS_SYSTEM,
  RELATIONS_SYSTEM,
  SHORTEN_LABELS_SYSTEM,
  STANCE_SYSTEM,
  STATEMENT_SYSTEM,
  THEMES_ASSIGN_SYSTEM,
  THEMES_PROPOSE_SYSTEM,
} from "@policy/pipeline/prompts";

export const dynamic = "force-static";

/**
 * Methods & configuration — inspectable by construction: the prompt texts
 * and thresholds below are IMPORTED from the packages the pipeline actually
 * runs, not copied. What you read here is what executes.
 */

const PROMPTS: { key: string; de: string; en: string; text: string }[] = [
  { key: "decompose", de: "Dekomposition (Stellungnahme → Punkte)", en: "Decomposition (submission → points)", text: DECOMPOSE_SYSTEM },
  { key: "match", de: "Matching (bekannter Punkt oder neu?)", en: "Matching (known point or new?)", text: MATCH_SYSTEM },
  { key: "relations", de: "Bezüge (stützt / kritische Fragen)", en: "Relations (supports / critical questions)", text: RELATIONS_SYSTEM },
  { key: "statement", de: "Statement-Generierung (Punkt → abstimmbarer Satz)", en: "Statement generation (point → votable sentence)", text: STATEMENT_SYSTEM },
  { key: "review-points", de: "KI-Redaktion: Punkte", en: "AI editor: points", text: AI_REVIEW_POINTS_SYSTEM },
  { key: "review-statements", de: "KI-Redaktion: Statements", en: "AI editor: statements", text: AI_REVIEW_STATEMENTS_SYSTEM },
  { key: "stance", de: "Haltungs-Inferenz (Freitext → Voten)", en: "Stance inference (free text → votes)", text: STANCE_SYSTEM },
  { key: "name-camps", de: "Lager-Benennung", en: "Camp naming", text: NAME_CAMPS_SYSTEM },
  { key: "shorten", de: "Label-Kürzung", en: "Label shortening", text: SHORTEN_LABELS_SYSTEM },
  { key: "themes-propose", de: "Themen-Vorschlag (Zoom-Ebene)", en: "Theme proposal (zoom level)", text: THEMES_PROPOSE_SYSTEM },
  { key: "themes-assign", de: "Themen-Zuordnung", en: "Theme assignment", text: THEMES_ASSIGN_SYSTEM },
];

export default async function MethodsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const de = locale !== "en";
  const T = DEFAULT_THRESHOLDS;

  const thresholds: { name: string; value: string; expl: string }[] = [
    {
      name: de ? "Brückenschwelle (groupAgree)" : "Bridge threshold (groupAgree)",
      value: `${Math.round(T.groupAgree * 100)} %`,
      expl: de
        ? "Ein Statement ist eine Brücke, wenn JEDES Lager mit mindestens diesem Anteil zustimmt (und der Wert statistisch signifikant ist)."
        : "A statement is a bridge when EVERY camp agrees at least at this rate (and the value is statistically significant).",
    },
    {
      name: de ? "Ablehnungsschwelle (groupDisagree)" : "Disagree threshold (groupDisagree)",
      value: `${Math.round(T.groupDisagree * 100)} %`,
      expl: de
        ? "Ein Lager gilt als ablehnend, wenn es mit mindestens diesem Anteil widerspricht (signifikant)."
        : "A camp counts as rejecting when it disagrees at least at this rate (significantly).",
    },
    {
      name: de ? "Divergenz-Schwelle (divergenceLow)" : "Divergence threshold (divergenceLow)",
      value: `≤ ${Math.round(T.divergenceLow * 100)} %`,
      expl: de
        ? "Konfliktlinie auch ohne aktives Nein: Ein Lager stimmt zu, ein anderes bleibt unter dieser Zustimmungsquote — sofern es sich beteiligt hat (siehe Engagement)."
        : "Conflict line even without an active no: one camp agrees while another stays below this agreement rate — provided it engaged (see engagement).",
    },
    {
      name: de ? "Mindest-Engagement (minEngagement)" : "Minimum engagement (minEngagement)",
      value: `${Math.round(T.minEngagement * 100)} %`,
      expl: de
        ? "Damit Verweigerung als Konflikt zählt, muss das Lager mindestens diesen Anteil aktiver Voten (Ja/Nein statt Enthaltung) auf dem Statement haben — Massenschweigen ist kein Konflikt."
        : "For withholding to count as conflict, the camp needs at least this share of active votes (yes/no rather than pass) on the statement — mass silence is not conflict.",
    },
    {
      name: de ? "Konfidenz (confidence)" : "Confidence",
      value: String(T.confidence),
      expl: de
        ? "Signifikanzniveau der Ein-/Zwei-Anteils-Tests (z-Tests mit +1-Glättung) hinter „signifikant“."
        : "Significance level of the one/two-proportion tests (z-tests with +1 smoothing) behind “significant”.",
    },
    {
      name: de ? "Lageranzahl k" : "Camp count k",
      value: "2–5",
      expl: de
        ? "k-Means läuft für k=2…5; gewählt wird das k mit dem besten Silhouette-Wert. Deterministische Initialisierung (Polis-Verfahren)."
        : "k-means runs for k=2…5; the k with the best silhouette score wins. Deterministic initialization (Polis method).",
    },
    {
      name: de ? "Clusterbarkeit" : "Clusterability",
      value: de ? "≥ 7 Voten" : "≥ 7 votes",
      expl: de
        ? "Teilnehmer mit weniger als 7 Voten fließen nicht in das Clustering ein (zu wenig Signal für eine Verortung)."
        : "Participants with fewer than 7 votes are excluded from clustering (too little signal to place them).",
    },
    {
      name: de ? "Sättigung" : "Saturation",
      value: de ? "Fenster 3 · erreicht ≤ 35 % neu" : "window 3 · reached ≤ 35% new",
      expl: de
        ? "Anteil NEUER Punkte über die letzten 3 dekomponierten Stellungnahmen; ab 65 % Wiedererkennung gilt die Karte als gesättigt."
        : "Share of NEW points across the last 3 decomposed submissions; from 65% recognition the map counts as saturated.",
    },
    {
      name: de ? "Fragebogen-Votbarkeit" : "Questionnaire votability",
      value: de ? "≥ 60 % zuordenbar · ≥ 20 Antworten" : "≥ 60% mappable · ≥ 20 answers",
      expl: de
        ? "Eine Fragebogenfrage wird nur dann zum Statement, wenn genügend Antworten deterministisch auf Zustimmen/Ablehnen/Enthalten abbildbar sind (Ja/Nein, Likert 1–5: 4–5=Ja, 1–2=Nein, 3=Enthaltung)."
        : "A questionnaire question becomes a statement only when enough answers map deterministically to agree/disagree/pass (yes/no; Likert 1–5: 4–5=agree, 1–2=disagree, 3=pass).",
    },
    {
      name: de ? "Textfenster" : "Text windows",
      value: de ? "~20k Zeichen je Fenster" : "~20k chars per window",
      expl: de
        ? "Lange Stellungnahmen werden an Absatzgrenzen in Fenster zerlegt und VOLLSTÄNDIG verarbeitet — nichts wird abgeschnitten oder zusammengefasst. Wiederholt ein späteres Fenster einen Punkt, führt das Matching ihn mit dem bestehenden zusammen; bei der Haltungs-Inferenz werden die Fenster-Urteile vereinigt (irgendwo Zustimmung → Zustimmung; Zustimmung UND Ablehnung im selben Text → Enthaltung). Fensterzugehörigkeit steht in der Provenienz."
        : "Long submissions are split into windows at paragraph boundaries and processed IN FULL — nothing is cut off or summarized. If a later window repeats a point, matching folds it into the existing one; for stance inference the window verdicts merge (agreement anywhere → agree; both agreement AND rejection in the same text → pass). Window membership is recorded in provenance.",
    },
    {
      name: de ? "Modell" : "Model",
      value: "claude-sonnet-5",
      expl: de
        ? "Standardmodell aller Pipeline-Aufrufe (per Umgebungsvariable LLM_MODEL wechselbar). Jeder Aufruf protokolliert Modell + Prompt-Hash."
        : "Default model for all pipeline calls (switchable via the LLM_MODEL environment variable). Every call logs model + prompt hash.",
    },
  ];

  return (
    <main className="page explainer">
      <h1>{de ? "Methodik & Konfiguration" : "Methods & configuration"}</h1>
      <p className="explainer__lead">
        {de
          ? "Alles, was das System entscheidet, ist hier einsehbar. Die Prompt-Texte und Schwellwerte auf dieser Seite werden direkt aus dem laufenden Code importiert — was hier steht, ist was ausgeführt wird. (Bearbeitbar wird dies erst mit Anmeldung und Rechteverwaltung; bis dahin: vollständige Einsicht.)"
          : "Everything the system decides is inspectable here. The prompt texts and thresholds on this page are imported directly from the running code — what you read is what executes. (Editing will arrive with authentication and permissions; until then: full inspection.)"}
      </p>

      <section className="explainer__section">
        <h2>{de ? "Schwellwerte & Konstanten" : "Thresholds & constants"}</h2>
        <p>
          {de
            ? "Alle Werte sind konfigurierbare Startschätzungen; jede gespeicherte Analyse hält die zum Zeitpunkt gültigen Schwellwerte fest, sodass Ergebnisse reproduzierbar bleiben."
            : "All values are configurable initial estimates; every stored analysis records the thresholds in force at the time, keeping results reproducible."}
        </p>
        <div className="methods__grid">
          {thresholds.map((t) => (
            <div key={t.name} className="methods__row">
              <div className="methods__name">
                {t.name}
                <span className="methods__value">{t.value}</span>
              </div>
              <p>{t.expl}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="explainer__section">
        <h2>{de ? "Die Prompts (wörtlich)" : "The prompts (verbatim)"}</h2>
        <p>
          {de
            ? "Die System-Prompts jedes LLM-Schritts, unverändert aus dem Code. Ändert sich ein Prompt, ändert sich sein Hash in der Provenienz jedes künftigen Aufrufs."
            : "The system prompts of every LLM step, unmodified from the code. If a prompt changes, its hash changes in the provenance of every future call."}
        </p>
        {PROMPTS.map((p) => (
          <details key={p.key} className="methods__prompt">
            <summary>{de ? p.de : p.en}</summary>
            <pre>{p.text}</pre>
          </details>
        ))}
      </section>
    </main>
  );
}
