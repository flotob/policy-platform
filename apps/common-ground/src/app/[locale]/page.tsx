import { getTranslations, setRequestLocale } from "next-intl/server";

import { listReadyConsultations, loadConsultation } from "@/lib/data";
import { Link } from "@/navigation";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Catalog");

  const ready = await listReadyConsultations();
  const cards = [];
  for (const c of ready) {
    const bundle = await loadConsultation(c.ref);
    if (bundle) cards.push(bundle);
  }

  return (
    <main className="page">
      <section className="hero">
        <h1 className="hero__title">{t("title")}</h1>
        <p className="hero__lead">{t("lead")}</p>
      </section>

      {cards.length === 0 ? (
        <p className="empty">{t("empty")}</p>
      ) : (
        <div className="catalog">
          {cards.map((c) => (
            <Link key={c.id} href={`/konsultation/${c.ref}`} className="ccard">
              <h2 className="ccard__title">{c.title}</h2>
              <p className="ccard__camps">
                {t("camps", {
                  a: c.camps[0]?.name ?? "",
                  b: c.camps[1]?.name ?? "",
                })}
              </p>
              <p className="ccard__stats">
                {c.stats.submissions} {t("submissions")} ·{" "}
                {c.stats.participants} {t("participants")} · {c.stats.votes}{" "}
                {t("votes")}
              </p>
              <span className="ccard__cta">{t("open")} →</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
