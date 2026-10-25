/**
 * Taking part without an account (Gesamtmodell B1, B14): a pseudonymous
 * participant per campaign, known only by the hash of a random cookie
 * token. No name, no e-mail, nothing to log in with. Limits are counted in
 * the database: how many pseudonyms one connection opens, how fast one
 * pseudonym votes, writes or uploads.
 */

import { createHash, randomBytes } from "node:crypto";

import { sql } from "@policy/db";
import { cookies, headers } from "next/headers";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";

type Row = Record<string, unknown>;

export const LIMITS = {
  /** New pseudonyms per connection and hour. */
  participantsPerOriginHour: 30,
  votesPerMinute: 90,
  shortPerHour: 6,
  uploadsPerDay: 3,
  shortMaxChars: 400,
} as const;

const cookieName = (c: Campaign) => `teilnahme-${c.id.slice(0, 8)}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Where a request comes from, salted per campaign — only for counting, never stored in clear. */
async function originHash(c: Campaign): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "local";
  return hash(`${ip}|${c.id}|${process.env.BETTER_AUTH_SECRET ?? ""}`).slice(0, 32);
}

export interface Participant {
  id: string;
  createdAt: string;
}

/** The participant of this browser, or null (pages: read-only). */
export async function getParticipant(c: Campaign): Promise<Participant | null> {
  const token = (await cookies()).get(cookieName(c))?.value;
  if (!token) return null;
  const r = await getDb().execute(sql`
    SELECT id, created_at FROM participants WHERE consultation_id = ${c.consultationId} AND source_ref = ${`tuer:${hash(token)}`}`);
  const p = r.rows[0] as Row | undefined;
  return p ? { id: p.id as string, createdAt: String(p.created_at) } : null;
}

export class ParticipationError extends Error {}

/** In a server action: this browser's participant, created on first use (with an invitation code where the town asks for one). */
export async function ensureParticipant(c: Campaign, invite?: string): Promise<Participant> {
  const existing = await getParticipant(c);
  if (existing) return existing;
  if (c.state !== "offen") throw new ParticipationError("Die Beteiligung ist gerade nicht geöffnet.");
  const db = getDb();
  const origin = await originHash(c);
  const recent = await db.execute(sql`
    SELECT count(*)::int AS n FROM participants
    WHERE consultation_id = ${c.consultationId} AND origin_hash = ${origin} AND created_at > now() - interval '1 hour'`);
  if (Number((recent.rows[0] as Row).n) >= LIMITS.participantsPerOriginHour) {
    throw new ParticipationError("Von diesem Anschluss sind in der letzten Stunde sehr viele Teilnahmen gestartet worden. Bitte versuch es später noch einmal.");
  }
  const token = randomBytes(24).toString("base64url");
  const id = await db.transaction(async (tx) => {
    let inviteId: string | null = null;
    if (c.params.access === "einladung") {
      const code = (invite ?? "").replace(/[\s-]/g, "").toUpperCase();
      const r = await tx.execute(sql`
        SELECT id FROM campaign_invites WHERE campaign_id = ${c.id} AND code_hash = ${hash(code)} AND participant_id IS NULL FOR UPDATE`);
      inviteId = ((r.rows[0] as Row | undefined)?.id as string | undefined) ?? null;
      if (!inviteId) throw new ParticipationError("Diesen Einladungscode kennen wir nicht, oder er wurde schon benutzt.");
    }
    const p = await tx.execute(sql`
      INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via, origin_hash)
      VALUES (${c.tenantId}, ${c.consultationId}, ${`tuer:${hash(token)}`}, 'privat', 'de', 'tuer', ${origin}) RETURNING id, created_at`);
    const pid = (p.rows[0] as Row).id as string;
    if (inviteId) await tx.execute(sql`UPDATE campaign_invites SET participant_id = ${pid}, used_at = now() WHERE id = ${inviteId}`);
    return pid;
  });
  (await cookies()).set(cookieName(c), token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180, secure: process.env.NODE_ENV === "production" });
  return { id, createdAt: new Date().toISOString() };
}

/** Count of a participant's recent actions (votes, short statements, uploads) against a limit. */
export async function within(kind: "vote" | "short" | "upload", participantId: string): Promise<boolean> {
  const db = getDb();
  if (kind === "vote") {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM map_point_votes WHERE participant_id = ${participantId} AND created_at > now() - interval '1 minute'`);
    return Number((r.rows[0] as Row).n) < LIMITS.votesPerMinute;
  }
  if (kind === "short") {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM submissions WHERE participant_id = ${participantId} AND door = 'statement' AND created_at > now() - interval '1 hour'`);
    return Number((r.rows[0] as Row).n) < LIMITS.shortPerHour;
  }
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM campaign_files WHERE participant_id = ${participantId} AND created_at > now() - interval '1 day'`);
  return Number((r.rows[0] as Row).n) < LIMITS.uploadsPerDay;
}

/** A tracking-slip token: short, unambiguous to read out, unguessable. */
export { trackingToken } from "./tuer2";

/** Invitation codes: printed once, kept only as hashes. */
export function inviteCode(): { code: string; hash: string } {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, hash: hash(raw) };
}
