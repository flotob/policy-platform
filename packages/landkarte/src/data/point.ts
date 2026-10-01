import { sql, type Db } from "@policy/db";

import { shortOrg, type Door } from "../vocab.ts";
import { latestAnalysis, loadMeasureSummaries, loadOrgs } from "./consultation.ts";
import { MAP_POINT_SELECT, toMapPoint } from "./measure.ts";
import type { MapPoint, MeasureSummary, Org } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export interface OrgVote {
  org: Org;
  /** 1 = stimmt zu, -1 = lehnt ab, null = äußert sich nicht dazu. */
  value: 1 | -1 | null;
  confidence: number | null;
}

export type EvidenceKind = "data" | "study" | "law" | "case" | "none";

export interface Source {
  org: string;
  submissionId: string;
  quote: string | null;
  /** What evidence the quoted passage gives (Jev, source-evidence.v2); null = not judged. */
  evidence: EvidenceKind | null;
}

/** How one extraction point came to be — the Prüfpfad (paper v7 §8, Laufzettel). */
export interface MemberTrail {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  door: Door | null;
  sources: Source[];
  /** The automatic check after extraction and what the machine editor did. */
  intake: {
    role: string | null;
    flagsBefore: string[];
    action: string | null;
    reason: string | null;
    editorModel: string | null;
    pEvidence: number | null;
  } | null;
  created: { org: string; model: string | null; at: string | null } | null;
  /** Other statements' points recognised as the same argument (Jev). */
  matched: { org: string; pSame: number | null }[];
  measure: { measure: string; confidence: number; secondOpinion: { measure: string; reason: string } | null } | null;
  mapAssign: { confidence: number } | null;
}

export interface Related {
  mapPointId: string;
  label: string;
  scope: string;
  kind: string;
  /** "out": a point here does something to the other; "in": the other to a point here. */
  direction: "out" | "in";
  n: number;
}

export interface PointDetail {
  point: MapPoint;
  measure: MeasureSummary;
  votes: OrgVote[];
  members: MemberTrail[];
  related: Related[];
  reasonsScreen: number | null;
}

export async function loadPoint(db: Db, consultationId: string, mapPointId: string): Promise<PointDetail | null> {
  const mp = await rows<Parameters<typeof toMapPoint>[0] & { diag_flags: Record<string, unknown> | null }>(db, sql`
    SELECT ${MAP_POINT_SELECT} FROM map_points mp WHERE mp.consultation_id = ${consultationId} AND mp.id = ${mapPointId}`);
  if (!mp[0]) return null;
  const point = toMapPoint(mp[0]);
  const measures = await loadMeasureSummaries(db, consultationId);
  const measure = measures.find((m) => m.scope === point.scope)!;
  const analysis = await latestAnalysis(db, consultationId);
  const orgs = await loadOrgs(db, consultationId, analysis);

  const v = await rows<{ participant_id: string; value: number; confidence: number | null }>(db, sql`
    SELECT participant_id, value, confidence FROM map_point_votes WHERE map_point_id = ${mapPointId}`);
  const byParticipant = new Map(v.map((x) => [x.participant_id, x]));
  const votes: OrgVote[] = orgs.map((org) => {
    const x = org.participantId ? byParticipant.get(org.participantId) : undefined;
    return { org, value: x ? (x.value === 1 ? 1 : x.value === -1 ? -1 : null) : null, confidence: x?.confidence ?? null };
  });

  const mem = await rows<{ id: string; label: string; summary: string | null; kind: string; cq: Door | null }>(db, sql`
    SELECT id, label, summary, kind, cq FROM points WHERE map_point_id = ${mapPointId} ORDER BY created_at`);
  const src = await rows<{ point_id: string; org: string | null; submission_id: string; quote: string | null; evidence: EvidenceKind | null }>(db, sql`
    SELECT ps.point_id, s.author_org AS org, ps.submission_id, ps.quote, j.decided->>'kind' AS evidence
    FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
    JOIN points p ON p.id = ps.point_id
    LEFT JOIN judgments j ON j.subject_kind = 'point_source' AND j.subject_id = ps.id::text AND j.family = 'source-evidence.v2'
    WHERE p.map_point_id = ${mapPointId}
    ORDER BY ps.created_at`);
  const jud = await rows<{ subject_id: string; family: string; decided: Record<string, unknown> }>(db, sql`
    SELECT j.subject_id, j.family, j.decided FROM judgments j
    WHERE j.subject_kind = 'point' AND j.family IN ('intake.v2', 'measure.v2', 'map-assign.v2')
      AND j.subject_id IN (SELECT id::text FROM points WHERE map_point_id = ${mapPointId})`);
  const md = await rows<{ created: string | null; matched_point: string | null; outcome: string; org: string | null; confidence: number | null; provenance: Record<string, unknown> | null; created_at: string }>(db, sql`
    SELECT md.provenance->>'createdPoint' AS created, md.matched_point, md.outcome, s.author_org AS org,
      md.confidence, md.provenance, md.created_at::text
    FROM match_decisions md JOIN submissions s ON s.id = md.submission_id
    WHERE md.consultation_id = ${consultationId}
      AND ((md.provenance->>'createdPoint') IN (SELECT id::text FROM points WHERE map_point_id = ${mapPointId})
        OR md.matched_point IN (SELECT id FROM points WHERE map_point_id = ${mapPointId}))`);

  const members: MemberTrail[] = mem.map((p) => {
    const j = (f: string) => jud.find((x) => x.subject_id === p.id && x.family === f)?.decided;
    const intake = j("intake.v2") as
      | { role?: string; origin?: { action?: string; reason?: string; editorModel?: string; flagsBefore?: string[] }; confidence?: { pEvidence?: number } }
      | undefined;
    const meas = j("measure.v2") as { measure: string; confidence: number; secondOpinion?: { measure: string; reason: string } } | undefined;
    const assign = j("map-assign.v2") as { confidence: number } | undefined;
    const creation = md.find((x) => x.created === p.id);
    const dec = (creation?.provenance?.decomposition ?? null) as { model?: string; startedAt?: string } | null;
    return {
      id: p.id,
      label: p.label,
      summary: p.summary,
      kind: p.kind,
      door: p.cq,
      sources: src
        .filter((s) => s.point_id === p.id)
        .map((s) => ({ org: s.org ?? "Stellungnahme", submissionId: s.submission_id, quote: s.quote, evidence: s.evidence })),
      intake: intake
        ? {
            role: intake.role ?? null,
            flagsBefore: intake.origin?.flagsBefore ?? [],
            action: intake.origin?.action ?? null,
            reason: intake.origin?.reason ?? null,
            editorModel: intake.origin?.editorModel ?? null,
            pEvidence: intake.confidence?.pEvidence ?? null,
          }
        : null,
      created: creation ? { org: creation.org ?? "Stellungnahme", model: dec?.model ?? null, at: dec?.startedAt ?? creation.created_at } : null,
      matched: md
        .filter((x) => x.matched_point === p.id && x.outcome === "matched")
        .map((x) => ({ org: x.org ?? "Stellungnahme", pSame: x.confidence ?? ((x.provenance?.match as { pSame?: number } | undefined)?.pSame ?? null) })),
      measure: meas ? { measure: meas.measure, confidence: meas.confidence, secondOpinion: meas.secondOpinion ?? null } : null,
      mapAssign: assign ? { confidence: assign.confidence } : null,
    };
  });

  const rel = await rows<{ other: string; label: string; scope: string; kind: string; direction: "out" | "in"; n: number }>(db, sql`
    SELECT o.id AS other, o.label, o.scope, e.kind, 'out' AS direction, count(*)::int AS n
    FROM point_edges e JOIN points a ON a.id = e.from_point JOIN points b ON b.id = e.to_point
    JOIN map_points o ON o.id = b.map_point_id
    WHERE a.map_point_id = ${mapPointId} AND b.map_point_id <> ${mapPointId}
    GROUP BY o.id, o.label, o.scope, e.kind
    UNION ALL
    SELECT o.id, o.label, o.scope, e.kind, 'in', count(*)::int
    FROM point_edges e JOIN points a ON a.id = e.to_point JOIN points b ON b.id = e.from_point
    JOIN map_points o ON o.id = b.map_point_id
    WHERE a.map_point_id = ${mapPointId} AND b.map_point_id <> ${mapPointId}
    GROUP BY o.id, o.label, o.scope, e.kind
    ORDER BY n DESC`);

  const flags = mp[0].diag_flags ?? {};
  return {
    point,
    measure,
    votes,
    members,
    related: rel.map((r) => ({ mapPointId: r.other, label: r.label, scope: r.scope, kind: r.kind, direction: r.direction, n: r.n })),
    reasonsScreen: typeof flags.reasons_screen === "number" ? flags.reasons_screen : null,
  };
}

export { shortOrg };
