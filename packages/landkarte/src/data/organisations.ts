/**
 * Organisations and their Laufzettel (routing slip, concept paper v7 §8):
 * what became of every argument of one statement, who agrees with whom on the
 * Landkarten-Punkte, and where an organisation stands apart from its own camp.
 * Read-only. Agreement = same inferred vote on the Landkarten-Punkte both voted on.
 */
import { sql, type Db } from "@policy/db";

import type { Diag } from "../vocab.ts";
import type { Camp, Org, Overview } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

/** Below this many shared questions, an agreement count says too little to rank "closest"/"most distant". */
export const MIN_SHARED = 5;

/** Plain German for the submission's author type (as recorded at import). */
export function orgTypeLabel(authorType: string | null): string | null {
  switch (authorType) {
    case "BUSINESS_ASSOCIATION":
      return "Wirtschaftsverband";
    case "NGO":
      return "Nichtregierungsorganisation";
    case "EXPERT":
      return "Sachverständige";
    default:
      return null;
  }
}

export const pagesOf = (chars: number) => Math.max(1, Math.round(chars / 2500));

export interface Agreement {
  other: Org;
  /** Landkarten-Punkte where both took the same position. */
  same: number;
  /** Landkarten-Punkte both took a position on. */
  both: number;
}

export interface OrgCounts {
  /** Released arguments with a source in this statement. */
  args: number;
  onMap: number;
  /** Released, no Landkarten-Punkt, not an open question. */
  singles: number;
  /** Released open questions ("Lücke" raised by the organisation), no Landkarten-Punkt. */
  openQuestions: number;
  /** Landkarten-Punkte this organisation has an (inferred) position on. */
  votes: number;
}

export interface OrgSummary {
  org: Org;
  typeLabel: string | null;
  camp: Camp | null;
  pages: number;
  counts: OrgCounts;
  closest: Agreement | null;
  farthest: Agreement | null;
}

interface VoteRow {
  participant_id: string;
  map_point_id: string;
  value: number;
}

async function loadVotes(db: Db, consultationId: string): Promise<VoteRow[]> {
  return rows<VoteRow>(db, sql`
    SELECT v.participant_id, v.map_point_id, v.value
    FROM map_point_votes v JOIN map_points m ON m.id = v.map_point_id
    WHERE m.consultation_id = ${consultationId} AND v.value <> 0`);
}

/** participant → (map point → value) */
function voteIndex(votes: VoteRow[]): Map<string, Map<string, number>> {
  const by = new Map<string, Map<string, number>>();
  for (const v of votes) {
    let m = by.get(v.participant_id);
    if (!m) by.set(v.participant_id, (m = new Map()));
    m.set(v.map_point_id, v.value);
  }
  return by;
}

function agreementsOf(org: Org, orgs: Org[], idx: Map<string, Map<string, number>>): Agreement[] {
  const mine = org.participantId ? idx.get(org.participantId) : undefined;
  return orgs
    .filter((o) => o.submissionId !== org.submissionId)
    .map((other) => {
      const theirs = other.participantId ? idx.get(other.participantId) : undefined;
      let same = 0;
      let both = 0;
      if (mine && theirs) {
        for (const [mp, v] of mine) {
          const w = theirs.get(mp);
          if (w === undefined) continue;
          both++;
          if (w === v) same++;
        }
      }
      return { other, same, both };
    })
    .sort((a, b) => ratio(b) - ratio(a) || b.both - a.both || a.other.short.localeCompare(b.other.short, "de"));
}

const ratio = (a: Agreement) => (a.both ? a.same / a.both : -1);

function extremes(list: Agreement[]): { closest: Agreement | null; farthest: Agreement | null } {
  const ranked = list.filter((a) => a.both >= MIN_SHARED);
  if (ranked.length === 0) return { closest: null, farthest: null };
  const farthest = [...ranked].sort((a, b) => ratio(a) - ratio(b) || b.both - a.both)[0] ?? null;
  return { closest: ranked[0] ?? null, farthest };
}

async function loadCounts(db: Db, consultationId: string): Promise<Map<string, Omit<OrgCounts, "votes">>> {
  const r = await rows<{ submission_id: string; args: number; on_map: number; singles: number; open_q: number }>(db, sql`
    SELECT ps.submission_id,
      count(DISTINCT p.id)::int AS args,
      count(DISTINCT p.id) FILTER (WHERE p.map_point_id IS NOT NULL)::int AS on_map,
      count(DISTINCT p.id) FILTER (WHERE p.map_point_id IS NULL AND p.kind <> 'gap')::int AS singles,
      count(DISTINCT p.id) FILTER (WHERE p.map_point_id IS NULL AND p.kind = 'gap')::int AS open_q
    FROM point_sources ps JOIN points p ON p.id = ps.point_id
    WHERE p.consultation_id = ${consultationId} AND p.status = 'released'
    GROUP BY ps.submission_id`);
  return new Map(r.map((x) => [x.submission_id, { args: x.args, onMap: x.on_map, singles: x.singles, openQuestions: x.open_q }]));
}

function summarise(o: Overview, org: Org, counts: Map<string, Omit<OrgCounts, "votes">>, idx: Map<string, Map<string, number>>) {
  const agreements = agreementsOf(org, o.orgs, idx);
  const c = counts.get(org.submissionId) ?? { args: 0, onMap: 0, singles: 0, openQuestions: 0 };
  const summary: OrgSummary = {
    org,
    typeLabel: orgTypeLabel(org.type),
    camp: o.camps.find((x) => x.group === org.camp) ?? null,
    pages: pagesOf(org.chars),
    counts: { ...c, votes: org.participantId ? (idx.get(org.participantId)?.size ?? 0) : 0 },
    ...extremes(agreements),
  };
  return { summary, agreements };
}

/** Every organisation with its counts and its closest and most distant other organisation. */
export async function loadOrganisations(db: Db, o: Overview): Promise<OrgSummary[]> {
  const idx = voteIndex(await loadVotes(db, o.id));
  const counts = await loadCounts(db, o.id);
  return o.orgs.map((org) => summarise(o, org, counts, idx).summary);
}

/* ------------------------------------------------------------------ profile */

export interface StandApart {
  mapPoint: { id: string; label: string; text: string; scope: string; diag: Diag | null };
  /** This organisation's inferred position. */
  value: 1 | -1;
  /** Other organisations of its own camp, by position. */
  campAgree: string[];
  campDisagree: string[];
  /** Nobody else took a position on this Landkarten-Punkt. */
  only: boolean;
}

export type EditAction = "split" | "rewrite" | "keep" | "as_extracted" | "rejected";

export interface SlipEntry {
  pointId: string;
  label: string;
  summary: string | null;
  kind: string;
  status: string;
  measure: string | null;
  mapPoint: { id: string; label: string; text: string; diag: Diag | null } | null;
  /** This organisation's original sentences (verbatim). */
  quotes: string[];
  /** Other organisations that made the same argument (same extraction point). */
  alsoBy: string[];
  /** The organisation whose wording the point carries, when it was not this one. */
  firstBy: string | null;
  /** What the automatic check and the machine editor did — only for points this statement produced. */
  edit: {
    action: EditAction | null;
    reason: string | null;
    flagsBefore: string[];
    /** What the re-check still found afterwards (reason for a rejection). */
    flagsAfter: string[];
    /** For split points: the original passage (shared by its pieces) and how many arguments came out of it. */
    passage: string | null;
    pieces: number;
  } | null;
  /** For merged points whose target is not on this slip: the argument it was folded into. */
  mergedInto: { id: string; label: string; mapPointId: string | null; by: string[] } | null;
  /** Other wordings from this same statement that the machine folded into this argument (duplicates). */
  folded: { label: string; summary: string | null }[];
}

export interface SlipCounts {
  args: number;
  onMap: number;
  singles: number;
  openQuestions: number;
  /** Arguments said by at least one other organisation too. */
  shared: number;
  /** Arguments first brought by another organisation (this one was recognised as saying the same). */
  matchedToOthers: number;
  rewritten: number;
  /** Arguments that came out of splitting, and how many original passages were split. */
  splitPieces: number;
  splitPassages: number;
  /** Checked again after a warning and left as they were. */
  keptAfterCheck: number;
  merged: number;
  rejected: number;
}

export interface OrgProfile {
  summary: OrgSummary;
  agreements: Agreement[];
  apart: StandApart[];
  slip: SlipEntry[];
  slipCounts: SlipCounts;
}

interface SlipRow {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  status: string;
  measure: string | null;
  map_point_id: string | null;
  mp_label: string | null;
  mp_text: string | null;
  mp_diag: Diag | null;
  quotes: string[] | null;
  also_by: string[] | null;
  creator: string | null;
  creator_org: string | null;
  extraction: string | null;
  origin: { action?: string; reason?: string; candidate?: number; flagsBefore?: string[] } | null;
  flags_after: string[] | null;
  merged_into: string | null;
  merged_label: string | null;
  merged_map_point: string | null;
  merged_by: string[] | null;
}

async function loadSlip(db: Db, consultationId: string, submissionId: string): Promise<SlipEntry[]> {
  const r = await rows<SlipRow>(db, sql`
    WITH created AS (
      SELECT DISTINCT ON (md.provenance->>'createdPoint') (md.provenance->>'createdPoint')::uuid AS point_id,
        md.submission_id, md.provenance->>'extraction' AS extraction
      FROM match_decisions md
      WHERE md.consultation_id = ${consultationId} AND md.provenance ? 'createdPoint'
      ORDER BY md.provenance->>'createdPoint', md.created_at DESC
    ), mine AS (
      SELECT point_id FROM point_sources WHERE submission_id = ${submissionId}
      UNION
      SELECT c.point_id FROM created c JOIN points p ON p.id = c.point_id
      WHERE c.submission_id = ${submissionId} AND p.status <> 'released'
    )
    SELECT p.id, p.label, p.summary, p.kind, p.status, p.measure, p.map_point_id,
      mp.label AS mp_label, mp.text AS mp_text, mp.diag AS mp_diag,
      (SELECT array_agg(ps.quote ORDER BY ps.created_at) FROM point_sources ps
        WHERE ps.point_id = p.id AND ps.submission_id = ${submissionId} AND ps.quote IS NOT NULL) AS quotes,
      (SELECT array_agg(DISTINCT COALESCE(s.author_org, 'Stellungnahme')) FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
        WHERE ps.point_id = p.id AND ps.submission_id <> ${submissionId}) AS also_by,
      cr.submission_id AS creator, cs.author_org AS creator_org, cr.extraction,
      j.decided->'origin' AS origin, j.decided->'flags' AS flags_after,
      p.merged_into, t.label AS merged_label, t.map_point_id AS merged_map_point,
      (SELECT array_agg(DISTINCT COALESCE(s.author_org, 'Stellungnahme')) FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
        WHERE ps.point_id = t.id) AS merged_by
    FROM points p
    JOIN mine ON mine.point_id = p.id
    LEFT JOIN map_points mp ON mp.id = p.map_point_id
    LEFT JOIN created cr ON cr.point_id = p.id
    LEFT JOIN submissions cs ON cs.id = cr.submission_id
    LEFT JOIN judgments j ON j.subject_kind = 'point' AND j.subject_id = p.id::text AND j.family = 'intake.v2'
    LEFT JOIN points t ON t.id = p.merged_into
    WHERE p.consultation_id = ${consultationId}
    ORDER BY p.created_at, p.id`);

  // Pieces of the same split passage share extraction + candidate index.
  const passage = (x: SlipRow) => (x.origin?.action === "split" && x.extraction != null ? `${x.extraction}#${x.origin.candidate ?? ""}` : null);
  const pieces = new Map<string, number>();
  for (const x of r) {
    if (x.creator !== submissionId) continue;
    const k = passage(x);
    if (k) pieces.set(k, (pieces.get(k) ?? 0) + 1);
  }

  const entries = r.map((x): SlipEntry => {
    const own = x.creator === submissionId || x.creator == null;
    const k = passage(x);
    return {
      pointId: x.id,
      label: x.label,
      summary: x.summary,
      kind: x.kind,
      status: x.status,
      measure: x.measure,
      mapPoint: x.map_point_id ? { id: x.map_point_id, label: x.mp_label ?? "", text: x.mp_text ?? "", diag: x.mp_diag } : null,
      quotes: x.quotes ?? [],
      alsoBy: (x.also_by ?? []).sort((a, b) => a.localeCompare(b, "de")),
      firstBy: own ? null : (x.creator_org ?? "Stellungnahme"),
      edit:
        own && x.origin
          ? {
              action: (x.origin.action as EditAction | undefined) ?? null,
              reason: x.origin.reason ?? null,
              flagsBefore: x.origin.flagsBefore ?? [],
              flagsAfter: Array.isArray(x.flags_after) ? x.flags_after : [],
              passage: k,
              pieces: k ? (pieces.get(k) ?? 1) : 1,
            }
          : null,
      mergedInto:
        x.merged_into && x.merged_label ? { id: x.merged_into, label: x.merged_label, mapPointId: x.merged_map_point, by: x.merged_by ?? [] } : null,
      folded: [],
    };
  });

  // A duplicate wording folded into an argument that is itself on this slip is shown on that argument, not twice.
  const byId = new Map(entries.map((e) => [e.pointId, e]));
  return entries.filter((e) => {
    const target = e.status === "merged" && e.mergedInto ? byId.get(e.mergedInto.id) : undefined;
    if (!target) return true;
    target.folded.push({ label: e.label, summary: e.summary });
    return false;
  });
}

function slipCounts(slip: SlipEntry[]): SlipCounts {
  const rel = slip.filter((s) => s.status === "released");
  const own = rel.filter((s) => s.edit);
  const split = own.filter((s) => s.edit?.action === "split");
  return {
    args: rel.length,
    onMap: rel.filter((s) => s.mapPoint).length,
    singles: rel.filter((s) => !s.mapPoint && s.kind !== "gap").length,
    openQuestions: rel.filter((s) => !s.mapPoint && s.kind === "gap").length,
    shared: rel.filter((s) => s.alsoBy.length > 0).length,
    matchedToOthers: rel.filter((s) => s.firstBy).length,
    rewritten: own.filter((s) => s.edit?.action === "rewrite").length,
    splitPieces: split.length,
    splitPassages: new Set(split.map((s) => s.edit?.passage ?? s.pointId)).size,
    keptAfterCheck: own.filter((s) => s.edit?.action === "keep").length,
    merged: slip.filter((s) => s.status === "merged").length + slip.reduce((n, s) => n + s.folded.length, 0),
    rejected: slip.filter((s) => s.status === "rejected").length,
  };
}

async function loadApart(
  db: Db,
  consultationId: string,
  org: Org,
  orgs: Org[],
  idx: Map<string, Map<string, number>>,
): Promise<StandApart[]> {
  const mine = org.participantId ? idx.get(org.participantId) : undefined;
  if (!mine || mine.size === 0) return [];
  const campMates = orgs.filter((o) => o.submissionId !== org.submissionId && org.camp != null && o.camp === org.camp);
  const others = orgs.filter((o) => o.submissionId !== org.submissionId);
  const hits: { mp: string; value: 1 | -1; agree: string[]; disagree: string[]; only: boolean }[] = [];
  for (const [mp, v] of mine) {
    const value = v > 0 ? 1 : -1;
    const voteOf = (o: Org) => (o.participantId ? idx.get(o.participantId)?.get(mp) : undefined);
    const only = others.every((o) => voteOf(o) === undefined);
    const agree = campMates.filter((o) => (voteOf(o) ?? 0) > 0).map((o) => o.name);
    const disagree = campMates.filter((o) => (voteOf(o) ?? 0) < 0).map((o) => o.name);
    const majority = agree.length > disagree.length ? 1 : disagree.length > agree.length ? -1 : 0;
    if (only || (majority !== 0 && majority !== value)) hits.push({ mp, value, agree, disagree, only });
  }
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.mp);
  const mps = await rows<{ id: string; label: string; text: string; scope: string; diag: Diag | null }>(db, sql`
    SELECT id, label, text, scope, diag FROM map_points
    WHERE consultation_id = ${consultationId} AND id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`);
  const byId = new Map(mps.map((m) => [m.id, m]));
  return hits
    .filter((h) => byId.has(h.mp))
    .map((h) => ({ mapPoint: byId.get(h.mp)!, value: h.value, campAgree: h.agree, campDisagree: h.disagree, only: h.only }))
    // Clearest dissent first: the whole rest of the camp on the other side.
    .sort(
      (a, b) =>
        Number(a.only) - Number(b.only) ||
        (b.value === 1 ? b.campDisagree.length : b.campAgree.length) - (a.value === 1 ? a.campDisagree.length : a.campAgree.length) ||
        a.mapPoint.scope.localeCompare(b.mapPoint.scope, "de") ||
        a.mapPoint.label.localeCompare(b.mapPoint.label, "de"),
    );
}

/** One organisation: counts, agreement ranking, where it stands apart, and its Laufzettel. */
export async function loadOrgProfile(db: Db, o: Overview, submissionId: string): Promise<OrgProfile | null> {
  const org = o.orgs.find((x) => x.submissionId === submissionId);
  if (!org) return null;
  const idx = voteIndex(await loadVotes(db, o.id));
  const counts = await loadCounts(db, o.id);
  const { summary, agreements } = summarise(o, org, counts, idx);
  const slip = await loadSlip(db, o.id, submissionId);
  const apart = await loadApart(db, o.id, org, o.orgs, idx);
  return { summary, agreements, apart, slip, slipCounts: slipCounts(slip) };
}
