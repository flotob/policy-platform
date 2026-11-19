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
import { acceptInvite, createTenant, looksLikeEmail, normEmail, readInvite } from "@/lib/team";

export interface FormState {
  error?: string;
  values?: Record<string, string>;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** A municipality for the logged-in user: tenant + initiator membership. */
async function createMunicipality(userId: string, name: string): Promise<void> {
  const t = await createTenant(name, userId);
  await getDb().execute(sql`INSERT INTO memberships (user_id, tenant_id, role) VALUES (${userId}, ${t.id}, 'initiator')`);
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

/** "Passwort vergessen": always the same answer, whether an account exists or not. */
export async function requestReset(_prev: FormState, form: FormData): Promise<FormState> {
  const email = normEmail(field(form, "email"));
  if (!looksLikeEmail(email)) return { error: "Diese E-Mail-Adresse sieht nicht vollständig aus.", values: { email } };
  try {
    await auth.api.requestPasswordReset({ body: { email }, headers: await headers() });
  } catch (e) {
    if (!isAPIError(e)) console.error("[passwort-vergessen]", e);
  }
  redirect(`/passwort-vergessen?gesendet=1`);
}

export async function resetPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const token = field(form, "token");
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Das Passwort braucht mindestens 10 Zeichen." };
  if (password !== String(form.get("password2") ?? "")) return { error: "Die beiden Passwörter sind nicht gleich." };
  try {
    await auth.api.resetPassword({ body: { newPassword: password, token }, headers: await headers() });
  } catch (e) {
    if (isAPIError(e)) return { error: "Der Link gilt nicht mehr. Fordern Sie bitte einen neuen an." };
    console.error("[passwort-neu]", e);
    return { error: "Das hat nicht geklappt. Bitte versuchen Sie es noch einmal." };
  }
  redirect("/anmelden?passwort=neu");
}

/** Accept an invitation: join with an existing account, or create one with name and password. */
export async function acceptInvitation(_prev: FormState, form: FormData): Promise<FormState> {
  const token = field(form, "token");
  const values = { name: field(form, "name") };
  const inv = await readInvite(token);
  if (inv.state !== "offen") return { error: "Diese Einladung gilt nicht mehr. Bitten Sie um eine neue." };
  if (inv.hasAccount) {
    const r = await acceptInvite(token, null);
    if (!r.ok) return { error: r.error };
    redirect("/anmelden?einladung=angenommen");
  }
  const password = String(form.get("password") ?? "");
  if (values.name.length < 2) return { error: "Bitte geben Sie Ihren Namen an.", values };
  if (password.length < 10) return { error: "Das Passwort braucht mindestens 10 Zeichen.", values };
  if (password !== String(form.get("password2") ?? "")) return { error: "Die beiden Passwörter sind nicht gleich.", values };
  const r = await acceptInvite(token, { name: values.name, password });
  if (!r.ok) return { error: r.error, values };
  try {
    await auth.api.signInEmail({ body: { email: r.email, password }, headers: await headers() });
  } catch (e) {
    console.error("[einladung] sign-in after accepting", e);
    redirect("/anmelden?einladung=angenommen");
  }
  redirect("/verwaltung?willkommen=1");
}
