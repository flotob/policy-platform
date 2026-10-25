/**
 * The municipality's view of a running participation (Gesamtmodell B11,
 * B12, W2/W3, live): who takes part, which statements still need votes, is
 * anything new still coming in (saturation), which critical questions nobody
 * has asked, and — once enough people voted — the camps, computed with the
 * same Polis math as the federal pipeline. Recomputed when the votes change.
 */

import { sql } from "@policy/db";
import { liveResult } from "./auswertung";
import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { QUESTIONS, STEPS } from "./params";

export { saturation } from "./auswertung";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

export interface Participation {
  voters: number;
  realVotes: number;
  derivedVotes: number;
  simulated: number;
  statements: number;
  shortPoints: number;
  shortConfirmed: number;
  uploads: number;
}

export async function participationStats(c: Campaign): Promise<Participation> {
  const [x] = await rows(sql`
    SELECT
      (SELECT count(DISTINCT v.participant_id) FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id
        WHERE p.consultation_id = ${c.consultationId} AND v.method = 'real')::int AS voters,
      (SELECT count(*) FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id
        WHERE p.consultation_id = ${c.consultationId} AND v.method = 'real' AND v.version = p.version)::int AS real_votes,
      (SELECT count(*) FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id
        WHERE p.consultation_id = ${c.consultationId} AND v.method IN ('tuer2', 'abgeleitet') AND v.version = p.version)::int AS derived_votes,
      (SELECT count(*) FROM participants WHERE consultation_id = ${c.consultationId} AND via = 'simulation')::int AS simulated,
      (SELECT count(*) FROM map_points WHERE consultation_id = ${c.consultationId} AND rolle IS NOT NULL AND status = 'released')::int AS statements,
      (SELECT count(*) FROM submissions WHERE consultation_id = ${c.consultationId} AND door = 'statement')::int AS short_points,
      (SELECT count(*) FROM judgments WHERE consultation_id = ${c.consultationId} AND family = 'kern-short.v1' AND decided->>'answer' = 'ja')::int AS short_confirmed,
      (SELECT count(*) FROM campaign_files WHERE campaign_id = ${c.id} AND participant_id IS NOT NULL)::int AS uploads`);
  return {
    voters: Number(x!.voters),
    realVotes: Number(x!.real_votes),
    derivedVotes: Number(x!.derived_votes),
    simulated: Number(x!.simulated),
    statements: Number(x!.statements),
    shortPoints: Number(x!.short_points),
    shortConfirmed: Number(x!.short_confirmed),
    uploads: Number(x!.uploads),
  };
}

export interface Density {
  id: string;
  text: string;
  votes: number;
}

/** B2: the statements with the fewest votes on their current wording. */
export async function thinStatements(c: Campaign, limit = 5): Promise<{ thin: Density[]; median: number }> {
  const r = await rows(sql`
    SELECT p.id, p.text, (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version)::int AS votes
    FROM map_points p WHERE p.consultation_id = ${c.consultationId} AND p.rolle IS NOT NULL AND p.status = 'released'
    ORDER BY votes, p.ord`);
  const all = r.map((x) => ({ id: x.id as string, text: x.text as string, votes: Number(x.votes) }));
  const sorted = all.map((x) => x.votes).sort((a, b) => a - b);
  return { thin: all.slice(0, limit), median: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0 };
}

/** B12/W6: the critical questions no released point raises yet, per step. */
export async function gaps(c: Campaign): Promise<{ step: string; question: string }[]> {
  // Asked = an attacking point under the question, or a contribution contradicting one of the town's own claims there.
  const r = await rows(sql`
    SELECT DISTINCT schritt, frage FROM map_points p
    WHERE p.consultation_id = ${c.consultationId} AND p.status = 'released' AND p.schritt IS NOT NULL AND (
      (p.rolle = 'beitrag' AND p.richtung = 'greift_an')
      OR EXISTS (SELECT 1 FROM moves m WHERE m.map_point_id = p.id AND m.state = 'verknuepft' AND m.stance = -1))`);
  const asked = new Set(r.map((x) => `${x.schritt}|${x.frage}`));
  const out: { step: string; question: string }[] = [];
  for (const s of STEPS) for (const q of QUESTIONS) if ((q.steps as readonly string[]).includes(s.key) && !asked.has(`${s.key}|${q.key}`)) out.push({ step: s.label, question: q.label });
  return out;
}

export interface Camps {
  ready: false;
  clusterable: number;
  needed: number;
}
export interface CampsReady {
  ready: true;
  k: number;
  silhouette: number;
  sizes: number[];
  clusterable: number;
  /** Per statement: agreement share per camp (0–100), and whether it bridges. */
  statements: { id: string; text: string; typ: string; pa: (number | null)[]; bridge: boolean; gap: number }[];
}

/** W2/W3, live: the same evaluation the results page and the report use (befund.ts). */
export async function camps(c: Campaign): Promise<Camps | CampsReady> {
  const r = await liveResult(c);
  if (!r.ready || !r.camps) return { ready: false, clusterable: r.clusterable, needed: r.needed };
  return {
    ready: true,
    k: r.camps.k,
    silhouette: r.camps.silhouette,
    sizes: r.camps.sizes,
    clusterable: r.clusterable,
    statements: r.statements.map((s) => ({
      id: s.id,
      text: s.text,
      typ: s.typ,
      pa: s.camps.map((x) => (x.seen ? Math.round((100 * x.agree) / x.seen) : null)),
      bridge: s.profile === "getragen",
      gap: s.gap,
    })),
  };
}
