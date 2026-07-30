import { getTranslations, setRequestLocale } from "next-intl/server";
import { desc, sql, consultations } from "@policy/db";

import { getDb } from "@/lib/db";
import { Link } from "@/navigation";

export const dynamic = "force-dynamic";

export default async function ConsultationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Map");
  const db = getDb();
  const rows = await db.select().from(consultations).orderBy(desc(consultations.createdAt));

  const enriched = [];
  for (const c of rows) {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM participants p WHERE p.consultation_id = ${c.id})::int AS participants,
        (SELECT count(*) FROM votes v JOIN participants p ON p.id = v.participant_id
          WHERE p.consultation_id = ${c.id})::int AS votes,
        (SELECT count(*) FROM points pt WHERE pt.consultation_id = ${c.id})::int AS points,
        (SELECT count(*) FROM submissions su WHERE su.consultation_id = ${c.id})::int AS submissions
    `);
    const s = result.rows[0] as {
      participants: number; votes: number; points: number; submissions: number;
    };
    enriched.push({ ...c, ...s });
  }

  return (
    <main className="page">
      <h1>{t("consultations")}</h1>
      {enriched.map((c) => (
        <Link key={c.id} href={`/consultations/${c.id}`} className="consultation-card">
          <h2>{c.title}</h2>
          <div className="stat-strip">
            {c.participants > 0 && (
              <span><strong>{c.participants}</strong> {t("participants")}</span>
            )}
            {c.votes > 0 && <span><strong>{c.votes}</strong> {t("votes")}</span>}
            {c.points > 0 && <span><strong>{c.points}</strong> {t("points")}</span>}
            {c.submissions > 0 && (
              <span><strong>{c.submissions}</strong> Stellungnahmen</span>
            )}
            <span><code>{c.sourceSystem ?? "manual"}</code></span>
          </div>
        </Link>
      ))}
    </main>
  );
}
