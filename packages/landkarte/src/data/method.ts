import { sql, type Db } from "@policy/db";

import { shortOrg } from "../vocab.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

/** One statement in processing order: how much it added (concept paper v7 §10, Sättigung). */
export interface SaturationStep {
  k: number;
  org: string;
  short: string;
  /** Arguments recognised as new vs as one already on the map. */
  newArguments: number;
  knownArguments: number;
  /** Dispute questions this statement was the first to raise vs all it touched. */
  newQuestions: number;
  touchedQuestions: number;
}

export async function loadSaturation(db: Db, consultationId: string): Promise<SaturationStep[]> {
  const r = await rows<{ k: number; org: string | null; new_args: number; known_args: number; new_q: number; touched_q: number }>(db, sql`
    WITH ord AS (
      SELECT submission_id, row_number() OVER (ORDER BY min(created_at))::int AS k,
        count(*) FILTER (WHERE outcome = 'new')::int AS new_args,
        count(*) FILTER (WHERE outcome = 'matched')::int AS known_args
      FROM match_decisions WHERE consultation_id = ${consultationId} GROUP BY submission_id),
    firsts AS (
      SELECT mp.id, min(o.k) AS k FROM map_points mp
      JOIN points p ON p.map_point_id = mp.id JOIN point_sources ps ON ps.point_id = p.id
      JOIN ord o ON o.submission_id = ps.submission_id
      WHERE mp.consultation_id = ${consultationId} GROUP BY mp.id)
    SELECT o.k, s.author_org AS org, o.new_args, o.known_args,
      (SELECT count(*) FROM firsts f WHERE f.k = o.k)::int AS new_q,
      (SELECT count(DISTINCT p.map_point_id) FROM points p JOIN point_sources ps ON ps.point_id = p.id
        WHERE ps.submission_id = o.submission_id AND p.map_point_id IS NOT NULL)::int AS touched_q
    FROM ord o JOIN submissions s ON s.id = o.submission_id
    ORDER BY o.k`);
  return r.map((x) => {
    const org = x.org ?? "Stellungnahme";
    return {
      k: x.k,
      org,
      short: shortOrg(org),
      newArguments: x.new_args,
      knownArguments: x.known_args,
      newQuestions: x.new_q,
      touchedQuestions: x.touched_q,
    };
  });
}

/**
 * Saturation for many statements: how many dispute questions are known after
 * k statements, in a fixed random order (md5 of the id). Processing order is
 * shortest first, which with hundreds of senders means citizens first and
 * long association statements last — the curve would only show that order.
 */
export async function loadSaturationCurve(db: Db, consultationId: string): Promise<{ k: number; newQuestions: number; known: number }[]> {
  const r = await rows<{ k: number; new_q: number }>(db, sql`
    WITH ord AS (
      SELECT id AS submission_id, row_number() OVER (ORDER BY md5(id::text))::int AS k
      FROM submissions WHERE consultation_id = ${consultationId} AND text IS NOT NULL),
    firsts AS (
      SELECT mp.id, min(o.k) AS k FROM map_points mp
      JOIN points p ON p.map_point_id = mp.id JOIN point_sources ps ON ps.point_id = p.id
      JOIN ord o ON o.submission_id = ps.submission_id
      WHERE mp.consultation_id = ${consultationId} GROUP BY mp.id)
    SELECT o.k, (SELECT count(*) FROM firsts f WHERE f.k = o.k)::int AS new_q
    FROM ord o ORDER BY o.k`);
  let known = 0;
  return r.map((x) => ({ k: x.k, newQuestions: x.new_q, known: (known += x.new_q) }));
}

/** What the machine did in this run — counts from the recorded judgments. */
export async function loadMachineWork(db: Db, consultationId: string) {
  const j = await rows<{ family: string; n: number }>(db, sql`
    SELECT family, count(*)::int AS n FROM judgments WHERE consultation_id = ${consultationId} GROUP BY family`);
  const by = (prefix: string) => j.filter((x) => x.family.startsWith(prefix)).reduce((s, x) => s + x.n, 0);
  const edits = await rows<{ action: string; n: number }>(db, sql`
    SELECT decided->'origin'->>'action' AS action, count(*)::int AS n FROM judgments
    WHERE consultation_id = ${consultationId} AND family = 'intake.v2' AND decided->'origin'->>'action' IS NOT NULL
    GROUP BY 1`);
  return {
    jevJudgments: j.reduce((s, x) => s + x.n, 0),
    intake: by("intake"),
    stances: by("map-stance") + by("point-stance"),
    relations: by("relations"),
    measures: by("measure"),
    edits: Object.fromEntries(edits.map((e) => [e.action, e.n])) as Record<string, number>,
  };
}
