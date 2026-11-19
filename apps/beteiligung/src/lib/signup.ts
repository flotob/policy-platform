/**
 * Who may register a new municipality. Three modes, from the server's settings:
 *   SIGNUP_OPEN=1   → anyone (local development only)
 *   SIGNUP_CODE=…   → anyone with the shared registration code we hand out
 *   neither         → closed (accounts only through invitations, lib/team.ts)
 * The code is one value for everyone: 12 characters from a 32-letter alphabet = 60 bits, far
 * beyond guessing; on top, wrong codes are limited per connection and in total. A new code in
 * the settings retires the old one at once. Better Auth's own sign-up endpoint stays switched off:
 * accounts are only created here, after the check.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { sql } from "@policy/db";
import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";

import { getDb } from "./db";

export type SignupMode = "open" | "code" | "closed";

export function signupMode(): SignupMode {
  if (process.env.SIGNUP_OPEN === "1") return "open";
  if (normCode(process.env.SIGNUP_CODE ?? "").length >= 12) return "code";
  return "closed";
}

/** Letters and digits only, upper case: "abcd-efgh ijkl" and "ABCDEFGHIJKL" are the same code. */
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Wrong codes allowed per connection per hour, and in total per hour (in memory; one server process). */
const PER_IP = 10;
const TOTAL = 200;
const HOUR = 3_600_000;
const wrong = new Map<string, { n: number; until: number }>();
let total = { n: 0, until: 0 };

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "local";
}

export type CodeCheck = "ok" | "wrong" | "limited";

export async function checkSignupCode(input: string): Promise<CodeCheck> {
  const now = Date.now();
  const ip = await clientIp();
  const mine = wrong.get(ip);
  if (mine && mine.until < now) wrong.delete(ip);
  if (total.until < now) total = { n: 0, until: now + HOUR };
  if ((wrong.get(ip)?.n ?? 0) >= PER_IP || total.n >= TOTAL) return "limited";

  const expected = normCode(process.env.SIGNUP_CODE ?? "");
  const given = normCode(input);
  if (expected.length >= 12 && timingSafeEqual(digest(given), digest(expected))) return "ok";

  const e = wrong.get(ip) ?? { n: 0, until: now + HOUR };
  e.n += 1;
  wrong.set(ip, e);
  total.n += 1;
  if (e.n === PER_IP) console.warn(`[signup] ${PER_IP} wrong registration codes from one connection within an hour`);
  return "wrong";
}

/** A staff account with email + password; null when the address already has one. */
export async function createAccount(name: string, email: string, password: string): Promise<string | null> {
  const hash = await hashPassword(password);
  const addr = email.trim().toLowerCase();
  return getDb().transaction(async (tx) => {
    const taken = await tx.execute(sql`SELECT 1 FROM auth_user WHERE lower(email) = ${addr}`);
    if (taken.rows.length) return null;
    const id = randomUUID();
    await tx.execute(sql`
      INSERT INTO auth_user (id, name, email, email_verified, created_at, updated_at)
      VALUES (${id}, ${name}, ${addr}, false, now(), now())`);
    await tx.execute(sql`
      INSERT INTO auth_account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${randomUUID()}, ${id}, 'credential', ${id}, ${hash}, now(), now())`);
    return id;
  });
}
