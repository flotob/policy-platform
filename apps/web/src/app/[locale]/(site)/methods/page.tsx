import { setRequestLocale } from "next-intl/server";
import { DEFAULT_THRESHOLDS } from "@policy/math";
import {
  AI_REVIEW_POINTS_SYSTEM,
  AI_REVIEW_STATEMENTS_SYSTEM,
  BATCH_MATCH_SYSTEM,
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

type StageType = "io" | "llm" | "gate" | "det";

interface Stage {
  type: StageType;
  title: { de: string; en: string };
  desc: { de: string; en: string };
  script: string;
  /** What flows out of this station into the next (rendered on the connector). */
  artifact?: { de: string; en: string };
  prompts?: { label: { de: string; en: string }; text: string }[];
}

const STAGES: Stage[] = [
  {
    type: "io",
    title: { de: "Import", en: "Import" },
    desc: {
      de: "Der Harvester sammelt die Rohdaten einer Konsultation: Stellungnahmen (PDF, Word), Fragebogen-CSV-Exporte, Freitexte. Nichts wird umgeschrieben oder gekürzt — jede Einreichung landet wörtlich und vollständig in der Datenbank.",
      en: "The harvester collects a consultation's raw data: position papers (PDF, Word), questionnaire CSV exports, free texts. Nothing is rewritten or shortened — every submission lands verbatim and in full.",
    },
    script: "harvest · import-harvest.ts",
    artifact: { de: "Stellungnahmen im Volltext", en: "submissions, full text" },
  },
  {
    type: "llm",
    title: { de: "Dekomposition", en: "Decomposition" },
    desc: {
      de: "Ein Sprachmodell liest jede Stellungnahme vollständig (lange Texte in ~20k-Zeichen-Fenstern an Absatzgrenzen) und schlägt einzelne Punkte vor: Behauptung, Position im Argumentschema (P1–P4, Konklusion), Art (Fakt, Wertung, Design, …) — und für jeden Punkt ein wörtliches Zitat als Beleg.",
      en: "A language model reads every submission in full (long texts in ~20k-char windows at paragraph boundaries) and proposes individual points: claim, slot in the argument scheme (P1–P4, conclusion), kind (fact, value, design, …) — each backed by a verbatim quote.",
    },
    script: "decompose.ts",
    artifact: { de: "Kandidaten-Punkte + wörtliche Zitate", en: "candidate points + verbatim quotes" },
    prompts: [{ label: { de: "Dekompositions-Prompt", en: "Decomposition prompt" }, text: DECOMPOSE_SYSTEM }],
  },
  {
    type: "llm",
    title: { de: "Matching", en: "Matching" },
    desc: {
      de: "Für jeden Kandidaten: Ist das derselbe Punkt wie einer, der schon auf der Karte steht — oder ein neuer? Im Zweifel neu: eine falsche Zusammenlegung löscht leise eine Stimme, ein Duplikat ist später billig zusammengeführt. Jede Entscheidung wird als eigener Datensatz mit Modell, Prompt-Hash und Konfidenz protokolliert.",
      en: "For every candidate: is this the same point as one already on the map — or a new one? When in doubt, new: a false merge silently erases a voice, a duplicate is cheaply merged later. Every decision is recorded with model, prompt hash, and confidence.",
    },
    script: "pipeline.ts",
    artifact: { de: "Punkte (Entwurf)", en: "points (draft)" },
    prompts: [
      { label: { de: "Matching-Prompt (einzeln)", en: "Match prompt (single)" }, text: MATCH_SYSTEM },
      { label: { de: "Batch-Matching-Prompt (ein Aufruf pro Abschnitt)", en: "Batch match prompt (one call per chunk)" }, text: BATCH_MATCH_SYSTEM },
    ],
  },
  {
    type: "llm",
    title: { de: "Bezüge", en: "Relations" },
    desc: {
      de: "Argumentative Kanten zwischen Punkten derselben Stellungnahme: „stützt“ sowie die fünf kritischen Fragen des Argumentschemas. Sie entstehen bei der Dekomposition gleich mit; für ältere Karten zieht dieser Schritt sie nach.",
      en: "Argumentative edges between points of the same submission: “supports” plus the argument scheme's five critical questions. They emerge during decomposition; this step backfills them for older maps.",
    },
    script: "backfill-relations.ts",
    artifact: { de: "Punkte + Argument-Kanten", en: "points + argument edges" },
    prompts: [{ label: { de: "Bezüge-Prompt", en: "Relations prompt" }, text: RELATIONS_SYSTEM }],
  },
  {
    type: "gate",
    title: { de: "KI-Redaktion: Punkte", en: "AI editor: points" },
    desc: {
      de: "Ein KI-Redakteur prüft jeden Punkt-Entwurf und gibt ihn frei oder weist ihn zurück — mit Begründung, ins Audit-Log. Jede Entscheidung ist im Redaktions-Arbeitsplatz von Menschen umkehrbar: die Maschine schlägt vor, die Redaktion behält das letzte Wort.",
      en: "An AI editor reviews every draft point and releases or rejects it — with a reason, into the audit log. Every decision is reversible by humans in the review workbench: the machine proposes, the editors keep the last word.",
    },
    script: "ai-review.ts --what points",
    artifact: { de: "freigegebene Punkte", en: "released points" },
    prompts: [{ label: { de: "Redaktions-Prompt: Punkte", en: "Editor prompt: points" }, text: AI_REVIEW_POINTS_SYSTEM }],
  },
  {
    type: "llm",
    title: { de: "Statement-Generierung", en: "Statement generation" },
    desc: {
      de: "Jeder freigegebene Punkt wird zu einem abstimmbaren Statement: ein einziger klarer Aussagesatz, dem man zustimmen oder widersprechen kann — auf Deutsch und Englisch, gleicher Inhalt, gleiche Polarität.",
      en: "Every released point becomes a votable statement: one clear declarative sentence a reader can agree or disagree with — in German and English, same content, same polarity.",
    },
    script: "generate-statements.ts",
    artifact: { de: "Statement-Entwürfe (de + en)", en: "draft statements (de + en)" },
    prompts: [{ label: { de: "Statement-Prompt", en: "Statement prompt" }, text: STATEMENT_SYSTEM }],
  },
  {
    type: "gate",
    title: { de: "KI-Redaktion: Statements", en: "AI editor: statements" },
    desc: {
      de: "Zweites Gate: Ist das Statement wirklich EIN Satz, unverzerrt, in beiden Sprachen dasselbe? Zurückgewiesene werden neu generiert; auch hier gilt: menschlich umkehrbar, alles protokolliert.",
      en: "Second gate: is the statement really ONE sentence, unbiased, identical in both languages? Rejected ones are regenerated; again human-reversible, everything logged.",
    },
    script: "ai-review.ts --what statements",
    artifact: { de: "abstimmbare Statements", en: "votable statements" },
    prompts: [{ label: { de: "Redaktions-Prompt: Statements", en: "Editor prompt: statements" }, text: AI_REVIEW_STATEMENTS_SYSTEM }],
  },
  {
    type: "llm",
    title: { de: "Voten: echt + inferiert", en: "Votes: real + inferred" },
    desc: {
      de: "Echte Voten kommen aus zwei deterministischen Quellen: Fragebogen-Antworten (dokumentierte Ja/Nein/Likert-Abbildung) und der Abstimmen-Ansicht der Plattform. Dazu inferiert ein Sprachmodell aus Freitext-Stellungnahmen Haltungen zu jedem Statement (Zustimmung/Ablehnung/Enthaltung) — nur aus dem Text, nie aus vermuteten Interessen. Jedes Votum trägt seine Herkunft (echt oder inferiert); ein echtes Votum wird nie überschrieben.",
      en: "Real votes come from two deterministic sources: questionnaire answers (documented yes/no/Likert mapping) and the platform's voting deck. In addition, a language model infers stances toward each statement from free-text submissions (agree/disagree/pass) — from the text only, never from presumed interests. Every vote carries its provenance (real or inferred); a real vote is never overwritten.",
    },
    script: "infer-stances.ts",
    artifact: { de: "Voten-Matrix (echt + inferiert)", en: "vote matrix (real + inferred)" },
    prompts: [{ label: { de: "Haltungs-Prompt", en: "Stance prompt" }, text: STANCE_SYSTEM }],
  },
  {
    type: "det",
    title: { de: "Analyse", en: "Analysis" },
    desc: {
      de: "Ab hier kein Sprachmodell mehr: PCA-Projektion, k-Means-Clustering (k=2…5, bestes Silhouette gewinnt, deterministische Initialisierung), Gruppenstatistik mit Signifikanztests, dann Brücken, Konfliktlinien und die Diagnose. Gleiche Eingabe ⇒ exakt gleiches Ergebnis, jederzeit reproduzierbar. Die Schwellwerte stehen unten auf dieser Seite.",
      en: "No language model from here on: PCA projection, k-means clustering (k=2…5, best silhouette wins, deterministic initialization), group statistics with significance tests, then bridges, conflict lines, and the diagnosis. Same input ⇒ exactly the same result, reproducible any time. The thresholds are further down this page.",
    },
    script: "analyze.ts",
    artifact: { de: "Lager, Brücken, Konfliktlinien, Diagnose", en: "camps, bridges, conflict lines, diagnosis" },
  },
  {
    type: "llm",
    title: { de: "Präsentation", en: "Presentation" },
    desc: {
      de: "Drei Beschriftungs-Schritte machen das Ergebnis lesbar: Lager-Benennung (aus Zusammensetzung und meistzugestimmten/-abgelehnten Statements), Themen-Clusterung (die Zoom-Ebene der Karte), Label-Kürzung. Sie schreiben ausschließlich Darstellungs-Metadaten — die Analyse selbst bleibt unberührt.",
      en: "Three labeling passes make the result readable: camp naming (from composition and most agreed/rejected statements), theme clustering (the map's zoom level), label shortening. They write presentation metadata only — the analysis itself stays untouched.",
    },
    script: "name-camps.ts · cluster-themes.ts · shorten-labels.ts",
    artifact: { de: "benannte Lager + Themen", en: "named camps + themes" },
    prompts: [
      { label: { de: "Lager-Benennungs-Prompt", en: "Camp naming prompt" }, text: NAME_CAMPS_SYSTEM },
      { label: { de: "Themen-Vorschlags-Prompt", en: "Theme proposal prompt" }, text: THEMES_PROPOSE_SYSTEM },
      { label: { de: "Themen-Zuordnungs-Prompt", en: "Theme assignment prompt" }, text: THEMES_ASSIGN_SYSTEM },
      { label: { de: "Label-Kürzungs-Prompt", en: "Label shortening prompt" }, text: SHORTEN_LABELS_SYSTEM },
    ],
  },
  {
    type: "io",
    title: { de: "Die Landkarte", en: "The map" },
    desc: {
      de: "Das Ergebnis, das Sie in jeder Konsultation sehen: die Übersicht mit Lagern und Diagnose, das Konfliktfeld der Karte, das Abstimmen-Deck — und im Redaktions-Arbeitsplatz die Herkunft jeder einzelnen Entscheidung.",
      en: "What you see in every consultation: the overview with camps and diagnosis, the map's conflict field, the voting deck — and, in the review workbench, the provenance of every single decision.",
    },
    script: "Übersicht · Karte · Abstimmen · Redaktion",
  },
];

const TYPE_LABEL: Record<StageType, { de: string; en: string }> = {
  io: { de: "Daten", en: "data" },
  llm: { de: "LLM-Schritt", en: "LLM step" },
  gate: { de: "Redaktions-Gate", en: "editorial gate" },
  det: { de: "deterministisch", en: "deterministic" },
};

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
        <h2>{de ? "Die Pipeline" : "The pipeline"}</h2>
        <p>
          {de
            ? "Der Weg von der eingereichten Stellungnahme zur Landkarte, Station für Station. Zwischen den Stationen steht, welche Daten dort fließen; bei jedem LLM-Schritt lässt sich der System-Prompt wörtlich aufklappen. Jede Station schreibt ins Audit-Log."
            : "The road from submitted text to the map, station by station. Between stations you see what data flows there; every LLM step opens its verbatim system prompt. Every station writes to the audit log."}
        </p>
        <div className="pipe-legend" aria-hidden>
          {(["llm", "gate", "det"] as StageType[]).map((t) => (
            <span key={t} className={`pipe-legend__item pipe-legend__item--${t}`}>
              {de ? TYPE_LABEL[t].de : TYPE_LABEL[t].en}
            </span>
          ))}
        </div>
        <ol className="pipe">
          {STAGES.map((s, i) => (
            <li key={s.title.en} className={`pipe__stage pipe__stage--${s.type}`}>
              <span className="pipe__dot">{i + 1}</span>
              <div className="pipe__head">
                <strong>{de ? s.title.de : s.title.en}</strong>
                <span className="pipe__type">{de ? TYPE_LABEL[s.type].de : TYPE_LABEL[s.type].en}</span>
                <code className="pipe__script">{s.script}</code>
              </div>
              <p className="pipe__desc">{de ? s.desc.de : s.desc.en}</p>
              {s.prompts?.map((p) => (
                <details key={p.label.en} className="methods__prompt">
                  <summary>{de ? p.label.de : p.label.en}</summary>
                  <pre>{p.text}</pre>
                </details>
              ))}
              {s.artifact ? (
                <div className="pipe__artifact">↓ {de ? s.artifact.de : s.artifact.en}</div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

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
    </main>
  );
}
