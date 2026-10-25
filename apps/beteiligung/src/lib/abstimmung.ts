/**
 * Door 1 (Gesamtmodell B2–B4): which statement a participant sees next, and
 * the vote itself. Statements with few votes come first so every one gets
 * enough for the camp math; facts and values alternate; the measure itself
 * opens the deck (assumption 1: it is voted on like every other point).
 * A statement changed after opening (new version) comes back to everyone
 * who voted on the old wording.
 */

import { createHash } from "node:crypto";

import { sql } from "@policy/db";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";

type Row = Record<string, unknown>;

export interface Statement {
  id: string;
  ord: number;
  rolle: "schluss" | "praemisse" | "beitrag";
  typ: "T" | "W" | "verfahren";
  text: string;
  schritt: string | null;
  frage: string | null;
  richtung: string | null;
  version: number;
  /** Votes on the current wording: agree, disagree, pass. */
  agree: number;
  disagree: number;
  pass: number;
  /** Evidence offered in the statements behind it, by class. */
  evidence: Record<string, number>;
}

function toStatement(r: Row): Statement {
  return {
    id: r.id as string,
    ord: Number(r.ord),
    rolle: r.rolle as Statement["rolle"],
    typ: r.typ as Statement["typ"],
    text: r.text as string,
    schritt: (r.schritt as string | null) ?? null,
    frage: (r.frage as string | null) ?? null,
    richtung: (r.richtung as string | null) ?? null,
    version: Number(r.version),
    agree: Number(r.agree ?? 0),
    disagree: Number(r.disagree ?? 0),
    pass: Number(r.pass ?? 0),
    evidence: (r.evidence as Record<string, number> | null) ?? {},
  };
}

/** Every statement under vote, with its counts on the current wording. */
export async function statementsUnderVote(c: Campaign): Promise<Statement[]> {
  const r = await getDb().execute(sql`
    SELECT p.id, p.ord, p.rolle, p.typ, p.text, p.schritt, p.frage, p.richtung, p.version,
      (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version AND v.value = 1)::int AS agree,
      (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version AND v.value = -1)::int AS disagree,
      (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version AND v.value = 0)::int AS pass,
      (SELECT jsonb_object_agg(beleg, n) FROM (
         SELECT m.beleg, count(*)::int AS n FROM moves m
         WHERE m.map_point_id = p.id AND m.state = 'verknuepft' AND m.beleg IN ('vergleichsfall', 'studie', 'messdaten') GROUP BY m.beleg) e) AS evidence
    FROM map_points p
    WHERE p.consultation_id = ${c.consultationId} AND p.rolle IS NOT NULL AND p.status = 'released'
    ORDER BY CASE p.rolle WHEN 'schluss' THEN 0 ELSE 1 END, p.ord`);
  return (r.rows as Row[]).map(toStatement);
}

/** The participant's votes on the current wordings: statement id → -1 / 0 / 1. */
export async function myVotes(c: Campaign, participantId: string): Promise<Map<string, number>> {
  const r = await getDb().execute(sql`
    SELECT v.map_point_id, v.value FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id AND p.version = v.version
    WHERE v.participant_id = ${participantId} AND p.consultation_id = ${c.consultationId}`);
  return new Map((r.rows as Row[]).map((x) => [x.map_point_id as string, Number(x.value)]));
}

const tiebreak = (participantId: string, id: string) => createHash("sha1").update(`${participantId}|${id}`).digest().readUInt32BE(0);

/** B2: the next statement for this participant, or null when they have voted on all. */
export function nextFor(statements: Statement[], voted: Map<string, number>, participantId: string, lastTyp: string | null): Statement | null {
  const open = statements.filter((s) => !voted.has(s.id));
  if (!open.length) return null;
  const root = open.find((s) => s.rolle === "schluss");
  if (root) return root;
  const ordered = open
    .map((s) => ({ s, n: s.agree + s.disagree + s.pass, t: tiebreak(participantId, s.id) }))
    .sort((a, b) => a.n - b.n || a.t - b.t)
    .map((x) => x.s);
  // Facts and values take turns where the next few allow it.
  return ordered.slice(0, 4).find((s) => s.typ !== lastTyp) ?? ordered[0]!;
}

export async function lastVotedTyp(participantId: string): Promise<string | null> {
  const r = await getDb().execute(sql`
    SELECT p.typ FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id
    WHERE v.participant_id = ${participantId} ORDER BY v.created_at DESC LIMIT 1`);
  return ((r.rows[0] as Row | undefined)?.typ as string | undefined) ?? null;
}

/** B3/B4: one participant, one vote per statement and wording (I9); a second click changes it. */
export async function castVote(c: Campaign, participantId: string, statementId: string, value: -1 | 0 | 1): Promise<boolean> {
  const r = await getDb().execute(sql`
    INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, version, value, method)
    SELECT p.tenant_id, ${participantId}, p.id, p.version, ${value}, 'real' FROM map_points p
    WHERE p.id = ${statementId} AND p.consultation_id = ${c.consultationId} AND p.status = 'released'
    ON CONFLICT (participant_id, map_point_id, version) DO UPDATE SET value = excluded.value, method = 'real', created_at = now()
    RETURNING id`);
  return r.rows.length > 0;
}

/** For the entry page: how many statements are on the table, how many people have voted. */
export async function participation(c: Campaign): Promise<{ statements: number; voters: number }> {
  const r = await getDb().execute(sql`
    SELECT
      (SELECT count(*) FROM map_points WHERE consultation_id = ${c.consultationId} AND rolle IS NOT NULL AND status = 'released')::int AS statements,
      (SELECT count(DISTINCT v.participant_id) FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id
        WHERE p.consultation_id = ${c.consultationId} AND v.method = 'real')::int AS voters`);
  const x = r.rows[0] as Row;
  return { statements: Number(x.statements), voters: Number(x.voters) };
}
