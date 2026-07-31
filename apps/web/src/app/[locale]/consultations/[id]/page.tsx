import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";
import {
  ArgumentMap,
  type MapEdgeData,
  type MapPoint,
  type SaturationData,
} from "./argument-map";

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
  conclusions?: Record<string, "bridge_of_reasons" | "bridge_of_results" | "contested" | "open">;
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

  const votableRes = await db.execute(sql`
    SELECT count(*)::int AS n FROM statements st
    JOIN points p ON p.id = st.point_id
    WHERE p.consultation_id = ${consultation.id} AND st.status = 'released'
  `);
  const votable = (votableRes.rows[0] as { n: number }).n > 0;
  const tReport = await getTranslations("Report");
  const voteCta = (
    <p style={{ display: "flex", gap: "0.6rem" }}>
      {votable && (
        <Link className="button" href={`/${locale}/consultations/${consultation.id}/vote`}>
          {t("voteCta")}
        </Link>
      )}
      <Link
        className="button"
        style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }}
        href={`/${locale}/consultations/${consultation.id}/report`}
      >
        {tReport("reportCta")}
      </Link>
      <Link
        className="button"
        prefetch={false}
        style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--line)" }}
        href={`/${locale}/consultations/${consultation.id}/review`}
      >
        {t("reviewCta")}
      </Link>
    </p>
  );

  // Decomposed argument points (excluding questionnaire pseudo-points, which
  // are the analyzed statements themselves) with their canonical statement.
  const pointsRes = await db.execute(sql`
    SELECT p.id, p.kind, p.slot, p.label, p.summary, p.finding, p.status,
      (SELECT json_agg(json_build_object('quote', ps.quote, 'org', s.author_org))
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id) AS sources,
      canonical.id AS statement_id,
      COALESCE(loc.text, canonical.text) AS statement_text
    FROM points p
    LEFT JOIN LATERAL (
      SELECT st.id, st.text FROM statements st
      WHERE st.point_id = p.id AND st.status = 'released'
      ORDER BY st.locale LIMIT 1
    ) canonical ON true
    LEFT JOIN statements loc ON loc.point_id = p.id
      AND loc.locale = ${locale} AND loc.status = 'released'
    WHERE p.consultation_id = ${consultation.id}
      AND p.status IN ('draft', 'released')
      AND p.created_by <> 'import:questionnaire'
    ORDER BY p.created_at
  `);
  const rawPoints = pointsRes.rows as {
    id: string; kind: MapPoint["kind"]; slot: MapPoint["slot"]; label: string;
    summary: string | null; finding: string | null; status: string;
    sources: { quote: string | null; org: string | null }[] | null;
    statement_id: string | null; statement_text: string | null;
  }[];

  const edgesRes = await db.execute(sql`
    SELECT e.from_point, e.to_point, e.kind FROM point_edges e
    JOIN points p ON p.id = e.from_point
    WHERE p.consultation_id = ${consultation.id}
  `);
  const mapEdges: MapEdgeData[] = (edgesRes.rows as {
    from_point: string; to_point: string; kind: MapEdgeData["kind"];
  }[]).map((e) => ({ from: e.from_point, to: e.to_point, kind: e.kind }));

  const statementIds = rawPoints.map((p) => p.statement_id).filter(Boolean) as string[];
  const tallies = new Map<string, { agree: number; disagree: number; pass: number }>();
  if (statementIds.length > 0) {
    const tallyRes = await db.execute(sql`
      SELECT statement_id, value, count(*)::int AS n FROM votes
      WHERE statement_id IN ${statementIds}
      GROUP BY 1, 2
    `);
    for (const row of tallyRes.rows as { statement_id: string; value: number; n: number }[]) {
      const tl = tallies.get(row.statement_id) ?? { agree: 0, disagree: 0, pass: 0 };
      if (row.value === 1) tl.agree = row.n;
      else if (row.value === -1) tl.disagree = row.n;
      else tl.pass = row.n;
      tallies.set(row.statement_id, tl);
    }
  }

  const profileByPoint = new Map(
    (analysis?.statements ?? []).map((s) => [s.pointId, s]),
  );
  const mapPoints: MapPoint[] = rawPoints.map((p) => {
    const prof = profileByPoint.get(p.id);
    return {
      id: p.id,
      kind: p.kind,
      slot: p.slot,
      label: p.label,
      summary: p.summary,
      finding: p.finding,
      status: p.status,
      statement: p.statement_text,
      sources: p.sources ?? [],
      profile: prof?.profile,
      perGroup: prof?.perGroup,
      conclusionDiagnosis: analysis?.conclusions?.[p.id],
      tally: p.statement_id ? (tallies.get(p.statement_id) ?? null) : null,
    };
  });

  // Saturation: share of NEW points across the trailing window of
  // decomposed submissions (concept paper's stopping criterion).
  let saturation: SaturationData | null = null;
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
  const decomposedSubs = await db.execute(sql`
    SELECT count(DISTINCT submission_id)::int AS n FROM match_decisions
    WHERE consultation_id = ${consultation.id}
  `);
  if (sat && sat.total > 0 && (decomposedSubs.rows[0] as { n: number }).n >= 3) {
    const newRate = sat.new / sat.total;
    saturation = { newRate, window: 3, reached: newRate <= 0.35 };
  }

  const zonesBlock =
    mapPoints.length === 0 ? null : (
      <ArgumentMap
        title={consultation.title}
        points={mapPoints}
        edges={mapEdges}
        saturation={saturation}
      />
    );

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
        {voteCta}

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
        {zonesBlock}
      </main>
    );
  }

  // No analysis: decomposed argument map only.
  if (mapPoints.length === 0) {
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

  return (
    <main className="page">
      <h1>{consultation.title}</h1>
      <div className="stat-strip">
        <span><strong>{mapPoints.length}</strong> {t("points")}</span>
      </div>
      {voteCta}
      {zonesBlock}
      <p className="placeholder-note">{t("noAnalysis")}</p>
    </main>
  );
}
