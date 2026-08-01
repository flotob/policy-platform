import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface AnalysisStatement {
  id: string;
  pointId: string;
  label: string;
  profile?: "bridged" | "divisive" | "open";
  groupAwareConsensusAgree?: number;
  perGroup: { group: number; pa: number; pd: number; ns: number }[];
}

interface Analysis {
  clustering: { k: number; silhouette: number; groupSizes: Record<string, number> };
  matrix: { participants: number; statements: number; votes: number };
  statements: AnalysisStatement[];
  diagnosisOverall: string | null;
  participantGroups: { group: number; authorType: string | null }[];
}

const spread = (s: AnalysisStatement) =>
  Math.max(...s.perGroup.map((g) => g.pa)) - Math.min(...s.perGroup.map((g) => g.pa));

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Report");
  const format = await getFormatter();
  const db = getDb();

  const consRes = await db.execute(
    sql`SELECT id, title, source_system, source_ref FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as {
    id: string;
    title: string;
    source_system: string | null;
    source_ref: string | null;
  };

  const runRes = await db.execute(sql`
    SELECT result FROM analysis_runs WHERE consultation_id = ${consultation.id}
    ORDER BY created_at DESC LIMIT 1
  `);
  const analysis = (runRes.rows[0]?.result ?? null) as Analysis | null;

  const pointsRes = await db.execute(sql`
    SELECT p.id, p.kind, p.label, p.summary,
      (SELECT count(*)::int FROM point_sources ps WHERE ps.point_id = p.id) AS n_sources,
      (SELECT json_build_object('quote', ps.quote, 'org', s.author_org)
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id AND ps.quote IS NOT NULL
       ORDER BY ps.created_at LIMIT 1) AS top_source
    FROM points p
    WHERE p.consultation_id = ${consultation.id}
      AND p.status = 'released' AND p.created_by <> 'import:questionnaire'
    ORDER BY n_sources DESC, p.created_at
  `);
  const points = pointsRes.rows as {
    id: string; kind: string; label: string; summary: string | null;
    n_sources: number;
    top_source: { quote: string; org: string | null } | null;
  }[];

  const subCountRes = await db.execute(
    sql`SELECT count(*)::int AS n FROM submissions WHERE consultation_id = ${consultation.id}`,
  );
  const subCount = (subCountRes.rows[0] as { n: number }).n;

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
    ? analysis.statements.filter((s) => s.profile === "bridged")
    : [];
  const divisive = analysis
    ? analysis.statements
        .filter((s) => s.profile === "divisive")
        .sort((a, b) => spread(b) - spread(a))
    : [];
  const diagKey =
    analysis?.diagnosisOverall === "value_conflict" ? "diagnosis_value_conflict"
    : analysis?.diagnosisOverall === "pseudo_fact_fight" ? "diagnosis_pseudo_fact_fight"
    : "diagnosis_mixed";

  const zones: [string, string][] = [
    ["factZone", "fact"],
    ["valueZone", "value"],
    ["designZone", "design"],
  ];

  return (
    <main className="page report">
      <header className="report__head">
        <p className="report__eyebrow">{t("title")}</p>
        <h1>{consultation.title}</h1>
        <p className="report__meta">
          {t("generated", { date: format.dateTime(new Date(), { dateStyle: "long" }) })}
          {consultation.source_ref && ` · ${consultation.source_system ?? ""} ${consultation.source_ref}`}
        </p>
      </header>

      <section className="report__section">
        <h2>{t("participation")}</h2>
        <div className="stat-strip">
          {analysis && (
            <>
              <span><strong>{analysis.matrix.participants}</strong> {t("participants")}</span>
              <span><strong>{analysis.matrix.votes}</strong> {t("votes")}</span>
              <span><strong>{analysis.clustering.k}</strong> {t("camps")}</span>
            </>
          )}
          {subCount > 0 && <span><strong>{subCount}</strong> {t("submissions")}</span>}
          {points.length > 0 && <span><strong>{points.length}</strong> {t("points")}</span>}
        </div>
      </section>

      {analysis && (
        <>
          <section className="report__section">
            <h2>{t("campsHeading")}</h2>
            <ul className="report__camps">
              {Object.entries(analysis.clustering.groupSizes).map(([g, n]) => {
                const types = [...(campTypes.get(Number(g)) ?? new Map<string, number>())]
                  .filter(([type]) => type !== "—" && type !== "?")
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([type, count]) => `${type} (${count})`)
                  .join(", ");
                return (
                  <li key={g}>
                    <strong>G{g}</strong> — {n} {t("campMembers")}
                    {types && `, ${t("mostly")}: ${types}`}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="report__section">
            <h2>✓ {t("bridgesHeading")}</h2>
            {bridged.length === 0 && <p className="placeholder-note">{t("bridgesEmpty")}</p>}
            <ol className="report__list">
              {bridged.slice(0, 10).map((s) => (
                <li key={s.id}>
                  {s.label}
                  <span className="report__figures">
                    {s.perGroup.map((g) => `G${g.group} ${Math.round(g.pa * 100)}%`).join(" · ")}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="report__section">
            <h2>⚡ {t("conflictsHeading")}</h2>
            <ol className="report__list">
              {divisive.slice(0, 10).map((s) => (
                <li key={s.id}>
                  {s.label}
                  <span className="report__figures">
                    {t("agree")}:{" "}
                    {s.perGroup.map((g) => `G${g.group} ${Math.round(g.pa * 100)}%`).join(" · ")}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="report__section">
            <h2>{t("diagnosisHeading")}</h2>
            <div className="zone zone--council">{t(diagKey)}</div>
          </section>
        </>
      )}

      {points.length > 0 && (
        <section className="report__section">
          <h2>{t("zonesHeading")}</h2>
          {zones.map(([key, kind]) => {
            const list = points.filter((p) => p.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind} className={`report__zone map-section--${kind}`}>
                <h3>{t(key as "factZone")} ({list.length})</h3>
                <ol className="report__list">
                  {list.slice(0, 12).map((p) => (
                    <li key={p.id}>
                      {p.label}
                      {p.n_sources > 1 && (
                        <span className="report__figures">{p.n_sources} {t("sources")}</span>
                      )}
                      {p.top_source && (
                        <blockquote className="quote">
                          „{p.top_source.quote}"
                          {p.top_source.org && <cite>— {p.top_source.org}</cite>}
                        </blockquote>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
      )}

      <footer className="report__footnote">{t("methodNote")}</footer>
    </main>
  );
}
