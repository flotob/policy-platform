import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/navigation";

function HelloMap() {
  const t = useTranslations("HelloMap");
  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>{t("title")}</h1>
      <p style={{ color: "#6B6E76", marginTop: 0 }}>{t("subtitle")}</p>
      <section
        style={{
          border: "1px solid #185FA5",
          background: "#DCE9F6",
          color: "#0C447C",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <strong>{t("zoneExperts")}</strong>
      </section>
      <section
        style={{
          border: "1px solid #9A6A14",
          background: "#F7E8CB",
          color: "#633806",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <strong>{t("zoneCouncil")}</strong>
      </section>
      <p style={{ fontStyle: "italic", color: "#6B6E76" }}>{t("placeholder")}</p>
      <p>
        <Link href="/tenants">→ Tenants</Link>
      </p>
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
