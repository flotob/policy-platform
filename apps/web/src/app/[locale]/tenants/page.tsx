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
    <main className="page">
      <h1>{t("heading")}</h1>
      <form action={createTenant} className="form">
        <label className="field">
          <span className="field__label">{t("nameLabel")}</span>
          <input name="name" required minLength={2} />
        </label>
        <label className="field">
          <span className="field__label">{t("slugLabel")}</span>
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" />
        </label>
        <button type="submit" className="button">
          {t("submit")}
        </button>
      </form>
      <ul className="record-list">
        {existing.map((tenant) => (
          <li key={tenant.id}>
            <strong>{tenant.name}</strong> <code>{tenant.slug}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
