import { sql, type Db } from "@policy/db";

import type { Diag, Typ } from "../vocab.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export const EVIDENCE_LABEL: Record<string, string> = {
  data: "Daten mit Quelle",
  study: "Studie oder Gutachten",
  law: "andere Rechtsquelle oder amtliche Stellungnahme",
  case: "Beispiel aus der Praxis",
};

/** Per Landkarten-Punkt: how many of its source quotes give evidence (Jev, source-evidence.v2). */
export async function loadEvidence(db: Db, consultationId: string): Promise<Map<string, { sources: number; evidenced: number }>> {
  const r = await rows<{ id: string; sources: number; evidenced: number }>(db, sql`
    SELECT mp.id, count(ps.id)::int AS sources,
      count(*) FILTER (WHERE j.decided->>'kind' IS NOT NULL AND j.decided->>'kind' <> 'none')::int AS evidenced
    FROM map_points mp JOIN points p ON p.map_point_id = mp.id JOIN point_sources ps ON ps.point_id = p.id
    LEFT JOIN judgments j ON j.subject_kind = 'point_source' AND j.subject_id = ps.id::text AND j.family = 'source-evidence.v2'
    WHERE mp.consultation_id = ${consultationId}
    GROUP BY mp.id`);
  return new Map(r.map((x) => [x.id, { sources: x.sources, evidenced: x.evidenced }]));
}

/** Whether evidence was evaluated at all for this consultation. */
export async function evidenceEvaluated(db: Db, consultationId: string): Promise<boolean> {
  const r = await rows<{ n: number }>(db, sql`
    SELECT count(*)::int AS n FROM judgments WHERE consultation_id = ${consultationId} AND family = 'source-evidence.v2'`);
  return (r[0]?.n ?? 0) > 0;
}

/**
 * The concept paper's evidence × belief matrix (v7 §7) for a factual point:
 * evidence and the camp profile together say what to do.
 */
export function evidenceVerdict(typ: Typ, diag: Diag | null, evidenced: number): string | null {
  if (typ === "W") return "Wertungen lassen sich nicht belegen. Hier zählt die Abwägung, nicht der Beweis.";
  if (typ !== "T") return null;
  if (diag === "bruecke" || diag === "warnung")
    return evidenced > 0
      ? "Belegt und von beiden Lagern geglaubt: Diese Frage ist erledigt."
      : "Beide Lager glauben es, aber niemand belegt es. Das Konzept nennt das den gefährlichsten Fall, weil niemand nachfragt.";
  if (diag === "klaerbar")
    return evidenced > 0
      ? "Belege liegen vor, und trotzdem glaubt ein Lager es nicht. Dann fehlt eher Vermittlung als ein Gutachten: Die Evidenz ist da, sie ist nur nicht angekommen."
      : "Keine Seite nennt Belege, und die Lager sind uneins. Ein echter Scheinfaktenstreit: Ein Gutachten kann ihn klären.";
  return null;
}
