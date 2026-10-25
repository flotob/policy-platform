"use server";

import { sql } from "@policy/db";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { signupOpen } from "@/lib/auth-options";
import { demoLogin } from "@/lib/demo-login";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { RESERVED, slugify } from "@/lib/slug";

export interface FormState {
  error?: string;
  values?: Record<string, string>;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** A municipality for the logged-in user: tenant + initiator membership, slug kept free of app paths. */
async function createMunicipality(userId: string, name: string): Promise<void> {
  const db = getDb();
  let base = slugify(name.replace(/^(stadt|gemeinde|markt|landkreis|kreis)\s+/i, "")) || "kommune";
  if (RESERVED.has(base)) base = `${base}-kommune`;
  const taken = new Set(
    ((await db.execute(sql`SELECT slug FROM tenants WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`)).rows as { slug: string }[]).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  await db.transaction(async (tx) => {
    const t = await tx.execute(sql`INSERT INTO tenants (slug, name) VALUES (${slug}, ${name}) RETURNING id`);
    const tenantId = (t.rows[0] as { id: string }).id;
    await tx.execute(sql`INSERT INTO memberships (user_id, tenant_id, role) VALUES (${userId}, ${tenantId}, 'initiator')`);
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, ${`user:${userId}`}, 'tenant.create', 'tenant', ${tenantId}, ${JSON.stringify({ name, slug })})`);
  });
}

export async function register(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { name: field(form, "name"), email: field(form, "email"), kommune: field(form, "kommune") };
  if (!signupOpen()) return { error: "Neue Kommunen werden hier derzeit nur auf Anfrage freigeschaltet.", values };
  const password = String(form.get("password") ?? "");
  const session = await getSession();

  if (!session) {
    if (values.name.length < 2) return { error: "Bitte geben Sie Ihren Namen an.", values };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return { error: "Diese E-Mail-Adresse sieht nicht vollständig aus.", values };
    if (password.length < 10) return { error: "Das Passwort braucht mindestens 10 Zeichen.", values };
  }
  if (values.kommune.length < 3) return { error: "Bitte geben Sie den Namen Ihrer Kommune an.", values };

  let userId = session?.user.id;
  if (!userId) {
    try {
      const r = await auth.api.signUpEmail({ body: { name: values.name, email: values.email, password }, headers: await headers() });
      userId = r.user.id;
    } catch (e) {
      if (isAPIError(e) && /exist/i.test(e.message)) {
        return { error: "Zu dieser E-Mail-Adresse gibt es schon ein Konto. Melden Sie sich an.", values };
      }
      console.error("[registrieren]", e);
      return { error: "Das Konto ließ sich nicht anlegen. Bitte versuchen Sie es noch einmal.", values };
    }
  }
  await createMunicipality(userId, values.kommune);
  redirect("/verwaltung");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const values = { email: field(form, "email") };
  try {
    await auth.api.signInEmail({ body: { email: values.email, password: String(form.get("password") ?? "") }, headers: await headers() });
  } catch (e) {
    if (isAPIError(e)) return { error: "E-Mail-Adresse oder Passwort stimmt nicht.", values };
    console.error("[anmelden]", e);
    return { error: "Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es noch einmal.", values };
  }
  redirect("/verwaltung");
}

export async function logout(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

/** One click into the read-only demo account (the credentials are on the login page anyway). */
export async function loginDemo(): Promise<void> {
  const d = demoLogin();
  if (!d) redirect("/anmelden");
  await auth.api.signInEmail({ body: { email: d.email, password: d.password }, headers: await headers() });
  redirect("/verwaltung");
}
