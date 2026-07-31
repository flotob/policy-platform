import { setRequestLocale } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-static";

/**
 * Long-form explainer. Deliberately NOT split into i18n message keys:
 * this is editorial prose, maintained as two parallel texts.
 */

type Section = { h: string; body: React.ReactNode };

function content(locale: string, methodsHref: string): { title: string; lead: string; sections: Section[] } {
  const de = locale !== "en";
  return {
    title: de ? "So funktioniert die Landkarte des Streits" : "How the map of the dispute works",
    lead: de
      ? "Diese Plattform verwandelt tausende Freitext-Stellungnahmen in ein lesbares Bild: Wer behauptet was, worüber sind sich die Lager einig, wo genau trennen sie sich — und was davon ließe sich durch Evidenz klären, was muss politisch entschieden werden? Diese Seite erklärt jedes Konzept und den gesamten Weg von den Rohdaten bis zur Karte."
      : "This platform turns thousands of free-text submissions into a readable picture: who claims what, where the camps agree, where exactly they divide — and which of those disputes evidence could settle, versus what must be decided politically. This page explains every concept and the whole journey from raw data to the map.",
    sections: [
      {
        h: de ? "1 · Das Grundmuster: praktisches Schließen (P1–P4)" : "1 · The pattern: practical reasoning (P1–P4)",
        body: (
          <>
            <p>
              {de
                ? "Jede politische Maßnahme M — eine Solarpflicht, ein Wärmeplanungsgesetz — wird mit demselben Grundargument begründet. Es hat vier Prämissen und eine Schlussfolgerung:"
                : "Every policy measure M — a solar mandate, a heat-planning law — is justified by the same underlying argument. It has four premises and one conclusion:"}
            </p>
            <ul>
              <li><strong>P1 · {de ? "Lage" : "Situation"}:</strong> {de ? "So ist die Lage heute. („Der Gebäudesektor verfehlt seine Klimaziele.“)" : "This is the situation today. (“The building sector is missing its climate targets.”)"}</li>
              <li><strong>P2 · {de ? "Wirkungsprognose" : "Effect prognosis"}:</strong> {de ? "Die Maßnahme wird diese Wirkung haben. („Kommunale Wärmeplanung führt faktisch zum Umsetzungszwang.“)" : "The measure will have this effect. (“Municipal heat planning will become a de-facto implementation obligation.”)"}</li>
              <li><strong>P3 · {de ? "Zielerreichung" : "Goal attainment"}:</strong> {de ? "Diese Wirkung zahlt tatsächlich auf das Ziel ein. („Der erzeugte Strom verdrängt wirklich fossile Energie.“)" : "That effect actually serves the stated goal. (“The electricity produced really displaces fossil energy.”)"}</li>
              <li><strong>P4 · {de ? "Wertung" : "Value"}:</strong> {de ? "Das Ziel ist die Lasten wert. („Klimaschutz rechtfertigt den Eingriff ins Eigentum.“)" : "The goal is worth the burdens. (“Climate protection justifies the intrusion into property rights.”)"}</li>
              <li><strong>{de ? "Also: Maßnahme" : "Therefore: the measure"}</strong> — {de ? "die Schlussfolgerung: Wir sollten M beschließen." : "the conclusion: we should adopt M."}</li>
            </ul>
            <p>
              {de
                ? "Das ist das Rückgrat, das auf der Karte links steht. Fast jeder Punkt, den irgendjemand in einer Konsultation vorbringt, greift eine dieser Prämissen an oder stützt sie — deshalb bekommt jeder Punkt einen Slot (P1–P4 oder „conclusion“). Wer die Prämisse trifft, an der ein Streit wirklich hängt, weiß, worüber eigentlich gestritten wird."
                : "That is the spine shown on the left of the map. Almost every point anyone raises in a consultation attacks or supports one of these premises — which is why every point gets a slot (P1–P4 or “conclusion”). Locate the premise a dispute actually hangs on, and you know what the fight is really about."}
            </p>
          </>
        ),
      },
      {
        h: de ? "2 · Die fünf kritischen Fragen" : "2 · The five critical questions",
        body: (
          <>
            <p>
              {de
                ? "Es gibt genau fünf Standardwege, dieses Grundargument anzugreifen. Auf der Karte erscheinen sie als Kanten zwischen Punkten („Bezüge“ im Detailfenster):"
                : "There are exactly five standard ways to attack this argument. On the map they appear as edges between points (“relations” in the detail panel):"}
            </p>
            <ol>
              <li><strong>{de ? "Empirie" : "Empirics"}:</strong> {de ? "Die Wirkung tritt gar nicht ein (greift P2/P3 mit Gegenevidenz an)." : "The effect will not occur (attacks P2/P3 with counter-evidence)."}</li>
              <li><strong>{de ? "Mildere Mittel" : "Milder means"}:</strong> {de ? "Ein sanfteres Mittel erreicht dasselbe Ziel („Förderung statt Pflicht“)." : "A gentler instrument reaches the same goal (“incentives instead of mandates”)."}</li>
              <li><strong>{de ? "Zielkonflikt" : "Goal conflict"}:</strong> {de ? "Die Wirkung schadet anderen Zielen (Mieten, Versorgungssicherheit)." : "The effect harms other goals (rents, security of supply)."}</li>
              <li><strong>{de ? "Umsetzbarkeit" : "Feasibility"}:</strong> {de ? "Es lässt sich real nicht umsetzen (Fachkräfte, Netze, Fristen)." : "It cannot actually be implemented (skilled labor, grids, deadlines)."}</li>
              <li><strong>{de ? "Wertprämisse" : "Value premise"}:</strong> {de ? "Das Ziel rechtfertigt die Lasten nicht (greift P4 an)." : "The goal does not justify the burdens (attacks P4)."}</li>
            </ol>
          </>
        ),
      },
      {
        h: de ? "3 · Punktarten und Zonen" : "3 · Point kinds and zones",
        body: (
          <>
            <p>
              {de
                ? "Der wichtigste Sortiergriff der ganzen Karte: Jeder Punkt wird danach eingeordnet, WAS ihn klären könnte. Daraus ergeben sich vier Arten — und die Zonen, in denen sie auf der Karte liegen:"
                : "The map's single most important sorting move: every point is classified by WHAT could settle it. That yields four kinds — and the zones where they live on the map:"}
            </p>
            <ul>
              <li>
                <span className="badge badge--fact">fact</span>{" "}
                <strong>{de ? "Tatsachenpunkt → Zone der Gutachter." : "Fact point → zone of the experts."}</strong>{" "}
                {de
                  ? "Eine empirisch überprüfbare Behauptung („Das Stromnetz muss verdrei- bis vervierfacht werden“). Streit hierüber ist im Prinzip kaufbar klärbar: ein Gutachten, eine Messung, eine Studie."
                  : "An empirically checkable claim (“the grid must be tripled or quadrupled”). Disputes here are in principle purchasable to resolve: a report, a measurement, a study."}
              </li>
              <li>
                <span className="badge badge--value">value</span>{" "}
                <strong>{de ? "Wertungspunkt → Zone des Rates." : "Value point → zone of the council."}</strong>{" "}
                {de
                  ? "Ein normatives Urteil, das keine Studie der Welt entscheiden kann („Wahlfreiheit hat Vorrang“). Hier hilft kein Gutachten — das muss das gewählte Gremium entscheiden und verantworten."
                  : "A normative judgment no study could ever settle (“freedom of choice comes first”). No expert report helps here — the elected body must decide and own it."}
              </li>
              <li>
                <span className="badge badge--design">design</span>{" "}
                <strong>{de ? "Ausgestaltungsvorschlag." : "Design proposal."}</strong>{" "}
                {de
                  ? "Ein konkreter Vorschlag, WIE die Maßnahme geformt werden soll (Übergangsfristen, Härtefallklauseln, Ausnahmen). Wichtig: Er wirkt erst NACH der Grundsatzentscheidung — deshalb steht die Zone unten."
                  : "A concrete proposal for HOW to shape the measure (transition periods, hardship clauses, exemptions). Crucially it only matters AFTER the basic decision — hence the zone sits at the bottom."}
              </li>
              <li>
                <span className="badge badge--design">gap</span>{" "}
                <strong>{de ? "Lücke." : "Gap."}</strong>{" "}
                {de
                  ? "Eine offene Frage, die jemand aufwirft und niemand beantwortet („Wie schlagen die Mehrkosten auf Mieten durch?“). Lücken sind erste Kandidaten für Gutachtenaufträge."
                  : "An open question someone raises and nobody answers (“how do the extra costs hit rents?”). Gaps are prime candidates for commissioning studies."}
              </li>
            </ul>
            <p>
              {de
                ? "Der Nutzen: Ein Entscheidungsgremium sieht auf einen Blick, welcher Teil des Streits abarbeitbar ist (Gutachterzone, Lücken) und welcher Teil eine echte, unvermeidbare politische Entscheidung ist (Ratszone). Niemand kann sich mehr hinter „weiterem Klärungsbedarf“ verstecken, wenn die Karte zeigt, dass die Fakten längst unstrittig sind."
                : "The payoff: a decision-making body sees at a glance which part of the dispute is workable (expert zone, gaps) and which part is a genuine, unavoidable political decision (council zone). Nobody can hide behind “further clarification needed” when the map shows the facts are already settled."}
            </p>
          </>
        ),
      },
      {
        h: de ? "4 · Von Rohdaten zur Karte: die Pipeline" : "4 · From raw data to the map: the pipeline",
        body: (
          <>
            <ol>
              <li>
                <strong>{de ? "Ernten." : "Harvest."}</strong>{" "}
                {de
                  ? "Ein Harvester lädt echte Konsultationsdaten: EU-„Have-Your-Say“-Fragebögen, Bundestags-Anhörungen, Ministeriums-Konsultationen (z. B. die 496 Stellungnahmen zur PV-Strategie). Keine synthetischen Daten."
                  : "A harvester pulls real consultation data: EU “Have Your Say” questionnaires, Bundestag hearings, ministry consultations (e.g. the 496 PV strategy submissions). No synthetic data."}
              </li>
              <li>
                <strong>{de ? "Dekomposition (LLM)." : "Decomposition (LLM)."}</strong>{" "}
                {de
                  ? "Ein Sprachmodell zerlegt jede Stellungnahme in einzelne Punkte: Art (fact/value/design/gap), Slot (P1–P4/conclusion), neutrale Formulierung — und zu jedem Punkt ein WÖRTLICHES Zitat aus dem Original als Beleg. Jeder Aufruf wird mit Prompt-Hash und Modell protokolliert."
                  : "A language model decomposes each submission into individual points: kind (fact/value/design/gap), slot (P1–P4/conclusion), neutral phrasing — and for each point a VERBATIM quote from the original as evidence. Every call is logged with prompt hash and model."}
              </li>
              <li>
                <strong>Matching.</strong>{" "}
                {de
                  ? "Für jeden neuen Punkt entscheidet das Modell: Sagt das jemand zum ersten Mal, oder ist es derselbe Punkt, den schon andere gemacht haben? Gleiche Punkte werden zusammengeführt — so trägt ein Punkt die Zitate VIELER Einreicher. Im Zweifel: lieber neu (falsches Zusammenlegen löscht eine Stimme)."
                  : "For each new point the model decides: is this said for the first time, or the same point others already made? Same points merge — so one point carries quotes from MANY submitters. When in doubt: keep it new (a false merge silences a voice)."}
              </li>
              <li>
                <strong>{de ? "KI-Redaktion." : "AI editorial review."}</strong>{" "}
                {de
                  ? "Ein Redaktions-Durchlauf prüft jeden Punktentwurf (verständlich? eine einzige Aussage? sachbezogen?) und gibt ihn frei oder weist ihn zurück — protokolliert als „ai-editor“. Menschen können in der Redaktionsansicht jederzeit übersteuern."
                  : "An editorial pass checks every draft point (comprehensible? a single claim? on-topic?) and releases or rejects it — logged as “ai-editor”. Humans can override any decision in the review screen."}
              </li>
              <li>
                <strong>Statements.</strong>{" "}
                {de
                  ? "Jeder freigegebene Punkt wird in ein abstimmbares Statement übersetzt: EIN klarer Aussagesatz, dem man zustimmen oder widersprechen kann, auf Deutsch und Englisch."
                  : "Every released point is rendered as a votable statement: ONE clear declarative sentence you can agree or disagree with, in German and English."}
              </li>
              <li>
                <strong>{de ? "Beteiligung: Votes — echt oder inferiert." : "Participation: votes — real or inferred."}</strong>{" "}
                {de
                  ? "Drei Quellen: (a) Fragebogen-Antworten aus EU-Konsultationen werden deterministisch auf Zustimmen/Ablehnen/Enthalten abgebildet — echte Voten von hunderten Teilnehmern. (b) Besucher können direkt auf der Plattform abstimmen. (c) Für Freitext-Konsultationen ohne Voten liest ein Modell jede Stellungnahme und beurteilt ihre Haltung zu jedem Statement (stützt / widerspricht / äußert sich nicht) — daraus entsteht eine inferierte Vote-Matrix. Inferierte Teilnehmer sind in den Daten als solche markiert."
                  : "Three sources: (a) questionnaire answers from EU consultations map deterministically to agree/disagree/pass — real votes from hundreds of participants. (b) Visitors can vote directly on the platform. (c) For free-form consultations without votes, a model reads each submission and judges its stance on every statement (supports / contradicts / silent) — producing an inferred vote matrix. Inferred participants are marked as such in the data."}
              </li>
              <li>
                <strong>{de ? "Analyse (deterministische Mathematik)." : "Analysis (deterministic math)."}</strong>{" "}
                {de
                  ? "Ab hier kein LLM mehr: Die Vote-Matrix durchläuft die Polis-Methodik — Hauptkomponentenanalyse, k-Means-Clustering (k per Silhouette gewählt), Signifikanztests je Lager. Gleicher Input ⇒ exakt gleiches Ergebnis, differentiell getestet gegen die Referenzimplementierung."
                  : "From here on, no LLM: the vote matrix runs through the Polis methodology — principal component analysis, k-means clustering (k chosen by silhouette), per-camp significance tests. Same input ⇒ exactly the same result, differentially tested against the reference implementation."}
              </li>
              <li>
                <strong>{de ? "Befunde und Diagnose." : "Findings and diagnosis."}</strong>{" "}
                {de
                  ? "Aus den Lagerprofilen werden Punkte klassifiziert (Brücke / Konfliktlinie / Offen) und die Karte als Ganzes diagnostiziert — siehe nächster Abschnitt."
                  : "Camp profiles classify each point (bridge / conflict line / open) and diagnose the map as a whole — next section."}
              </li>
            </ol>
          </>
        ),
      },
      {
        h: de ? "5 · Lager, Brücken, Konfliktlinien" : "5 · Camps, bridges, conflict lines",
        body: (
          <>
            <p>
              {de
                ? "Die Analyse gruppiert Teilnehmer mit ähnlichem Abstimmverhalten zu Lagern (G0, G1, …) — nicht nach Selbstauskunft, sondern nach tatsächlichem Votum. Für jedes Statement zeigt das Lagerprofil, wie viel Prozent jedes Lagers zustimmen:"
                : "The analysis groups participants with similar voting behavior into camps (G0, G1, …) — not by self-description, but by actual votes. For each statement the camp profile shows what share of each camp agrees:"}
            </p>
            <ul>
              <li><strong>{de ? "Brücke" : "Bridge"}:</strong> {de ? "ALLE Lager stimmen signifikant mehrheitlich zu (Schwelle: 60 %). Gemeinsamer Boden — hier kann man bauen." : "ALL camps significantly majority-agree (threshold: 60%). Common ground — you can build here."}</li>
              <li><strong>{de ? "Konfliktlinie" : "Conflict line"}:</strong> {de ? "Ein Lager stimmt zu, ein anderes lehnt ab oder verweigert sich trotz Beteiligung. Hier trennt sich der Streit." : "One camp agrees while another rejects or withholds despite engaging. This is where the dispute divides."}</li>
              <li><strong>{de ? "Offen" : "Open"}:</strong> {de ? "Noch kein klares Signal — zu wenig Beteiligung oder kein signifikantes Muster." : "No clear signal yet — too little participation or no significant pattern."}</li>
              <li>
                <strong>{de ? "Warnung: Brücke der Ergebnisse" : "Warning: bridge of results"}:</strong>{" "}
                {de
                  ? "Die feinste Unterscheidung der Karte: Alle Lager bejahen eine Schlussfolgerung — aber aus WIDERSPRÜCHLICHEN Gründen (die einen wollen Übergangsfristen, damit die Pflicht sauber kommt; die anderen, damit sie nie kommt). Solche Scheinbrücken zerbrechen bei der Umsetzung. Die Karte erkennt sie, indem sie prüft, ob auch die STÜTZENDEN Prämissen eines geeinten Schlusspunkts geeint sind („Brücke der Gründe“) oder umkämpft („Brücke der Ergebnisse“)."
                  : "The map's finest distinction: all camps affirm a conclusion — but for CONTRADICTORY reasons (some want transition periods so the mandate arrives cleanly; others so it never arrives). Such pseudo-bridges shatter during implementation. The map detects them by checking whether the SUPPORTING premises of an agreed conclusion are also agreed (“bridge of reasons”) or contested (“bridge of results”)."}
              </li>
            </ul>
          </>
        ),
      },
      {
        h: de ? "6 · Gesamtdiagnose und Sättigung" : "6 · Overall diagnosis and saturation",
        body: (
          <>
            <p>
              {de
                ? "Zwei Muster sind so wertvoll, dass die Karte sie als Gesamtdiagnose ausweist:"
                : "Two patterns are valuable enough that the map reports them as an overall diagnosis:"}
            </p>
            <ul>
              <li>
                <strong>{de ? "Wertkonflikt" : "Value conflict"}:</strong>{" "}
                {de
                  ? "Die Tatsachen sind geklärt oder ruhig — der Streit liegt in den Wertungspunkten. Konsequenz: KEINE weiteren Gutachten beauftragen (sie ändern nichts); die Entscheidung gehört ins politische Gremium."
                  : "The facts are settled or quiet — the dispute lives in the value points. Consequence: commission NO further studies (they change nothing); the decision belongs to the political body."}
              </li>
              <li>
                <strong>{de ? "Scheinfaktenstreit" : "Pseudo fact fight"}:</strong>{" "}
                {de
                  ? "Die Werte werden geteilt — eine Tatsachenfrage trennt die Lager. Konsequenz: Dieser Streit ist zum Preis eines Gutachtens auflösbar."
                  : "The values are shared — a factual question divides the camps. Consequence: this dispute is resolvable for the price of one expert report."}
              </li>
            </ul>
            <p>
              {de
                ? "Die Sättigung beantwortet die Frage „haben wir genug gelesen?“: Sie misst, welcher Anteil der Aussagen aus den zuletzt verarbeiteten Stellungnahmen bereits auf der Karte stand (Matching) statt neu zu sein. „Sättigung 20 %“ heißt: 80 % des zuletzt Gelesenen war noch neu — weiterlesen. Ab 65 % Wiedererkennung gilt die Karte als gesättigt: Neue Stellungnahmen wiederholen dann fast nur noch Bekanntes."
                : "Saturation answers “have we read enough?”: it measures what share of claims in the most recently processed submissions already existed on the map (matching) rather than being new. “Saturation 20%” means 80% of the latest reading was still new — keep going. From 65% recognition the map counts as saturated: new submissions then mostly repeat what is known."}
            </p>
          </>
        ),
      },
      {
        h: de ? "7 · Vertrauensarchitektur" : "7 · Trust architecture",
        body: (
          <>
            <p>
              {de
                ? "Drei Prinzipien halten das System ehrlich: (1) Provenienz — jeder Punkt trägt wörtliche Zitate mit Fundstelle; jeder LLM-Aufruf ist mit Modell und Prompt-Hash protokolliert; jede Freigabe, ob durch Mensch oder KI-Redaktion, steht im unveränderlichen Audit-Log. (2) Deterministischer Kern — alles ab der Vote-Matrix (Lager, Brücken, Diagnosen) ist reine, reproduzierbare Mathematik ohne Modell-Ermessen. (3) Inspizierbarkeit — sämtliche Prompts und Schwellwerte sind offen einsehbar:"
                : "Three principles keep the system honest: (1) Provenance — every point carries verbatim quotes with their source; every LLM call is logged with model and prompt hash; every release, human or AI-editorial, sits in an append-only audit log. (2) Deterministic core — everything from the vote matrix onward (camps, bridges, diagnoses) is pure, reproducible math with no model discretion. (3) Inspectability — all prompts and thresholds are open:"}{" "}
              <Link href={methodsHref}>{de ? "zur Methodik-Seite" : "see the methods page"}</Link>.
            </p>
          </>
        ),
      },
    ],
  };
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const c = content(locale, `/${locale}/methods`);
  return (
    <main className="page explainer">
      <h1>{c.title}</h1>
      <p className="explainer__lead">{c.lead}</p>
      {c.sections.map((s) => (
        <section key={s.h} className="explainer__section">
          <h2>{s.h}</h2>
          {s.body}
        </section>
      ))}
    </main>
  );
}
