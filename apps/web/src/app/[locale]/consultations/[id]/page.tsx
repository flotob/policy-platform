import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
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

/** Strip the shared question prefix so matrix items become readable labels. */
function displayLabels(statements: AnalysisStatement[]): Map<string, string> {
  const texts = statements.map((s) => s.label);
  let prefix = texts[0] ?? "";
  for (const t of texts) {
    while (prefix && !t.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.length > 40 ? prefix.length : 0;
  return new Map(
    statements.map((s) => {
      let label = s.label.slice(cut).replace(/^[\s\p{P}]+/u, "");
      if (!label) label = s.label;
      return [s.id, label.charAt(0).toUpperCase() + label.slice(1)];
    }),
  );
}

function GroupBars({ perGroup }: { perGroup: AnalysisStatement["perGroup"] }) {
  return (
    <span className="groupbars">
      {perGroup.map((g) => {
        const pct = Math.round(g.pa * 100);
        const mod = pct < 40 ? "groupbar--low" : pct < 60 ? "groupbar--mid" : "";
        return (
          <span key={g.group} className={`groupbar ${mod}`} title={`G${g.group}: ${pct}%`}>
            <i style={{ width: `${pct}%` }} />
          </span>
        );
      })}
    </span>
  );
}

export default async function MapPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Map");
  const db = getDb();

  const consRes = await db.execute(
    sql`SELECT id, title FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as { id: string; title: string };

  const runRes = await db.execute(sql`
    SELECT result FROM analysis_runs WHERE consultation_id = ${consultation.id}
    ORDER BY created_at DESC LIMIT 1
  `);
  const analysis = (runRes.rows[0]?.result ?? null) as Analysis | null;

  if (analysis) {
    const labels = displayLabels(analysis.statements);
    const bridged = analysis.statements.filter((s) => s.profile === "bridged");
    const divisive = analysis.statements
      .filter((s) => s.profile === "divisive")
      .sort((a, b) => {
        const spread = (x: AnalysisStatement) =>
          Math.max(...x.perGroup.map((g) => g.pa)) - Math.min(...x.perGroup.map((g) => g.pa));
        return spread(b) - spread(a);
      });
    const open = analysis.statements.filter(
      (s) => s.profile !== "bridged" && s.profile !== "divisive",
    );

    const campTypes = new Map<number, Map<string, number>>();
    for (const p of analysis.participantGroups) {
      const type = p.authorType ?? "—";
      const camp = campTypes.get(p.group) ?? new Map();
      camp.set(type, (camp.get(type) ?? 0) + 1);
      campTypes.set(p.group, camp);
    }

    const diagKey =
      analysis.diagnosisOverall === "value_conflict" ? "diagnosis_value_conflict"
      : analysis.diagnosisOverall === "pseudo_fact_fight" ? "diagnosis_pseudo_fact_fight"
      : "diagnosis_mixed";

    const renderChips = (list: AnalysisStatement[], mod: string) =>
      list.map((s) => (
        <details key={s.id} className={`chip chip--${mod}`}>
          <summary>
            <span className="chip__label">{labels.get(s.id)}</span>
            <GroupBars perGroup={s.perGroup} />
          </summary>
          <div className="chip__detail">
            <p className="chip__question">{s.label}</p>
            <p>
              {t("agreeByCamp")}:{" "}
              {s.perGroup
                .map((g) => `G${g.group} ${Math.round(g.pa * 100)}% (n=${g.ns})`)
                .join(" · ")}
            </p>
          </div>
        </details>
      ));

    return (
      <main className="page">
        <h1>{consultation.title}</h1>
        <div className="stat-strip">
          <span><strong>{analysis.matrix.participants}</strong> {t("participants")}</span>
          <span><strong>{analysis.matrix.votes}</strong> {t("votes")}</span>
          <span><strong>{analysis.clustering.k}</strong> {t("camps")}</span>
          <span>Silhouette <strong>{analysis.clustering.silhouette.toFixed(2)}</strong></span>
        </div>

        <div className="grouplegend">
          <strong>{t("campLegend")}:</strong>
          {Object.entries(analysis.clustering.groupSizes).map(([g, n]) => {
            const types = [...(campTypes.get(Number(g)) ?? new Map<string, number>())]
              .filter(([type]) => type !== "—" && type !== "?")
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([type, count]) => `${type} ${count}`)
              .join(", ");
            return (
              <span key={g}>
                <strong>G{g}</strong> — {n} {t("campMembers")}
                {types ? ` (${types}, …)` : ""}
              </span>
            );
          })}
        </div>

        <section className="map-section map-section--conflict">
          <h2>⚡ {t("conflicts")} ({divisive.length})</h2>
          {renderChips(divisive, "conflict")}
        </section>
        {bridged.length > 0 && (
          <section className="map-section map-section--bridge">
            <h2>✓ {t("bridges")} ({bridged.length})</h2>
            {renderChips(bridged, "bridge")}
          </section>
        )}
        <section className="map-section map-section--open">
          <h2>{t("open")} ({open.length})</h2>
          {renderChips(open, "open")}
        </section>

        <div className="zone zone--council">
          <strong>{t("diagnosis")}:</strong> {t(diagKey)}
        </div>
      </main>
    );
  }

  // No analysis: decomposed argument map (points from submissions, by kind).
  const pointsRes = await db.execute(sql`
    SELECT p.id, p.kind, p.slot, p.label, p.summary, p.status,
      (SELECT json_agg(json_build_object('quote', ps.quote, 'org', s.author_org))
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id) AS sources
    FROM points p WHERE p.consultation_id = ${consultation.id}
    ORDER BY p.created_at
  `);
  const points = pointsRes.rows as {
    id: string; kind: string; slot: string | null; label: string;
    summary: string | null; status: string;
    sources: { quote: string | null; org: string | null }[] | null;
  }[];
  if (points.length === 0) {
    const subCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM submissions WHERE consultation_id = ${consultation.id}`,
    );
    return (
      <main className="page">
        <h1>{consultation.title}</h1>
        <div className="stat-strip">
          <span><strong>{(subCount.rows[0] as { n: number }).n}</strong> Stellungnahmen</span>
        </div>
        <p className="placeholder-note">{t("noAnalysis")}</p>
      </main>
    );
  }

  const byKind = (kind: string) => points.filter((p) => p.kind === kind);
  const sections: [string, string, typeof points][] = [
    ["factZone", "fact", byKind("fact")],
    ["valueZone", "value", byKind("value")],
    ["designZone", "design", byKind("design")],
  ];
  return (
    <main className="page">
      <h1>{consultation.title}</h1>
      <div className="stat-strip">
        <span><strong>{points.length}</strong> {t("points")}</span>
      </div>
      {sections.map(([key, mod, list]) =>
        list.length === 0 ? null : (
          <section key={key} className={`map-section map-section--${mod}`}>
            <h2>{t(key as "factZone")} ({list.length})</h2>
            {list.map((p) => (
              <details key={p.id} className={`chip chip--${mod}`}>
                <summary>
                  <span className="chip__label">{p.label}</span>
                  {p.slot && <span className={`badge badge--${mod}`}>{p.slot}</span>}
                  {p.status === "draft" && <span className="badge badge--draft">draft</span>}
                </summary>
                <div className="chip__detail">
                  {p.summary && <p>{p.summary}</p>}
                  {(p.sources ?? []).slice(0, 3).map((s2, i) =>
                    s2.quote ? (
                      <blockquote key={i} className="quote">
                        „{s2.quote}"
                        {s2.org && <cite>— {s2.org}</cite>}
                      </blockquote>
                    ) : null,
                  )}
                </div>
              </details>
            ))}
          </section>
        ),
      )}
      <p className="placeholder-note">{t("noAnalysis")}</p>
    </main>
  );
}
