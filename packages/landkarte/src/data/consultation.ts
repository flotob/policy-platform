import { sql, type Db } from "@policy/db";

import { verdictOf } from "../verdict.ts";
import { displayScope, shortNames, slugOf, WHOLE, BEYOND, type Diag } from "../vocab.ts";
import type { Camp, MeasureSummary, Org, Overview } from "./types.ts";

type Row = Record<string, unknown>;
const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export interface ConsultationRef {
  id: string;
  ref: string;
  title: string;
  sourceSystem: string | null;
}

/** A consultation by its stable source_ref (e.g. "302875") or its UUID. */
export async function findConsultation(db: Db, ref: string): Promise<ConsultationRef | null> {
  const r = await rows<{ id: string; title: string; source_ref: string | null; source_system: string | null }>(db, sql`
    SELECT id, title, source_ref, source_system FROM consultations
    WHERE id::text = ${ref} OR source_ref = ${ref}
    ORDER BY created_at DESC LIMIT 1`);
  const c = r[0];
  return c ? { id: c.id, ref: c.source_ref ?? c.id, title: c.title, sourceSystem: c.source_system } : null;
}

/** The draft under consultation, from its documents: a bill, else a draft strategy. */
export async function draftOf(db: Db, consultationId: string): Promise<{ kind: "law" | "strategy"; title: string }> {
  const kinds = (await rows<{ kind: string }>(db, sql`SELECT DISTINCT kind FROM consultation_documents WHERE consultation_id = ${consultationId}`)).map((r) => r.kind);
  return kinds.includes("drucksache:Gesetzentwurf") || !kinds.includes("strategie:Entwurf")
    ? { kind: "law", title: "Das Gesetz" }
    : { kind: "strategy", title: "Die Strategie" };
}

/** Consultations the app can show: those with a Landkarte. */
export async function listConsultations(db: Db): Promise<{ ref: string; title: string; statements: number; mapPoints: number; measures: number }[]> {
  return rows(db, sql`
    SELECT COALESCE(c.source_ref, c.id::text) AS ref, c.title,
      (SELECT count(*) FROM submissions s WHERE s.consultation_id = c.id AND s.text IS NOT NULL)::int AS statements,
      count(m.*)::int AS "mapPoints", count(DISTINCT m.scope)::int AS measures
    FROM consultations c JOIN map_points m ON m.consultation_id = c.id AND m.typ <> 'luecke'
    GROUP BY c.id ORDER BY max(m.created_at) ASC`);
}

export interface AnalysisResult {
  clustering: { k: number; groupSizes: Record<string, number>; silhouette?: number };
  campNames?: Record<string, { name: string; summary?: string }>;
  participantGroups: { participant: string; group: number; authorOrg?: string | null }[];
  statements: { pointId: string; perGroup: { group: number; pa: number; pd: number; ns: number }[] }[];
}

/** The latest camp analysis over the votes on Landkarten-Punkte. */
export async function latestAnalysis(db: Db, consultationId: string): Promise<AnalysisResult | null> {
  const r = await rows<{ result: AnalysisResult }>(db, sql`
    SELECT result FROM analysis_runs
    WHERE consultation_id = ${consultationId} AND engine LIKE '%map-points'
    ORDER BY created_at DESC LIMIT 1`);
  return r[0]?.result ?? null;
}

/** Organisations (one per submission) with their camp. */
export async function loadOrgs(db: Db, consultationId: string, analysis: AnalysisResult | null): Promise<Org[]> {
  const subs = await rows<{ id: string; author_org: string | null; author_type: string | null; chars: number; pid: string | null; points: number }>(db, sql`
    SELECT s.id, s.author_org, s.author_type, length(s.text)::int AS chars, pa.id AS pid,
      (SELECT count(DISTINCT ps.point_id) FROM point_sources ps JOIN points p ON p.id = ps.point_id
        WHERE ps.submission_id = s.id AND p.status = 'released')::int AS points
    FROM submissions s
    LEFT JOIN participants pa ON pa.consultation_id = s.consultation_id AND pa.source_ref = 'inferred:' || s.id::text
    WHERE s.consultation_id = ${consultationId} AND s.text IS NOT NULL
    ORDER BY length(s.text) DESC`);
  const groupOf = new Map((analysis?.participantGroups ?? []).map((p) => [p.participant, p.group]));
  const short = shortNames(subs.map((s) => s.author_org ?? "Stellungnahme"));
  return subs.map((s) => {
    const name = s.author_org ?? "Stellungnahme";
    return {
      submissionId: s.id,
      participantId: s.pid,
      name,
      short: short.get(name)!,
      type: s.author_type,
      chars: s.chars,
      points: s.points,
      camp: s.pid ? (groupOf.get(s.pid) ?? null) : null,
    };
  });
}

/** Camps, larger first ("a" = larger). */
export function campsOf(analysis: AnalysisResult | null, orgs: Org[]): Camp[] {
  if (!analysis) return [];
  return Object.entries(analysis.clustering.groupSizes)
    .map(([g, n]) => ({ group: Number(g), size: n }))
    .sort((x, y) => y.size - x.size || x.group - y.group)
    .slice(0, 2)
    .map((c, i) => ({
      group: c.group,
      size: c.size,
      name: analysis.campNames?.[String(c.group)]?.name ?? `Lager ${i + 1}`,
      summary: analysis.campNames?.[String(c.group)]?.summary ?? null,
      orgs: orgs.filter((o) => o.camp === c.group).map((o) => o.name),
      named: orgs.filter((o) => o.camp === c.group && o.type !== "PRIVATE").map((o) => o.name),
      people: orgs.filter((o) => o.camp === c.group && o.type === "PRIVATE").length,
      side: i === 0 ? ("a" as const) : ("b" as const),
    }));
}

export interface BillMeasure {
  name: string;
  description: string;
  paragraphs: number[];
  other: string[];
}

/** The measures read from the bill (propose-measures-bill.ts), in the bill's order. */
export async function billMeasures(db: Db, consultationId: string): Promise<BillMeasure[]> {
  const r = await rows<{ payload: { details?: BillMeasure[] } }>(db, sql`
    SELECT payload FROM audit_log
    WHERE action = 'consultation.propose_measures' AND subject_id = ${consultationId} AND payload ? 'details'
    ORDER BY created_at DESC LIMIT 1`);
  return r[0]?.payload.details ?? [];
}

/** Order of measures in the interface: the whole first, the bill's order, beyond last. */
export function measureOrder(bill: BillMeasure[]) {
  const pos = new Map(bill.map((m, i) => [m.name, i + 1]));
  return (scope: string) => (scope === WHOLE ? 0 : scope === BEYOND ? 999 : (pos.get(scope) ?? 500));
}

export async function loadMeasureSummaries(db: Db, consultationId: string): Promise<MeasureSummary[]> {
  const bill = await billMeasures(db, consultationId);
  const byName = new Map(bill.map((m) => [m.name, m]));
  const order = measureOrder(bill);
  const mp = await rows<{ scope: string; diag: string | null; typ: string; has_numbers: boolean; n: number }>(db, sql`
    SELECT scope, diag, typ, (pa IS NOT NULL) AS has_numbers, count(*)::int AS n
    FROM map_points WHERE consultation_id = ${consultationId}
    GROUP BY scope, diag, typ, (pa IS NOT NULL)`);
  const ep = await rows<{ measure: string; n: number; singles: number }>(db, sql`
    SELECT measure, count(*)::int AS n, count(*) FILTER (WHERE map_point_id IS NULL)::int AS singles
    FROM points
    WHERE consultation_id = ${consultationId} AND status = 'released' AND kind <> 'gap'
      AND created_by <> 'import:questionnaire' AND measure IS NOT NULL
    GROUP BY measure`);
  const kerns = await rows<{ scope: string; id: string; label: string; question: string | null }>(db, sql`
    SELECT scope, id, label, question FROM map_points WHERE consultation_id = ${consultationId} AND diag = 'kern'`);

  const scopes = new Set([...mp.map((r) => r.scope), ...ep.map((r) => r.measure)]);
  return [...scopes]
    .map((scope): MeasureSummary => {
      const own = mp.filter((r) => r.scope === scope && r.typ !== "luecke");
      const counts: Partial<Record<Diag, number>> = {};
      for (const r of mp.filter((x) => x.scope === scope)) {
        if (r.diag) counts[r.diag as Diag] = (counts[r.diag as Diag] ?? 0) + r.n;
      }
      const points = own.reduce((s, r) => s + r.n, 0);
      const withNumbers = own.filter((r) => r.has_numbers).reduce((s, r) => s + r.n, 0);
      const e = ep.find((r) => r.measure === scope);
      const k = kerns.find((r) => r.scope === scope);
      const b = byName.get(scope);
      return {
        scope,
        display: displayScope(scope),
        slug: slugOf(scope),
        description: b?.description ?? null,
        paragraphs: b?.paragraphs ?? [],
        points,
        withNumbers,
        counts,
        verdict: verdictOf({ points, withNumbers, counts }),
        extractionPoints: e?.n ?? 0,
        singles: e?.singles ?? 0,
        kern: k ? { id: k.id, label: k.label, question: k.question } : null,
      };
    })
    .sort((x, y) => order(x.scope) - order(y.scope));
}

export async function loadOverview(db: Db, ref: string): Promise<Overview | null> {
  const c = await findConsultation(db, ref);
  if (!c) return null;
  const analysis = await latestAnalysis(db, c.id);
  const orgs = await loadOrgs(db, c.id, analysis);
  const camps = campsOf(analysis, orgs);
  const measures = await loadMeasureSummaries(db, c.id);
  const st = (
    await rows<Row>(db, sql`
      SELECT
        (SELECT count(*) FROM points WHERE consultation_id = ${c.id} AND status = 'released')::int AS points,
        (SELECT count(*) FROM map_points WHERE consultation_id = ${c.id} AND typ <> 'luecke')::int AS map_points,
        (SELECT count(*) FROM points WHERE consultation_id = ${c.id} AND status = 'released' AND kind <> 'gap' AND map_point_id IS NULL)::int AS singles,
        (SELECT count(*) FROM map_point_votes v JOIN map_points m ON m.id = v.map_point_id WHERE m.consultation_id = ${c.id})::int AS votes,
        (SELECT count(*) FROM point_edges e JOIN points p ON p.id = e.from_point WHERE p.consultation_id = ${c.id})::int AS relations,
        (SELECT count(*) FROM point_edges e JOIN points p ON p.id = e.from_point WHERE p.consultation_id = ${c.id}
           AND NOT EXISTS (SELECT 1 FROM point_sources a JOIN point_sources b ON a.submission_id = b.submission_id
                           WHERE a.point_id = e.from_point AND b.point_id = e.to_point))::int AS cross_relations`)
  )[0]!;
  const chars = orgs.reduce((s, o) => s + o.chars, 0);
  const { sourceSystem, ...cons } = c;
  return {
    ...cons,
    procedure: sourceSystem === "harvester:dip" ? "Anhörung" : "Konsultation",
    draft: await draftOf(db, c.id),
    orgs,
    camps,
    measures,
    stats: {
      statements: orgs.length,
      privatePersons: orgs.filter((x) => x.type === "PRIVATE").length,
      chars,
      pages: Math.round(chars / 2500),
      points: st.points as number,
      mapPoints: st.map_points as number,
      singles: st.singles as number,
      votes: st.votes as number,
      relations: st.relations as number,
      crossRelations: st.cross_relations as number,
      silhouette: analysis?.clustering.silhouette ?? null,
    },
  };
}
