import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { ConsultationBar } from "./app-top-bar";

export const dynamic = "force-dynamic";

/**
 * The consultation workspace: edge-to-edge app shell. Top bar carries
 * identity, the consultation switcher, and the views; the status bar keeps
 * the numbers and the last-analysis timestamp permanently visible.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const db = getDb();

  const consRes = await db.execute(
    sql`SELECT id, title FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as { id: string; title: string };

  const statsRes = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM points p WHERE p.consultation_id = ${consultation.id}
        AND p.status IN ('draft','released')
        AND p.created_by <> 'import:questionnaire')::int AS points,
      (SELECT count(*) FROM participants pa WHERE pa.consultation_id = ${consultation.id})::int AS participants,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${consultation.id})::int AS votes
  `);
  const stats = statsRes.rows[0] as { points: number; participants: number; votes: number };
  const runRes = await db.execute(sql`
    SELECT engine, created_at, (result->'clustering'->>'k')::int AS k,
           (result->'clustering'->>'silhouette')::float AS silhouette
    FROM analysis_runs WHERE consultation_id = ${consultation.id}
    ORDER BY created_at DESC LIMIT 1
  `);
  const run = runRes.rows[0] as
    | { engine: string; created_at: string; k: number; silhouette: number }
    | undefined;

  const t = await getTranslations("Map");
  const tShell = await getTranslations("AppShell");
  const format = await getFormatter();

  return (
    <div className="appshell">
      <SiteHeader />
      <ConsultationBar locale={locale} currentId={consultation.id} title={consultation.title} />
      <div className="appshell__main">{children}</div>
      <footer className="appshell__status">
        <span><strong>{stats.points}</strong> {t("points")}</span>
        <span><strong>{stats.participants}</strong> {t("participants")}</span>
        <span><strong>{stats.votes}</strong> {t("votes")}</span>
        {run && (
          <>
            <span><strong>{run.k}</strong> {t("camps")} · σ {run.silhouette?.toFixed(2)}</span>
            <span className="appshell__status-right">
              {tShell("analysis")}{" "}
              {format.dateTime(new Date(run.created_at), {
                dateStyle: "short",
                timeStyle: "short",
              })}{" "}
              · {run.engine}
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
