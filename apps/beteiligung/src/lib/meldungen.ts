/**
 * "Hier stimmt etwas nicht": citizens report a statement or a quote; the editors hide it with a
 * logged reason, or keep it (migration 0021). Hiding a quote keeps the vote behind it, only the
 * words disappear; hiding a statement takes it out of the vote. In a stored, published result
 * the statement keeps its number and its text is replaced, so every other reference still holds.
 */

import { sql } from "@policy/db";
import type { Ergebnis } from "@policy/pipeline/kern";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { originHash } from "./teilnahme";

export type Reason = "beleidigend" | "persoenlich" | "falsch" | "sonstiges";
export const REASONS: { key: Reason; label: string }[] = [
  { key: "beleidigend", label: "Beleidigend oder hetzerisch" },
  { key: "persoenlich", label: "Nennt oder beschreibt eine Privatperson" },
  { key: "falsch", label: "Gibt einen Beitrag falsch wieder" },
  { key: "sonstiges", label: "Etwas anderes" },
];
export const reasonLabel = (r: string) => REASONS.find((x) => x.key === r)?.label ?? r;

/** Reports per connection and hour, per campaign. */
const PER_HOUR = 10;

export type ReportResult = { ok: true } | { ok: false; error: string };

export async function reportContent(c: Campaign, kind: "node" | "move", id: string, reason: string, note: string): Promise<ReportResult> {
  if (!REASONS.some((r) => r.key === reason)) return { ok: false, error: "Bitte wähl einen Grund." };
  const db = getDb();
  // Only what belongs to this campaign and is public can be reported.
  const exists =
    kind === "node"
      ? await db.execute(sql`SELECT 1 FROM map_points WHERE id = ${id} AND consultation_id = ${c.consultationId} AND status = 'released'`)
      : await db.execute(sql`SELECT 1 FROM moves WHERE id = ${id} AND consultation_id = ${c.consultationId} AND state = 'verknuepft'`);
  if (!exists.rows.length) return { ok: false, error: "Diesen Inhalt gibt es hier nicht." };
  const origin = await originHash(c);
  const recent = await db.execute(sql`
    SELECT count(*)::int AS n FROM content_reports WHERE campaign_id = ${c.id} AND origin_hash = ${origin} AND created_at > now() - interval '1 hour'`);
  if (Number((recent.rows[0] as { n: number }).n) >= PER_HOUR) return { ok: false, error: "Du hast in der letzten Stunde schon viel gemeldet. Bitte später noch einmal." };
  await db.execute(sql`
    INSERT INTO content_reports (tenant_id, campaign_id, subject_kind, subject_id, reason, note, origin_hash)
    VALUES (${c.tenantId}, ${c.id}, ${kind}, ${id}, ${reason}, ${note.trim().slice(0, 300) || null}, ${origin})
    ON CONFLICT (campaign_id, subject_kind, subject_id, origin_hash) DO NOTHING`);
  return { ok: true };
}

export interface OpenReport {
  kind: "node" | "move";
  id: string;
  /** The reported words: the statement, or the quote with the statement it hangs on. */
  text: string;
  context: string | null;
  isRoot: boolean;
  count: number;
  reasons: { reason: string; note: string | null; at: string }[];
}

/** Open reports, one entry per reported item, most reported first. */
export async function openReports(c: Campaign): Promise<OpenReport[]> {
  const r = await getDb().execute(sql`
    SELECT cr.subject_kind AS kind, cr.subject_id AS id,
      json_agg(json_build_object('reason', cr.reason, 'note', cr.note, 'at', cr.created_at) ORDER BY cr.created_at) AS reasons,
      count(*)::int AS count,
      COALESCE(p.text, m.quote) AS text,
      CASE WHEN cr.subject_kind = 'move' THEN mp.text END AS context,
      COALESCE(p.rolle = 'schluss', false) AS "isRoot"
    FROM content_reports cr
    LEFT JOIN map_points p ON cr.subject_kind = 'node' AND p.id = cr.subject_id
    LEFT JOIN moves m ON cr.subject_kind = 'move' AND m.id = cr.subject_id
    LEFT JOIN map_points mp ON mp.id = m.map_point_id
    WHERE cr.campaign_id = ${c.id} AND cr.state = 'offen'
    GROUP BY cr.subject_kind, cr.subject_id, p.text, m.quote, mp.text, p.rolle
    ORDER BY count(*) DESC, min(cr.created_at)`);
  return r.rows as unknown as OpenReport[];
}

export async function countOpenReports(campaignId: string): Promise<number> {
  const r = await getDb().execute(sql`
    SELECT count(DISTINCT (subject_kind, subject_id))::int AS n FROM content_reports WHERE campaign_id = ${campaignId} AND state = 'offen'`);
  return Number((r.rows[0] as { n: number }).n);
}

/** The editors' decision on every open report of one item: hide it, or let it stand. Logged with the reason. */
export async function decideReport(c: Campaign, kind: "node" | "move", id: string, hide: boolean, reason: string, actorId: string): Promise<string | null> {
  const db = getDb();
  if (hide && reason.trim().length < 3) return "Bitte nennen Sie den Grund fürs Ausblenden. Er steht im Protokoll.";
  if (hide && kind === "node") {
    const n = (await db.execute(sql`SELECT rolle FROM map_points WHERE id = ${id} AND consultation_id = ${c.consultationId}`)).rows[0] as { rolle: string | null } | undefined;
    if (!n) return "Diese Aussage gibt es nicht mehr.";
    if (n.rolle === "schluss") return "Die Maßnahme selbst lässt sich nicht ausblenden.";
  }
  await db.transaction(async (tx) => {
    if (hide && kind === "node") {
      await tx.execute(sql`UPDATE map_points SET status = 'rejected' WHERE id = ${id} AND consultation_id = ${c.consultationId}`);
    }
    if (hide && kind === "move") {
      await tx.execute(sql`
        UPDATE moves SET flags = array_append(COALESCE(flags, '{}'), 'versteckt')
        WHERE id = ${id} AND consultation_id = ${c.consultationId} AND NOT ('versteckt' = ANY(COALESCE(flags, '{}')))`);
    }
    await tx.execute(sql`
      UPDATE content_reports SET state = ${hide ? "ausgeblendet" : "bleibt"}, decided_by = ${`user:${actorId}`}, decided_at = now(),
        decision_reason = ${reason.trim().slice(0, 500) || null}
      WHERE campaign_id = ${c.id} AND subject_kind = ${kind} AND subject_id = ${id} AND state = 'offen'`);
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${c.tenantId}, ${`user:${actorId}`}, ${hide ? "report.hide" : "report.keep"}, ${kind === "node" ? "map_point" : "move"}, ${id},
        ${JSON.stringify({ reason: reason.trim() })})`);
  });
  return null;
}

/** What the editors hid after reports in this campaign. */
export async function hiddenOf(c: Campaign): Promise<{ nodes: Set<string>; moves: Set<string> }> {
  const r = await getDb().execute(sql`
    SELECT DISTINCT subject_kind, subject_id FROM content_reports WHERE campaign_id = ${c.id} AND state = 'ausgeblendet'`);
  const rows = r.rows as { subject_kind: string; subject_id: string }[];
  return {
    nodes: new Set(rows.filter((x) => x.subject_kind === "node").map((x) => x.subject_id)),
    moves: new Set(rows.filter((x) => x.subject_kind === "move").map((x) => x.subject_id)),
  };
}

/** A stored result as it may be shown: hidden quotes gone, hidden statements keep their number but not their words. */
export function maskHidden(r: Ergebnis, hidden: { nodes: Set<string>; moves: Set<string> }): Ergebnis {
  if (!hidden.nodes.size && !hidden.moves.size) return r;
  return {
    ...r,
    statements: r.statements.map((s) =>
      hidden.nodes.has(s.id)
        ? { ...s, text: "Von der Redaktion ausgeblendet.", quotes: [] }
        : { ...s, quotes: s.quotes.filter((q) => !hidden.moves.has(q.move)) },
    ),
  };
}
