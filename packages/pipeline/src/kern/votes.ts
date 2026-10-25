/**
 * Z8 "Stimme zählt (Tür 2/3)": the votes that follow from what people wrote.
 *
 * A participant whose text went through the core loop — a statement the town
 * brought in, a door-3 upload, a door-2 point the author confirmed — votes
 * +1 on every released point one of their moves supports and -1 where it
 * contradicts (assumption 3); both on the same point → 0 (pass). Recomputed
 * from the moves every time, never edited by hand, on the point's current
 * version. A participant's own click at door 1 always wins.
 */

import { sql, type Db } from "@policy/db";

export const DERIVED_METHODS = ["tuer2", "abgeleitet"] as const;

export async function syncDerivedVotes(db: Pick<Db, "execute">, consultationId: string): Promise<void> {
  await db.execute(sql`
    WITH derived AS (
      SELECT p.tenant_id, s.participant_id, m.map_point_id, p.version,
             CASE WHEN bool_and(m.stance = 1) THEN 1 WHEN bool_and(m.stance = -1) THEN -1 ELSE 0 END AS value,
             CASE WHEN bool_or(s.door = 'statement') THEN 'tuer2' ELSE 'abgeleitet' END AS method
      FROM moves m
      JOIN submissions s ON s.id = m.submission_id
      JOIN map_points p ON p.id = m.map_point_id
      WHERE m.consultation_id = ${consultationId} AND m.state = 'verknuepft' AND p.status = 'released' AND s.participant_id IS NOT NULL
      GROUP BY p.tenant_id, s.participant_id, m.map_point_id, p.version
    ),
    gone AS (
      DELETE FROM map_point_votes v USING map_points p
      WHERE v.map_point_id = p.id AND p.consultation_id = ${consultationId} AND v.method IN ('tuer2', 'abgeleitet')
        AND NOT EXISTS (SELECT 1 FROM derived d WHERE d.participant_id = v.participant_id AND d.map_point_id = v.map_point_id AND d.version = v.version)
      RETURNING v.id
    )
    INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, version, value, method)
    SELECT tenant_id, participant_id, map_point_id, version, value, method FROM derived
    ON CONFLICT (participant_id, map_point_id, version) DO UPDATE SET value = excluded.value, method = excluded.method
      WHERE map_point_votes.method IN ('tuer2', 'abgeleitet')`);
}
