import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface AnalysisStatement {
  id: string;
  pointId: string;
  label: string;
  profile?: "bridged" | "divisive" | "open";
  perGroup: { group: number; pa: number; pd: number; ns: number }[];
}

interface Analysis {
  clustering: { k: number; silhouette: number; groupSizes: Record<string, number> };
  matrix: { participants: number; statements: number; votes: number };
  statements: AnalysisStatement[];
  diagnosisOverall: string | null;
  campNames?: Record<string, { name: string; summary?: string }>;
  participantGroups: { group: number; authorType: string | null }[];
}

const spread = (s: AnalysisStatement) =>
  Math.max(...s.perGroup.map((g) => g.pa)) - Math.min(...s.perGroup.map((g) => g.pa));

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const de = locale !== "en";
  const db = getDb();
  const format = await getFormatter();

  const consRes = await db.execute(sql`
    SELECT id, title, source_system, source_ref, created_at
    FROM consultations WHERE id::text = ${id}
  `);
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as {
    id: string; title: string; source_system: string | null;
    source_ref: string | null; created_at: string;
  };

  const runRes = await db.execute(sql`
    SELECT result, created_at FROM analysis_runs
    WHERE consultation_id = ${consultation.id}
    ORDER BY created_at DESC LIMIT 1
  `);
  const analysis = (runRes.rows[0]?.result ?? null) as Analysis | null;
  const analysisAt = runRes.rows[0]?.created_at as string | undefined;

  const numsRes = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM submissions s WHERE s.consultation_id = ${consultation.id})::int AS submissions,
      (SELECT count(*) FROM points p WHERE p.consultation_id = ${consultation.id}
        AND p.status IN ('draft','released') AND p.created_by <> 'import:questionnaire')::int AS points,
      (SELECT count(*) FROM participants pa WHERE pa.consultation_id = ${consultation.id})::int AS participants,
      (SELECT count(*) FROM participants pa WHERE pa.consultation_id = ${consultation.id}
        AND pa.source_ref LIKE 'inferred:%')::int AS inferred,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${consultation.id})::int AS votes
  `);
  const nums = numsRes.rows[0] as {
    submissions: number; points: number; participants: number;
    inferred: number; votes: number;
  };

  const zoneRes = await db.execute(sql`
    SELECT p.kind, count(*)::int AS n FROM points p
    WHERE p.consultation_id = ${consultation.id}
      AND p.status IN ('draft','released') AND p.created_by <> 'import:questionnaire'
    GROUP BY p.kind
  `);
  const zones = Object.fromEntries(
    (zoneRes.rows as { kind: string; n: number }[]).map((r) => [r.kind, r.n]),
  ) as Record<string, number>;

  const themeRes = await db.execute(sql`
    SELECT p.theme, count(*)::int AS n FROM points p
    WHERE p.consultation_id = ${consultation.id} AND p.theme IS NOT NULL
      AND p.status IN ('draft','released')
    GROUP BY p.theme ORDER BY n DESC LIMIT 14
  `);
  const themes = themeRes.rows as { theme: string; n: number }[];

  const satRes = await db.execute(sql`
    SELECT count(*) FILTER (WHERE outcome = 'new')::int AS new, count(*)::int AS total
    FROM match_decisions
    WHERE submission_id IN (
      SELECT submission_id FROM match_decisions
      WHERE consultation_id = ${consultation.id}
      GROUP BY submission_id ORDER BY min(created_at) DESC LIMIT 3
    )
  `);
  const sat = satRes.rows[0] as { new: number; total: number } | undefined;
  const saturation =
    sat && sat.total > 0 ? Math.round((1 - sat.new / sat.total) * 100) : null;

  const campTypes = new Map<number, Map<string, number>>();
  if (analysis) {
    for (const p of analysis.participantGroups) {
      const type = p.authorType ?? "—";
      const camp = campTypes.get(p.group) ?? new Map();
      camp.set(type, (camp.get(type) ?? 0) + 1);
      campTypes.set(p.group, camp);
    }
  }
  const bridged = analysis
    ? analysis.statements.filter((s) => s.profile === "bridged").sort((a, b) => spread(a) - spread(b))
    : [];
  const divisive = analysis
    ? analysis.statements.filter((s) => s.profile === "divisive").sort((a, b) => spread(b) - spread(a))
    : [];
  const campName = (g: string | number) =>
    analysis?.campNames?.[String(g)]?.name ?? `G${g}`;

  const diag = analysis?.diagnosisOverall;
  const diagText = de
    ? diag === "value_conflict"
      ? "Wertkonflikt: Die Faktenbasis ist geklärt oder ruhig — der Streit ist normativ. Weitere Gutachten helfen nicht; die Entscheidung gehört ins politische Gremium."
      : diag === "pseudo_fact_fight"
        ? "Scheinfaktenstreit: Die Werte werden geteilt — eine Tatsachenfrage trennt die Lager. Auflösbar zum Preis eines Gutachtens."
        : "Gemischt: Sowohl Tatsachen- als auch Wertfragen trennen die Lager — ein Teil des Streits ist durch Evidenz klärbar, ein Teil muss politisch entschieden werden."
    : diag === "value_conflict"
      ? "Value conflict: the facts are settled or quiet — the dispute is normative. More studies won't help; the decision belongs to the political body."
      : diag === "pseudo_fact_fight"
        ? "Pseudo fact fight: values are shared — a factual question divides the camps. Resolvable for the price of one expert report."
        : "Mixed: both factual and value questions divide the camps — part of this dispute is resolvable by evidence, part must be decided politically.";

  const pct = (g: { pa: number }) => `${Math.round(g.pa * 100)}%`;
  const zoneCards = [
    { key: "fact", n: zones.fact ?? 0, cls: "fact",
      title: de ? "Tatsachenpunkte" : "Fact points",
      text: de ? "durch Evidenz klärbar — Zone der Gutachter" : "resolvable by evidence — zone of the experts" },
    { key: "value", n: zones.value ?? 0, cls: "value",
      title: de ? "Wertungspunkte" : "Value points",
      text: de ? "politisch zu entscheiden — Zone des Rates" : "politically decided — zone of the council" },
    { key: "design", n: zones.design ?? 0, cls: "design",
      title: de ? "Ausgestaltung" : "Design proposals",
      text: de ? "wirken erst nach der Grundsatzentscheidung" : "matter only after the basic decision" },
    { key: "gap", n: zones.gap ?? 0, cls: "gap",
      title: de ? "Lücken" : "Gaps",
      text: de ? "aufgeworfene, unbeantwortete Fragen" : "raised but unanswered questions" },
  ];

  const methodSteps: [string, string][] = de
    ? [
        ["Ernten", "Echte Konsultationsdaten (keine synthetischen Teilnehmer)."],
        ["Zerlegen", "Ein Sprachmodell extrahiert einzelne Punkte — jeder mit wörtlichem Zitat als Beleg."],
        ["Zusammenführen", "Gleiche Punkte verschiedener Einreicher werden zu einem Punkt mit vielen Quellen."],
        ["Redaktion", "Eine KI-Redaktion gibt Punkte und Statements frei; jede Entscheidung ist protokolliert und übersteuerbar."],
        ["Abstimmen", "Echte Voten (Fragebögen, Plattform) oder aus Freitext inferierte Haltungen — als solche markiert."],
        ["Analysieren", "Deterministische Mathematik (PCA, k-Means, Signifikanztests) findet Lager, Brücken, Konfliktlinien — reproduzierbar, ohne Modell-Ermessen."],
      ]
    : [
        ["Harvest", "Real consultation data (no synthetic participants)."],
        ["Decompose", "A language model extracts individual points — each with a verbatim quote as evidence."],
        ["Merge", "The same point from different submitters becomes one point with many sources."],
        ["Review", "An AI editorial pass releases points and statements; every decision is logged and overridable."],
        ["Vote", "Real votes (questionnaires, platform) or stances inferred from free text — marked as such."],
        ["Analyze", "Deterministic math (PCA, k-means, significance tests) finds camps, bridges, conflict lines — reproducible, no model discretion."],
      ];

  return (
    <main className="appview overview">
      <header className="overview__head">
        <h1>{consultation.title}</h1>
        <p className="overview__meta">
          {consultation.source_system ?? "manual"}
          {consultation.source_ref && ` · ${consultation.source_ref}`}
          {analysisAt &&
            ` · ${de ? "Analyse" : "analysis"} ${format.dateTime(new Date(analysisAt), { dateStyle: "medium" })}`}
        </p>
        <p className="overview__lead">
          {de
            ? `${nums.submissions.toLocaleString("de-DE")} Einreichungen wurden in ${nums.points.toLocaleString("de-DE")} unterscheidbare Punkte zerlegt. ${nums.participants.toLocaleString("de-DE")} Teilnehmende haben ${nums.votes.toLocaleString("de-DE")} Voten abgegeben${nums.inferred > 0 ? ` (davon ${nums.inferred} Haltungsprofile, die maschinell aus Freitext-Stellungnahmen abgeleitet wurden)` : ""}${analysis ? ` — daraus ergeben sich ${analysis.clustering.k} Lager` : ""}.`
            : `${nums.submissions.toLocaleString("en-US")} submissions were decomposed into ${nums.points.toLocaleString("en-US")} distinct points. ${nums.participants.toLocaleString("en-US")} participants cast ${nums.votes.toLocaleString("en-US")} votes${nums.inferred > 0 ? ` (including ${nums.inferred} stance profiles machine-inferred from free-text submissions)` : ""}${analysis ? ` — yielding ${analysis.clustering.k} camps` : ""}.`}
        </p>
        <div className="overview__ctas">
          <Link className="button" href={`/${locale}/consultations/${consultation.id}/map`}>
            {de ? "Zur Landkarte" : "Open the map"}
          </Link>
          <Link
            className="button button--secondary"
            href={`/${locale}/consultations/${consultation.id}/vote`}
          >
            {de ? "Abstimmen" : "Vote"}
          </Link>
        </div>
      </header>

      {analysis && (
        <section className="overview__section">
          <h2>{de ? "Die Lager" : "The camps"}</h2>
          <div className="overview__camps">
            {Object.entries(analysis.clustering.groupSizes).map(([g, n]) => {
              const named = analysis.campNames?.[g];
              const types = [...(campTypes.get(Number(g)) ?? new Map<string, number>())]
                .filter(([type]) => type !== "—" && type !== "?")
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([type, count]) => `${type} (${count})`)
                .join(", ");
              return (
                <article key={g} className="overview__camp">
                  <h3>{named?.name ?? `G${g}`}</h3>
                  <p className="overview__camp-size">
                    {n} {de ? "Mitglieder" : "members"}
                    {types && ` · ${types}`}
                  </p>
                  {named?.summary && <p>{named.summary}</p>}
                </article>
              );
            })}
          </div>
          <p className="overview__note">
            {de
              ? "Lager sind keine Selbstzuordnung: Die Analyse gruppiert Teilnehmende allein nach ähnlichem Abstimmverhalten. Die Namen sind beschreibende Etiketten, die aus Zusammensetzung und den prägendsten Statements jedes Lagers generiert wurden."
              : "Camps are not self-declared: the analysis groups participants purely by similar voting behavior. The names are descriptive labels generated from each camp's composition and its most characteristic statements."}
          </p>
        </section>
      )}

      {analysis && (
        <section className="overview__section">
          <h2>{de ? "Diagnose" : "Diagnosis"}</h2>
          <div className="zone zone--council">{diagText}</div>
        </section>
      )}

      {analysis && bridged.length > 0 && (
        <section className="overview__section">
          <h2>✓ {de ? "Die tragfähigsten Brücken" : "The strongest bridges"} ({bridged.length})</h2>
          <ol className="overview__list">
            {bridged.slice(0, 5).map((s) => (
              <li key={s.id}>
                {s.label}
                <span className="overview__figures">
                  {s.perGroup.map((g) => `${campName(g.group)}: ${pct(g)}`).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {analysis && divisive.length > 0 && (
        <section className="overview__section">
          <h2>⚡ {de ? "Die tiefsten Konfliktlinien" : "The deepest conflict lines"} ({divisive.length})</h2>
          <ol className="overview__list">
            {divisive.slice(0, 5).map((s) => (
              <li key={s.id}>
                {s.label}
                <span className="overview__figures">
                  {s.perGroup.map((g) => `${campName(g.group)}: ${pct(g)}`).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {themes.length > 0 && (
        <section className="overview__section">
          <h2>{de ? "Worum es geht: die Themen" : "What it's about: the themes"}</h2>
          <div className="overview__themes">
            {themes.map((th) => (
              <span key={th.theme} className="overview__themechip">
                {th.theme} <em>{th.n}</em>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="overview__section">
        <h2>{de ? "Die Landkarte in Zahlen" : "The map in numbers"}</h2>
        <div className="overview__zones">
          {zoneCards.map((z) => (
            <article key={z.key} className={`overview__zonecard overview__zonecard--${z.cls}`}>
              <strong>{z.n}</strong>
              <h3>{z.title}</h3>
              <p>{z.text}</p>
            </article>
          ))}
        </div>
        {saturation !== null && (
          <p className="overview__note">
            {de
              ? `Sättigung ${saturation} %: ${saturation} % der Aussagen aus den zuletzt verarbeiteten Einreichungen standen bereits auf der Karte. ${saturation >= 65 ? "Die Karte gilt als gesättigt — neue Einreichungen wiederholen überwiegend Bekanntes." : "Die Karte wächst noch — weitere Einreichungen bringen weiterhin Neues."}`
              : `Saturation ${saturation}%: ${saturation}% of the claims in the most recently processed submissions already existed on the map. ${saturation >= 65 ? "The map counts as saturated — new submissions mostly repeat what is known." : "The map is still growing — further submissions keep adding new material."}`}
          </p>
        )}
      </section>

      <section className="overview__section">
        <h2>{de ? "Wie diese Seite entsteht" : "How this page is made"}</h2>
        <ol className="overview__method">
          {methodSteps.map(([h, p]) => (
            <li key={h}>
              <strong>{h}.</strong> {p}
            </li>
          ))}
        </ol>
        <p className="overview__note">
          {de ? (
            <>Ausführlich: <Link href={`/${locale}/how-it-works`}>So funktioniert’s</Link> · alle Prompts und Schwellwerte: <Link href={`/${locale}/methods`}>Methodik</Link>. Jeder Punkt trägt wörtliche Zitate; jeder Verarbeitungsschritt steht im Audit-Log.</>
          ) : (
            <>In depth: <Link href={`/${locale}/how-it-works`}>How it works</Link> · all prompts and thresholds: <Link href={`/${locale}/methods`}>Methods</Link>. Every point carries verbatim quotes; every processing step sits in the audit log.</>
          )}
        </p>
      </section>
    </main>
  );
}
