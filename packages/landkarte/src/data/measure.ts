import { sql, type Db } from "@policy/db";

import type { Bezirk, Diag, Door, Typ } from "../vocab.ts";
import { loadMeasureSummaries } from "./consultation.ts";
import type { CampCount, MapPoint, MeasureSummary, Quote, SinglePoint } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

interface MapPointRow {
  id: string;
  scope: string;
  ord: number;
  typ: Typ;
  bezirk: Bezirk;
  question: string | null;
  text: string;
  label: string;
  diag: Diag | null;
  pa: number | null;
  pb: number | null;
  n_voted: number;
  befund: string | null;
  diag_flags: { votes?: { a: CampCount; b: CampCount }; reasons?: string; reasons_rationale?: string } | null;
  quotes: Quote[] | null;
  members: number;
  orgs: number;
  door: Door | null;
}

export function toMapPoint(r: MapPointRow): MapPoint {
  return {
    id: r.id,
    scope: r.scope,
    ord: r.ord,
    typ: r.typ,
    bezirk: r.bezirk,
    question: r.question,
    text: r.text,
    label: r.label,
    diag: r.diag,
    pa: r.pa,
    pb: r.pb,
    nVoted: r.n_voted,
    befund: r.befund,
    votes: r.diag_flags?.votes ?? null,
    reasons: r.diag_flags?.reasons ?? null,
    reasonsRationale: r.diag_flags?.reasons_rationale ?? null,
    quotes: r.quotes ?? [],
    members: r.members,
    orgs: r.orgs,
    door: r.door,
  };
}

/** Map points with member counts and the members' most common critical question. */
export const MAP_POINT_SELECT = sql`
  mp.id, mp.scope, mp.ord, mp.typ, mp.bezirk, mp.question, mp.text, mp.label, mp.diag, mp.pa, mp.pb,
  mp.n_voted, mp.befund, mp.diag_flags, mp.quotes,
  (SELECT count(*) FROM points p WHERE p.map_point_id = mp.id)::int AS members,
  (SELECT count(DISTINCT ps.submission_id) FROM points p JOIN point_sources ps ON ps.point_id = p.id
    WHERE p.map_point_id = mp.id)::int AS orgs,
  (SELECT p.cq FROM points p WHERE p.map_point_id = mp.id AND p.cq IS NOT NULL
    GROUP BY p.cq ORDER BY count(*) DESC, p.cq LIMIT 1) AS door`;

export interface MeasureDetail {
  summary: MeasureSummary;
  points: MapPoint[];
  singles: SinglePoint[];
  /** All measures, for navigation. */
  all: MeasureSummary[];
}

export async function loadMeasure(db: Db, consultationId: string, slug: string): Promise<MeasureDetail | null> {
  const all = await loadMeasureSummaries(db, consultationId);
  const summary = all.find((m) => m.slug === slug);
  if (!summary) return null;
  const pts = await rows<MapPointRow>(db, sql`
    SELECT ${MAP_POINT_SELECT} FROM map_points mp
    WHERE mp.consultation_id = ${consultationId} AND mp.scope = ${summary.scope}
    ORDER BY mp.ord`);
  const singles = await rows<{ id: string; label: string; summary: string | null; orgs: string[]; agree: string[] | null; disagree: string[] | null }>(db, sql`
    SELECT p.id, p.label, p.summary,
      COALESCE((SELECT array_agg(DISTINCT COALESCE(s.author_org, 'Stellungnahme')) FROM point_sources ps
        JOIN submissions s ON s.id = ps.submission_id WHERE ps.point_id = p.id), '{}') AS orgs,
      (SELECT array(SELECT jsonb_array_elements_text(j.decided->'agree'))) AS agree,
      (SELECT array(SELECT jsonb_array_elements_text(j.decided->'disagree'))) AS disagree
    FROM points p
    LEFT JOIN judgments j ON j.subject_kind = 'point' AND j.subject_id = p.id::text AND j.family = 'point-stance.v1'
    WHERE p.consultation_id = ${consultationId} AND p.measure = ${summary.scope} AND p.map_point_id IS NULL
      AND p.status = 'released' AND p.kind <> 'gap' AND p.created_by <> 'import:questionnaire'
    ORDER BY p.label`);
  return {
    summary,
    all,
    points: pts.map(toMapPoint),
    singles: singles
      .map((s) => ({
        id: s.id,
        label: s.label,
        summary: s.summary,
        orgs: s.orgs,
        agree: (s.agree ?? []).filter((o) => !s.orgs.includes(o)),
        disagree: s.disagree ?? [],
      }))
      // Contested first (the rare point others reject may be decisive), then by how many take a position.
      .sort(
        (a, b) =>
          Number(b.disagree.length > 0 && b.agree.length + b.orgs.length > 0) -
            Number(a.disagree.length > 0 && a.agree.length + a.orgs.length > 0) ||
          b.agree.length + b.disagree.length - (a.agree.length + a.disagree.length) ||
          a.label.localeCompare(b.label, "de"),
      ),
  };
}

/** Every Landkarten-Punkt of the consultation (for the Lagebild, agenda, report). */
export async function loadAllMapPoints(db: Db, consultationId: string): Promise<MapPoint[]> {
  const pts = await rows<MapPointRow>(db, sql`
    SELECT ${MAP_POINT_SELECT} FROM map_points mp
    WHERE mp.consultation_id = ${consultationId}
    ORDER BY mp.scope, mp.ord`);
  return pts.map(toMapPoint);
}

/** Organisations agreeing across both camps — how broad a bridge is. */
export function breadth(p: MapPoint): number {
  return p.votes ? p.votes.a.agree + p.votes.b.agree : 0;
}

/** How far apart the camps are on a point (counts-based share, 0–1). */
export function gap(p: MapPoint): number {
  if (!p.votes) return 0;
  const share = (c: { agree: number; disagree: number }) => (c.agree + c.disagree ? c.agree / (c.agree + c.disagree) : 0.5);
  return Math.abs(share(p.votes.a) - share(p.votes.b));
}
