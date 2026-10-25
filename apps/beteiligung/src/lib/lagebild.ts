/**
 * The municipality's view of a running participation (Gesamtmodell B11,
 * B12, W2/W3, live): who takes part, which statements still need votes, is
 * anything new still coming in (saturation), which critical questions nobody
 * has asked, and — once enough people voted — the camps, computed with the
 * same Polis math as the federal pipeline. Recomputed when the votes change.
 */

import { sql } from "@policy/db";
import {
  buildRawMatrix,
  clusterableParticipantIds,
  commentStatistics,
  findBestKmeans,
  runPca,
  selectParticipants,
  type VoteRecord,
} from "@policy/math";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { QUESTIONS, STEPS } from "./params";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

/** A participant needs this many votes to be placed in a camp (Polis default). */
const MIN_VOTES = 7;

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

/**
 * Z10/B11: inputs in the order they came (door 2, door 3, the town's own
 * uploads) and whether each brought a point that was not there before (a
 * released node opened from one of its moves). Saturation = the latest run
 * of inputs without a new point, against the campaign's window.
 */
export async function saturation(c: Campaign) {
  const r = await rows(sql`
    SELECT s.id, s.created_at,
      EXISTS (SELECT 1 FROM moves m JOIN map_points p ON p.id = m.map_point_id
              WHERE m.submission_id = s.id AND m.route IN ('neu', 'praezisierung') AND p.status = 'released'
                AND p.proposal->>'text' = m.aussage) AS brought_new,
      EXISTS (SELECT 1 FROM moves m WHERE m.submission_id = s.id AND m.state = 'vorgelegt') AS open
    FROM submissions s WHERE s.consultation_id = ${c.consultationId} AND s.door IN ('statement', 'document')
    ORDER BY s.created_at`);
  const inputs = r.map((x) => ({ new: x.brought_new as boolean, open: x.open as boolean }));
  let streak = 0;
  for (let i = inputs.length - 1; i >= 0 && !inputs[i]!.new; i--) streak++;
  const lastN = inputs.slice(-Math.max(1, c.params.saturationWindow));
  return {
    inputs: inputs.length,
    newPoints: inputs.filter((x) => x.new).length,
    streak,
    window: c.params.saturationWindow,
    recentNew: lastN.filter((x) => x.new).length,
    open: inputs.filter((x) => x.open).length,
    series: inputs.map((x) => x.new),
    saturated: streak >= c.params.saturationWindow,
  };
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

const cache = new Map<string, { key: string; value: Camps | CampsReady }>();

/** W2/W3 over participants × statements on the current wordings — simulated votes included and counted separately. */
export async function camps(c: Campaign): Promise<Camps | CampsReady> {
  const nodes = await rows(sql`
    SELECT id, text, typ, version FROM map_points
    WHERE consultation_id = ${c.consultationId} AND rolle IS NOT NULL AND status = 'released' ORDER BY ord`);
  const votes = await rows(sql`
    SELECT v.participant_id, v.map_point_id, v.value FROM map_point_votes v JOIN map_points p ON p.id = v.map_point_id AND p.version = v.version
    WHERE p.consultation_id = ${c.consultationId} AND p.status = 'released'`);
  const key = `${nodes.length}:${votes.length}:${votes.reduce((s, v) => s + Number(v.value) + 2, 0)}`;
  const hit = cache.get(c.id);
  if (hit && hit.key === key) return hit.value;

  const pIndex = new Map<string, number>();
  const nIndex = new Map(nodes.map((n, i) => [n.id as string, i]));
  const records: VoteRecord[] = [];
  for (const v of votes) {
    const pid = v.participant_id as string;
    if (!pIndex.has(pid)) pIndex.set(pid, pIndex.size);
    records.push({ participantId: pIndex.get(pid)!, statementId: nIndex.get(v.map_point_id as string)!, vote: Number(v.value) as -1 | 0 | 1, modified: 1 });
  }
  const minVotes = Math.min(MIN_VOTES, Math.max(2, Math.floor(nodes.length / 2)));
  let value: Camps | CampsReady;
  if (!records.length) value = { ready: false, clusterable: 0, needed: c.params.minParticipants };
  else {
    const matrix = buildRawMatrix(records);
    const clusterable = clusterableParticipantIds(matrix, minVotes);
    if (clusterable.length < Math.max(c.params.minParticipants, 6)) {
      value = { ready: false, clusterable: clusterable.length, needed: c.params.minParticipants };
    } else {
      const pca = runPca(matrix);
      const rowIndex = new Map(matrix.participantIds.map((id, i) => [id, i]));
      const pts = clusterable.map((pid) => pca.participantProjections[rowIndex.get(pid)!]! as unknown as number[]);
      const kMax = Math.max(2, Math.min(5, Math.floor(clusterable.length / 3)));
      const { best, silhouette } = findBestKmeans(pts, 2, kMax);
      const stats = commentStatistics(selectParticipants(matrix, clusterable), best.labels);
      const sizes: number[] = [];
      for (const l of best.labels) sizes[l] = (sizes[l] ?? 0) + 1;
      const t = c.params.bridgeThreshold * 100;
      value = {
        ready: true,
        k: best.k,
        silhouette,
        sizes: sizes.map((x) => x ?? 0),
        clusterable: clusterable.length,
        statements: nodes.map((n, i) => {
          const pa = sizes.map((_, g) => {
            const s = stats.grouped.find((x) => x.statementId === i && x.groupId === g);
            return s && s.ns > 0 ? Math.round(s.pa * 100) : null;
          });
          const known = pa.filter((x): x is number => x !== null);
          return {
            id: n.id as string,
            text: n.text as string,
            typ: n.typ as string,
            pa,
            bridge: known.length === sizes.length && known.every((x) => x >= t),
            gap: known.length >= 2 ? Math.max(...known) - Math.min(...known) : 0,
          };
        }),
      };
    }
  }
  cache.set(c.id, { key, value });
  return value;
}
