import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

function HelloMap() {
  const t = useTranslations("HelloMap");
  return (
    <main className="page">
      <h1>{t("title")}</h1>
      <p className="lede">{t("subtitle")}</p>
      <section className="zone zone--evidence">
        <strong>{t("zoneExperts")}</strong>
      </section>
      <section className="zone zone--council">
        <strong>{t("zoneCouncil")}</strong>
      </section>
      <p className="placeholder-note">{t("placeholder")}</p>
    </main>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HelloMap />;
}
