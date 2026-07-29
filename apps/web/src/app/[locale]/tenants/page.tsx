import { getTranslations, setRequestLocale } from "next-intl/server";
import { desc, tenants } from "@policy/db";

import { getDb } from "@/lib/db";
import { createTenant } from "./actions";

export const dynamic = "force-dynamic";

export default async function TenantsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Tenants");
  const existing = await getDb()
    .select()
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(20);

  return (
    <main style={{ maxWidth: "32rem", margin: "0 auto" }}>
      <h1>{t("heading")}</h1>
      <form
        action={createTenant}
        style={{ display: "grid", gap: "0.75rem", marginBottom: "2rem" }}
      >
        <label>
          {t("nameLabel")}
          <br />
          <input name="name" required minLength={2} style={{ width: "100%" }} />
        </label>
        <label>
          {t("slugLabel")}
          <br />
          <input
            name="slug"
            required
            pattern="[a-z0-9][a-z0-9-]+[a-z0-9]"
            style={{ width: "100%" }}
          />
        </label>
        <button type="submit">{t("submit")}</button>
      </form>
      <ul>
        {existing.map((tenant) => (
          <li key={tenant.id}>
            <strong>{tenant.name}</strong> <code>({tenant.slug})</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
