/**
 * Team accounts: a municipality invites its staff by email; platform admins set up new
 * municipalities and invite their first person. Sign-up stays closed — every account starts
 * with an invitation. The emailed link carries a random token; only its SHA-256 is stored, and
 * the token is the proof that the person owns the address.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql } from "@policy/db";
import { hashPassword } from "better-auth/crypto";

import { getDb } from "./db";
import { demoLogin } from "./demo-login";
import { appUrl, sendMail } from "./mail";
import type { Role } from "./session";
import { RESERVED, slugify } from "./slug";

export const ROLES: Role[] = ["initiator", "redaktion", "betrachter"];

export const ROLE_LABEL: Record<Role, string> = {
  initiator: "Initiatorin oder Initiator",
  redaktion: "Redaktion",
  betrachter: "Nur ansehen",
};

export const ROLE_TEXT: Record<Role, string> = {
  initiator: "legt Verfahren an, ändert und eröffnet sie, lädt Kolleginnen und Kollegen ein",
  redaktion: "prüft die Beiträge und gibt sie frei",
  betrachter: "sieht alles, ändert nichts",
};

const INVITE_DAYS = 7;
const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

export const normEmail = (e: string) => e.trim().toLowerCase();
export const looksLikeEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const isDemo = (email: string) => normEmail(email) === normEmail(demoLogin()?.email ?? "");

/** Platform admins (env PLATFORM_ADMINS, comma-separated email addresses) set up new municipalities. */
export function isPlatformAdmin(email: string): boolean {
  const list = (process.env.PLATFORM_ADMINS ?? "").split(",").map(normEmail).filter(Boolean);
  return list.includes(normEmail(email));
}

async function audit(tenantId: string, actor: string, action: string, subjectKind: string, subjectId: string, payload: unknown) {
  await getDb().execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${tenantId}, ${actor}, ${action}, ${subjectKind}, ${subjectId}, ${JSON.stringify(payload)})`);
}

// ---------------------------------------------------------------- municipalities

/** A new municipality (tenant) with a URL name kept free of app paths. */
export async function createTenant(name: string, actorUserId: string): Promise<{ id: string; slug: string }> {
  const db = getDb();
  let base = slugify(name.replace(/^(stadt|gemeinde|markt|landkreis|kreis)\s+/i, "")) || "kommune";
  if (RESERVED.has(base)) base = `${base}-kommune`;
  const taken = new Set(
    ((await db.execute(sql`SELECT slug FROM tenants WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`)).rows as { slug: string }[]).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const t = await db.execute(sql`INSERT INTO tenants (slug, name) VALUES (${slug}, ${name}) RETURNING id`);
  const id = (t.rows[0] as { id: string }).id;
  await audit(id, `user:${actorUserId}`, "tenant.create", "tenant", id, { name, slug });
  return { id, slug };
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  members: number;
  openInvites: number;
  campaigns: number;
  createdAt: string;
}

export async function listTenants(): Promise<TenantRow[]> {
  const r = await getDb().execute(sql`
    SELECT t.id, t.name, t.slug, t.created_at AS "createdAt",
      (SELECT count(*)::int FROM memberships m JOIN auth_user u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND u.email <> ${demoLogin()?.email ?? ""}) AS members,
      (SELECT count(*)::int FROM staff_invites i WHERE i.tenant_id = t.id AND i.accepted_at IS NULL
        AND i.withdrawn_at IS NULL AND i.expires_at > now()) AS "openInvites",
      (SELECT count(*)::int FROM campaigns c WHERE c.tenant_id = t.id) AS campaigns
    FROM tenants t ORDER BY t.created_at DESC`);
  return r.rows as unknown as TenantRow[];
}

// ---------------------------------------------------------------- the team of one municipality

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  since: string;
  demo: boolean;
}

export interface OpenInvite {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  sentAt: string | null;
  expired: boolean;
}

export async function listTeam(tenantId: string): Promise<{ members: Member[]; invites: OpenInvite[] }> {
  const db = getDb();
  const m = await db.execute(sql`
    SELECT u.id AS "userId", u.name, u.email, m.role, m.created_at AS since
    FROM memberships m JOIN auth_user u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId}
    ORDER BY CASE m.role WHEN 'initiator' THEN 0 WHEN 'redaktion' THEN 1 ELSE 2 END, u.name`);
  const i = await db.execute(sql`
    SELECT id, email, role, created_at AS "createdAt", expires_at AS "expiresAt", sent_at AS "sentAt",
      expires_at <= now() AS expired
    FROM staff_invites
    WHERE tenant_id = ${tenantId} AND accepted_at IS NULL AND withdrawn_at IS NULL
    ORDER BY created_at DESC`);
  const members = (m.rows as Omit<Member, "demo">[]).map((r) => ({ ...r, demo: isDemo(r.email) }));
  return { members, invites: i.rows as unknown as OpenInvite[] };
}

export type InviteResult =
  | { ok: true; email: string; mailed: boolean; link?: string }
  | { ok: false; error: string };

async function sendInvite(opts: { tenantName: string; email: string; role: Role; inviterName: string; token: string; expiresAt: Date; newTown: boolean }) {
  const link = appUrl(`/einladung/${opts.token}`);
  const intro = opts.newTown
    ? `${opts.inviterName} hat für ${opts.tenantName} einen Zugang zu streit.bar eingerichtet und lädt Sie als Erste oder Ersten ein. Sie legen dort Verfahren an, eröffnen sie und laden Ihr Team ein.`
    : `${opts.inviterName} lädt Sie ein, im Team von ${opts.tenantName} auf streit.bar mitzuarbeiten. Ihre Rolle: ${ROLE_LABEL[opts.role]} (${ROLE_TEXT[opts.role]}).`;
  const r = await sendMail({
    to: opts.email,
    subject: `Einladung: ${opts.tenantName} auf streit.bar`,
    text: `Guten Tag,

${intro}

Einladung annehmen:
${link}

Der Link gilt bis zum ${day.format(opts.expiresAt)}. Wenn Sie nicht wissen, worum es geht, ignorieren Sie diese E-Mail. Dann passiert nichts.

streit.bar – Landkarte des Streits`,
  });
  return { link, mailed: r.ok };
}

/** Invite one person into a municipality. Earlier open invitations to the same address are replaced. */
export async function invite(opts: {
  tenantId: string;
  email: string;
  role: Role;
  inviter: { id: string; name: string };
  newTown?: boolean;
}): Promise<InviteResult> {
  const email = normEmail(opts.email);
  if (!looksLikeEmail(email)) return { ok: false, error: "Diese E-Mail-Adresse sieht nicht vollständig aus." };
  if (!ROLES.includes(opts.role)) return { ok: false, error: "Bitte wählen Sie eine Rolle." };
  const db = getDb();
  const t = (await db.execute(sql`SELECT name FROM tenants WHERE id = ${opts.tenantId}`)).rows[0] as { name: string } | undefined;
  if (!t) return { ok: false, error: "Diese Kommune gibt es nicht." };
  const member = await db.execute(sql`
    SELECT 1 FROM memberships m JOIN auth_user u ON u.id = m.user_id
    WHERE m.tenant_id = ${opts.tenantId} AND lower(u.email) = ${email}`);
  if (member.rows.length) return { ok: false, error: "Diese Person gehört schon zum Team." };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE staff_invites SET withdrawn_at = now()
      WHERE tenant_id = ${opts.tenantId} AND lower(email) = ${email} AND accepted_at IS NULL AND withdrawn_at IS NULL`);
    const r = await tx.execute(sql`
      INSERT INTO staff_invites (tenant_id, email, role, token_hash, invited_by, expires_at)
      VALUES (${opts.tenantId}, ${email}, ${opts.role}, ${hashToken(token)}, ${opts.inviter.id}, ${expiresAt.toISOString()})
      RETURNING id`);
    return (r.rows[0] as { id: string }).id;
  });
  await audit(opts.tenantId, `user:${opts.inviter.id}`, "team.invite", "staff_invite", id, { email, role: opts.role });
  const sent = await sendInvite({ tenantName: t.name, email, role: opts.role, inviterName: opts.inviter.name, token, expiresAt, newTown: !!opts.newTown });
  if (sent.mailed) await db.execute(sql`UPDATE staff_invites SET sent_at = now() WHERE id = ${id}`);
  // Without a working mail sender the person who invites passes the link on by hand.
  return { ok: true, email, mailed: sent.mailed, link: sent.mailed ? undefined : sent.link };
}

/** Send an open invitation again: a fresh link (the old one stops working) and a fresh period. */
export async function resendInvite(tenantId: string, inviteId: string, inviter: { id: string; name: string }): Promise<InviteResult> {
  const db = getDb();
  const r = await db.execute(sql`
    SELECT i.email, i.role, t.name AS "tenantName",
      NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = i.tenant_id) AS "newTown"
    FROM staff_invites i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.id = ${inviteId} AND i.tenant_id = ${tenantId} AND i.accepted_at IS NULL AND i.withdrawn_at IS NULL`);
  const inv = r.rows[0] as { email: string; role: Role; tenantName: string; newTown: boolean } | undefined;
  if (!inv) return { ok: false, error: "Diese Einladung ist nicht mehr offen." };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  await db.execute(sql`
    UPDATE staff_invites SET token_hash = ${hashToken(token)}, expires_at = ${expiresAt.toISOString()}, sent_at = NULL
    WHERE id = ${inviteId}`);
  await audit(tenantId, `user:${inviter.id}`, "team.invite_resend", "staff_invite", inviteId, { email: inv.email });
  const sent = await sendInvite({ tenantName: inv.tenantName, email: inv.email, role: inv.role, inviterName: inviter.name, token, expiresAt, newTown: inv.newTown });
  if (sent.mailed) await db.execute(sql`UPDATE staff_invites SET sent_at = now() WHERE id = ${inviteId}`);
  return { ok: true, email: inv.email, mailed: sent.mailed, link: sent.mailed ? undefined : sent.link };
}

export async function withdrawInvite(tenantId: string, inviteId: string, actorId: string): Promise<void> {
  const r = await getDb().execute(sql`
    UPDATE staff_invites SET withdrawn_at = now()
    WHERE id = ${inviteId} AND tenant_id = ${tenantId} AND accepted_at IS NULL AND withdrawn_at IS NULL RETURNING email`);
  if (r.rows.length) await audit(tenantId, `user:${actorId}`, "team.invite_withdraw", "staff_invite", inviteId, {});
}

async function initiatorCount(tenantId: string): Promise<number> {
  const r = await getDb().execute(sql`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = ${tenantId} AND role = 'initiator'`);
  return (r.rows[0] as { n: number }).n;
}

export async function changeRole(tenantId: string, userId: string, role: Role, actorId: string): Promise<string | null> {
  if (!ROLES.includes(role)) return "Bitte wählen Sie eine Rolle.";
  const db = getDb();
  const cur = (await db.execute(sql`
    SELECT m.role, u.email FROM memberships m JOIN auth_user u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}`)).rows[0] as { role: Role; email: string } | undefined;
  if (!cur) return "Diese Person gehört nicht mehr zum Team.";
  if (isDemo(cur.email)) return "Der öffentliche Beispiel-Zugang bleibt bei „Nur ansehen“.";
  if (userId === actorId) return "Ihre eigene Rolle ändert eine andere Initiatorin oder ein anderer Initiator.";
  if (cur.role === role) return null;
  if (cur.role === "initiator" && (await initiatorCount(tenantId)) <= 1) {
    return "Jede Kommune braucht mindestens eine Initiatorin oder einen Initiator.";
  }
  await db.execute(sql`UPDATE memberships SET role = ${role} WHERE tenant_id = ${tenantId} AND user_id = ${userId}`);
  await audit(tenantId, `user:${actorId}`, "team.role", "user", userId, { from: cur.role, to: role });
  return null;
}

export async function removeMember(tenantId: string, userId: string, actorId: string): Promise<string | null> {
  const db = getDb();
  const cur = (await db.execute(sql`
    SELECT m.role, u.email FROM memberships m JOIN auth_user u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}`)).rows[0] as { role: Role; email: string } | undefined;
  if (!cur) return null;
  if (isDemo(cur.email)) return "Der öffentliche Beispiel-Zugang lässt sich hier nicht entfernen.";
  if (userId === actorId) return "Sich selbst können Sie nicht entfernen.";
  if (cur.role === "initiator" && (await initiatorCount(tenantId)) <= 1) {
    return "Jede Kommune braucht mindestens eine Initiatorin oder einen Initiator.";
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM memberships WHERE tenant_id = ${tenantId} AND user_id = ${userId}`);
    // No municipality left: log the person out everywhere.
    await tx.execute(sql`
      DELETE FROM auth_session WHERE user_id = ${userId}
        AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ${userId})`);
  });
  await audit(tenantId, `user:${actorId}`, "team.remove", "user", userId, { role: cur.role });
  return null;
}

// ---------------------------------------------------------------- accepting an invitation

export type InviteState =
  | { state: "offen"; tenantName: string; email: string; role: Role; hasAccount: boolean }
  | { state: "angenommen" | "abgelaufen" | "unbekannt" };

export async function readInvite(token: string): Promise<InviteState> {
  const r = await getDb().execute(sql`
    SELECT i.email, i.role, i.expires_at <= now() AS expired, i.accepted_at IS NOT NULL AS accepted,
      i.withdrawn_at IS NOT NULL AS withdrawn, t.name AS "tenantName",
      EXISTS (SELECT 1 FROM auth_user u WHERE lower(u.email) = lower(i.email)) AS "hasAccount"
    FROM staff_invites i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.token_hash = ${hashToken(token)}`);
  const i = r.rows[0] as
    | { email: string; role: Role; expired: boolean; accepted: boolean; withdrawn: boolean; tenantName: string; hasAccount: boolean }
    | undefined;
  if (!i || i.withdrawn) return { state: "unbekannt" };
  if (i.accepted) return { state: "angenommen" };
  if (i.expired) return { state: "abgelaufen" };
  return { state: "offen", tenantName: i.tenantName, email: i.email, role: i.role, hasAccount: i.hasAccount };
}

export type AcceptResult = { ok: true; email: string; created: boolean } | { ok: false; error: string };

/**
 * Accept: an existing account joins the municipality; otherwise the account is created with the
 * given name and password (address confirmed, since the link came by email). One transaction,
 * the invitation row locked so a double click cannot create two accounts.
 */
export async function acceptInvite(token: string, account: { name: string; password: string } | null): Promise<AcceptResult> {
  const db = getDb();
  const hash = account ? await hashPassword(account.password) : null;
  const res = await db.transaction(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", email, role, invited_by AS "invitedBy"
      FROM staff_invites
      WHERE token_hash = ${hashToken(token)} AND accepted_at IS NULL AND withdrawn_at IS NULL AND expires_at > now()
      FOR UPDATE`);
    const inv = r.rows[0] as { id: string; tenantId: string; email: string; role: Role; invitedBy: string } | undefined;
    if (!inv) return { ok: false as const, error: "Diese Einladung gilt nicht mehr. Bitten Sie um eine neue." };
    const u = (await tx.execute(sql`SELECT id FROM auth_user WHERE lower(email) = ${normEmail(inv.email)}`)).rows[0] as { id: string } | undefined;
    let userId = u?.id;
    if (!userId) {
      if (!account || !hash) return { ok: false as const, error: "Bitte geben Sie Ihren Namen und ein Passwort an." };
      userId = randomUUID();
      await tx.execute(sql`
        INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, ${account.name}, ${normEmail(inv.email)}, true, now(), now())`);
      await tx.execute(sql`
        INSERT INTO auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, now(), now())`);
    }
    await tx.execute(sql`
      INSERT INTO memberships (user_id, tenant_id, role) VALUES (${userId}, ${inv.tenantId}, ${inv.role})
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`);
    await tx.execute(sql`UPDATE staff_invites SET accepted_at = now(), accepted_by = ${userId} WHERE id = ${inv.id}`);
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${inv.tenantId}, ${`user:${userId}`}, 'team.join', 'staff_invite', ${inv.id},
        ${JSON.stringify({ role: inv.role, newAccount: !u })})`);
    return { ok: true as const, email: normEmail(inv.email), created: !u };
  });
  return res;
}

// ---------------------------------------------------------------- password reset mail

export async function sendPasswordReset(user: { email: string; name: string }, token: string): Promise<void> {
  if (isDemo(user.email)) return;
  const link = appUrl(`/passwort-neu?token=${encodeURIComponent(token)}`);
  await sendMail({
    to: user.email,
    subject: "Neues Passwort für streit.bar",
    text: `Guten Tag ${user.name},

jemand, hoffentlich Sie, möchte das Passwort für Ihr Konto bei streit.bar neu festlegen.

Neues Passwort festlegen:
${link}

Der Link gilt eine Stunde. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail. Ihr Passwort bleibt dann, wie es ist.

streit.bar – Landkarte des Streits`,
  });
}
