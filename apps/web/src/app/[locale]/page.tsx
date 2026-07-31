import { getTranslations, setRequestLocale } from "next-intl/server";
import { desc, sql, consultations } from "@policy/db";

import { getDb } from "@/lib/db";
import { Link } from "@/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const tMap = await getTranslations("Map");
  const db = getDb();
  const rows = await db
    .select()
    .from(consultations)
    .orderBy(desc(consultations.createdAt));

  const enriched = [];
  for (const c of rows) {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM participants p WHERE p.consultation_id = ${c.id})::int AS participants,
        (SELECT count(*) FROM votes v JOIN participants p ON p.id = v.participant_id
          WHERE p.consultation_id = ${c.id})::int AS votes,
        (SELECT count(*) FROM points pt WHERE pt.consultation_id = ${c.id})::int AS points
    `);
    enriched.push({
      ...c,
      ...(result.rows[0] as { participants: number; votes: number; points: number }),
    });
  }

  return (
    <main className="page home">
      <section className="home__hero">
        <p className="home__eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="home__lead">{t("lead")}</p>
        <div className="home__ctas">
          <Link className="button" href="/consultations">
            {t("ctaConsultations")}
          </Link>
          <Link
            className="button"
            style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }}
            href="/how-it-works"
          >
            {t("ctaHow")}
          </Link>
        </div>
      </section>

      <section className="home__promise">
        <div className="zone zone--evidence">
          <strong>{t("zoneExpertsTitle")}</strong> — {t("zoneExpertsText")}
        </div>
        <div className="zone zone--council">
          <strong>{t("zoneCouncilTitle")}</strong> — {t("zoneCouncilText")}
        </div>
      </section>

      <section>
        <h2>{t("liveHeading")}</h2>
        {enriched.map((c) => (
          <Link key={c.id} href={`/consultations/${c.id}`} className="consultation-card">
            <h2>{c.title}</h2>
            <div className="stat-strip">
              {c.participants > 0 && (
                <span><strong>{c.participants}</strong> {tMap("participants")}</span>
              )}
              {c.votes > 0 && <span><strong>{c.votes}</strong> {tMap("votes")}</span>}
              {c.points > 0 && <span><strong>{c.points}</strong> {tMap("points")}</span>}
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
