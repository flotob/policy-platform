/**
 * Confirming a staff member's e-mail address after sign-up with the shared code. The account works at once
 * (set up the town, write procedures, let the machine read); two things wait for the confirmation: making a
 * procedure public and inviting the team. Otherwise anyone with the code could act publicly in the name of
 * someone else's address. Accounts that came in by invitation are confirmed already: the invitation link
 * went to that address.
 *
 * The link is signed (no table needed) and names the address it was sent to, so it cannot confirm a
 * different one; it holds seven days. Clicking it opens a page with one button — mail scanners that open
 * every link do not confirm anything.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "@policy/db";

import { getDb } from "./db";
import { appUrl, sendMail, type MailResult } from "./mail";

const DAYS = 7;
const DAY = 86_400_000;

const sign = (userId: string, email: string, at: number) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`adresse|${userId}|${email.toLowerCase()}|${at}`).digest("base64url").slice(0, 32);

export function confirmLink(user: { id: string; email: string }, at = Date.now()): string {
  return appUrl(`/adresse-bestaetigen?u=${encodeURIComponent(user.id)}&z=${at}&t=${sign(user.id, user.email, at)}`);
}

export async function sendConfirmation(user: { id: string; name: string; email: string }): Promise<MailResult> {
  return sendMail({
    to: user.email,
    subject: "Bitte bestätigen Sie Ihre Adresse bei streit.bar",
    text: `Guten Tag ${user.name},

Sie haben bei streit.bar ein Konto angelegt. Bitte bestätigen Sie, dass diese Adresse Ihnen gehört:
${confirmLink(user)}

Einrichten können Sie schon jetzt alles. Eine Beteiligung freischalten und Ihr Team einladen können Sie, sobald die Adresse bestätigt ist. Der Link gilt ${DAYS} Tage.

Wenn Sie kein Konto angelegt haben, ignorieren Sie diese E-Mail. Dann passiert nichts.

streit.bar`,
  });
}

export type ConfirmState =
  | { kind: "ungueltig" }
  | { kind: "abgelaufen" }
  | { kind: "erledigt"; email: string }
  | { kind: "offen"; email: string };

/** What a confirmation link stands for: only links this server signed, for the address the account still has. */
export async function readConfirmation(userId: string, at: string, token: string): Promise<ConfirmState> {
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(userId) || !/^\d{10,16}$/.test(at)) return { kind: "ungueltig" };
  const u = (await getDb().execute(sql`SELECT email, email_verified FROM auth_user WHERE id = ${userId}`)).rows[0] as
    | { email: string; email_verified: boolean }
    | undefined;
  if (!u) return { kind: "ungueltig" };
  const want = Buffer.from(sign(userId, u.email, Number(at)));
  const got = Buffer.from(token);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { kind: "ungueltig" };
  if (u.email_verified) return { kind: "erledigt", email: u.email };
  if (Date.now() - Number(at) > DAYS * DAY) return { kind: "abgelaufen" };
  return { kind: "offen", email: u.email };
}

/** The button on the confirmation page: marks the address as confirmed (once), logged per town. */
export async function confirmAddress(userId: string, at: string, token: string): Promise<ConfirmState> {
  const s = await readConfirmation(userId, at, token);
  if (s.kind !== "offen") return s;
  const db = getDb();
  await db.transaction(async (tx) => {
    const r = await tx.execute(sql`
      UPDATE auth_user SET email_verified = true, updated_at = now()
      WHERE id = ${userId} AND lower(email) = ${s.email.toLowerCase()} AND NOT email_verified RETURNING id`);
    if (!r.rows.length) return;
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      SELECT m.tenant_id, ${`user:${userId}`}, 'account.address_confirmed', 'user', ${userId}, '{}'::jsonb
      FROM memberships m WHERE m.user_id = ${userId}`);
  });
  return { kind: "erledigt", email: s.email };
}

/**
 * Whether a town may be seen in public: someone in its team has confirmed their address. A town made with
 * the shared code by someone who never confirmed stays visible to its own team only.
 */
export const confirmedTown = (tenantAlias: string) => sql`
  EXISTS (SELECT 1 FROM memberships cm JOIN auth_user cu ON cu.id = cm.user_id WHERE cm.tenant_id = ${sql.raw(tenantAlias)}.id AND cu.email_verified)`;
