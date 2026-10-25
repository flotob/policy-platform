/**
 * The read-only demo login: anyone may look at a municipality's workspace
 * (the fictional Musterstadt) without changing anything. On with DEMO_LOGIN=1
 * (or DEMO_LOGIN_EMAIL + DEMO_LOGIN_PASSWORD); the credentials are public —
 * they stand on the login page — so they have defaults here, not secrets in
 * the server's settings. DEMO_LOGIN_TENANT defaults to musterstadt. The app
 * creates or repairs the account at startup, so it survives a database restore. Its role is "betrachter": every action that
 * changes something refuses it (requireEditor / requireInitiator), and the
 * auth endpoints that could change the shared password are switched off
 * (auth-options.ts).
 */

import { randomUUID } from "node:crypto";

import { sql } from "@policy/db";
import { hashPassword } from "better-auth/crypto";

import { getDb } from "./db";

export function demoLogin(): { email: string; password: string; tenant: string } | null {
  const email = process.env.DEMO_LOGIN_EMAIL?.trim();
  const password = process.env.DEMO_LOGIN_PASSWORD?.trim();
  if (process.env.DEMO_LOGIN !== "1" && !(email && password)) return null;
  return {
    email: email || "besuch@musterstadt-demo.test",
    password: password || "musterstadt-ansehen",
    tenant: process.env.DEMO_LOGIN_TENANT?.trim() || "musterstadt",
  };
}

/** Create the demo account if it is missing; keep its password and its read-only role as configured. */
export async function ensureDemoLogin(log: (m: string) => void = console.log): Promise<void> {
  const d = demoLogin();
  if (!d) return;
  const db = getDb();
  const t = (await db.execute(sql`SELECT id FROM tenants WHERE slug = ${d.tenant}`)).rows[0] as { id: string } | undefined;
  if (!t) {
    log(`[demo-login] no municipality "${d.tenant}" — demo login not set up`);
    return;
  }
  const hash = await hashPassword(d.password);
  await db.transaction(async (tx) => {
    const u = (await tx.execute(sql`SELECT id FROM auth_user WHERE email = ${d.email}`)).rows[0] as { id: string } | undefined;
    const userId = u?.id ?? randomUUID();
    if (!u) {
      await tx.execute(sql`
        INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at) VALUES (${userId}, 'Besuch (nur lesen)', ${d.email}, true, now(), now())`);
    }
    const a = await tx.execute(sql`
      UPDATE auth_account SET password = ${hash}, updated_at = now() WHERE user_id = ${userId} AND provider_id = 'credential' RETURNING id`);
    if (!a.rows.length) {
      await tx.execute(sql`
        INSERT INTO auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        VALUES (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hash}, now(), now())`);
    }
    // Read-only, in exactly this municipality.
    await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${userId} AND tenant_id <> ${t.id}`);
    await tx.execute(sql`
      INSERT INTO memberships (user_id, tenant_id, role) VALUES (${userId}, ${t.id}, 'betrachter')
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'betrachter'`);
  });
  log(`[demo-login] read-only demo login for "${d.tenant}" ready`);
}
