import { sql } from "@policy/db";
import type { SpineSlot } from "@policy/chain";

import { getDb } from "./db";
import { normalizeAuthorType } from "./author-type";
import type { CGPoint } from "./types";

export type { CGPoint } from "./types";

/**
 * Common Ground shows a consultation only when it carries the full current
 * data model: two NAMED camps from the latest analysis, door-classified
 * objections, measure segmentation, and actual votes. Anything less is a
 * work-in-progress state that belongs in the workbench app, not here.
 */

export interface CampInfo {
  group: number;
  name: string;
  summary: string | null;
  size: number;
  topTypes: { type: string; n: number }[];
}

export interface CGStats {
  participants: number;
  submissions: number;
  points: number;
  votes: number;
  realVotes: number;
  inferredVotes: number;
}

export interface ConsultationBundle {
  id: string;
  ref: string;
  title: string;
  camps: CampInfo[];
  stats: CGStats;
  points: CGPoint[];
  /** Distinct measure names (excluding the shared trunk), largest first. */
  measures: { name: string; count: number }[];
}

interface AnalysisResult {
  clustering: { k: number; groupSizes: Record<string, number> };
  statements: {
    pointId: string;
    perGroup: { group: number; pa: number; pd: number; ns: number }[];
  }[];
  campNames?: Record<string, { name: string; summary?: string }>;
  participantGroups: { group: number; authorType: string | null }[];
}

async function latestAnalysis(consultationId: string): Promise<AnalysisResult | null> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT result FROM analysis_runs WHERE consultation_id = ${consultationId}
    ORDER BY created_at DESC LIMIT 1
  `);
  return (res.rows[0]?.result ?? null) as AnalysisResult | null;
}

/** IDs + display data of every consultation that meets the bar, newest first. */
export async function listReadyConsultations(): Promise<
  { id: string; ref: string; title: string }[]
> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT c.id, c.source_ref, c.title
    FROM consultations c
    WHERE EXISTS (SELECT 1 FROM points p WHERE p.consultation_id = c.id AND p.cq IS NOT NULL)
      AND EXISTS (SELECT 1 FROM points p WHERE p.consultation_id = c.id AND p.measure IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = c.id
      )
    ORDER BY c.created_at DESC
  `);
  const rows = res.rows as { id: string; source_ref: string | null; title: string }[];
  const ready: { id: string; ref: string; title: string }[] = [];
  for (const row of rows) {
    const analysis = await latestAnalysis(row.id);
    const namedCamps = Object.keys(analysis?.campNames ?? {}).length;
    if (analysis && analysis.clustering.k >= 2 && namedCamps >= 2) {
      ready.push({ id: row.id, ref: row.source_ref ?? row.id, title: row.title });
    }
  }
  return ready;
}

/** Everything the consultation page needs, or null if not found / not ready. */
export async function loadConsultation(ref: string): Promise<ConsultationBundle | null> {
  const db = getDb();
  const consRes = await db.execute(sql`
    SELECT id, source_ref, title FROM consultations
    WHERE source_ref = ${ref} OR id::text = ${ref}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (consRes.rows.length === 0) return null;
  const cons = consRes.rows[0] as { id: string; source_ref: string | null; title: string };

  const analysis = await latestAnalysis(cons.id);
  if (!analysis || analysis.clustering.k < 2) return null;
  const campNames = analysis.campNames ?? {};
  if (Object.keys(campNames).length < 2) return null;

  const pointsRes = await db.execute(sql`
    SELECT p.id, p.kind, p.slot, p.label, p.summary, p.finding, p.status, p.theme,
      p.cq, p.answers_cq, p.measure
    FROM points p
    WHERE p.consultation_id = ${cons.id} AND p.status IN ('draft', 'released')
    ORDER BY p.created_at
  `);
  const perGroupByPoint = new Map(
    analysis.statements.map((s) => [s.pointId, s.perGroup]),
  );
  const points: CGPoint[] = (pointsRes.rows as {
    id: string; kind: string; slot: SpineSlot | null; label: string;
    summary: string | null; finding: string | null; status: string;
    theme: string | null; cq: string | null; answers_cq: string[] | null;
    measure: string | null;
  }[]).map((p) => ({
    id: p.id,
    kind: p.kind,
    slot: p.slot,
    label: p.label,
    summary: p.summary,
    finding: p.finding,
    status: p.status,
    theme: p.theme,
    cq: p.cq,
    answersCq: p.answers_cq,
    measure: p.measure,
    perGroup: perGroupByPoint.get(p.id),
  }));

  // Not ready without the full Iteration-2 layers.
  if (!points.some((p) => p.cq !== null)) return null;
  if (!points.some((p) => p.measure !== null)) return null;

  const statsRes = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM participants pa WHERE pa.consultation_id = ${cons.id})::int AS participants,
      (SELECT count(*) FROM submissions su WHERE su.consultation_id = ${cons.id})::int AS submissions,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${cons.id})::int AS votes,
      (SELECT count(*) FROM votes v JOIN participants pa ON pa.id = v.participant_id
        WHERE pa.consultation_id = ${cons.id} AND v.method = 'inferred')::int AS inferred
  `);
  const s = statsRes.rows[0] as {
    participants: number; submissions: number; votes: number; inferred: number;
  };
  const stats: CGStats = {
    participants: s.participants,
    submissions: s.submissions,
    points: points.length,
    votes: s.votes,
    realVotes: s.votes - s.inferred,
    inferredVotes: s.inferred,
  };
  if (stats.votes === 0) return null;

  const typeCount = new Map<number, Map<string, number>>();
  for (const p of analysis.participantGroups) {
    const raw = p.authorType ?? "";
    if (!raw || raw === "?") continue;
    const type = normalizeAuthorType(raw);
    const m = typeCount.get(p.group) ?? new Map<string, number>();
    m.set(type, (m.get(type) ?? 0) + 1);
    typeCount.set(p.group, m);
  }
  const camps: CampInfo[] = Object.entries(analysis.clustering.groupSizes)
    .map(([g, size]) => ({
      group: Number(g),
      name: campNames[g]?.name ?? `Lager ${g}`,
      summary: campNames[g]?.summary ?? null,
      size,
      topTypes: [...(typeCount.get(Number(g)) ?? new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([type, n]) => ({ type, n })),
    }))
    .sort((a, b) => b.size - a.size);

  const measureCount = new Map<string, number>();
  for (const p of points) {
    if (p.measure && p.measure !== "übergreifend") {
      measureCount.set(p.measure, (measureCount.get(p.measure) ?? 0) + 1);
    }
  }
  const measures = [...measureCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    id: cons.id,
    ref: cons.source_ref ?? cons.id,
    title: cons.title,
    camps,
    stats,
    points,
    measures,
  };
}
