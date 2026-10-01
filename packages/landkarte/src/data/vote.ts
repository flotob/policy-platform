/**
 * "Wo stehen Sie?" (idea 3, paper door 1): everything the vote deck needs,
 * in one serialisable object. Per measure the votable Landkarten-Punkte
 * (Tatsache, Wertung, Ausgestaltung — no Lücken), and per point each
 * organisation's position as inferred from its statement (map_point_votes).
 * Read-only; the visitor's own votes never leave the browser.
 */

import { sql, type Db } from "@policy/db";

import type { Diag, Typ } from "../vocab.ts";
import { campsOf, latestAnalysis, loadMeasureSummaries, loadOrgs } from "./consultation.ts";
import type { CampCount } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export type VoteTyp = Exclude<Typ, "luecke">;

export interface VotePoint {
  id: string;
  ord: number;
  typ: VoteTyp;
  question: string | null;
  text: string;
  diag: Diag | null;
  /** Counts per camp ("a" = larger camp), as the diagnosis computed them. */
  votes: { a: CampCount; b: CampCount } | null;
  /** Organisation (submission id) → 1 stimmt zu / -1 lehnt ab. Absent = no position. */
  positions: Record<string, 1 | -1>;
}

export interface VoteMeasure {
  scope: string;
  display: string;
  slug: string;
  description: string | null;
  points: VotePoint[];
}

export interface VoteOrg {
  /** Submission id (the organisation's page is /organisationen/<id>). */
  id: string;
  name: string;
  short: string;
  side: "a" | "b" | null;
}

export interface VoteCamp {
  side: "a" | "b";
  name: string;
  summary: string | null;
  size: number;
}

export interface VoteData {
  camps: VoteCamp[];
  orgs: VoteOrg[];
  /** In the interface's order: the whole first, the bill's order, beyond last. Measures without votable points are left out. */
  measures: VoteMeasure[];
}

export async function loadVoteData(db: Db, consultationId: string): Promise<VoteData> {
  const analysis = await latestAnalysis(db, consultationId);
  const allOrgs = await loadOrgs(db, consultationId, analysis);
  const camps = campsOf(analysis, allOrgs);
  const sideOf = new Map(camps.map((c) => [c.group, c.side]));
  const summaries = await loadMeasureSummaries(db, consultationId);

  const pts = await rows<{
    id: string;
    scope: string;
    ord: number;
    typ: VoteTyp;
    question: string | null;
    text: string;
    diag: Diag | null;
    votes: { a: CampCount; b: CampCount } | null;
  }>(db, sql`
    SELECT id, scope, ord, typ, question, text, diag, diag_flags->'votes' AS votes
    FROM map_points
    WHERE consultation_id = ${consultationId} AND typ IN ('T', 'W', 'verfahren')
    ORDER BY scope, ord`);

  const v = await rows<{ map_point_id: string; participant_id: string; value: number }>(db, sql`
    SELECT v.map_point_id, v.participant_id, v.value
    FROM map_point_votes v JOIN map_points m ON m.id = v.map_point_id
    WHERE m.consultation_id = ${consultationId} AND v.value IN (1, -1)`);

  const orgOfParticipant = new Map(allOrgs.filter((o) => o.participantId).map((o) => [o.participantId!, o.submissionId]));
  const positions = new Map<string, Record<string, 1 | -1>>();
  for (const x of v) {
    const org = orgOfParticipant.get(x.participant_id);
    if (!org) continue;
    const rec = positions.get(x.map_point_id) ?? {};
    rec[org] = x.value === 1 ? 1 : -1;
    positions.set(x.map_point_id, rec);
  }

  const measures = summaries
    .map((m): VoteMeasure => ({
      scope: m.scope,
      display: m.display,
      slug: m.slug,
      description: m.description,
      points: pts
        .filter((p) => p.scope === m.scope)
        .map((p) => ({
          id: p.id,
          ord: p.ord,
          typ: p.typ,
          question: p.question,
          text: p.text,
          diag: p.diag,
          votes: p.votes ?? null,
          positions: positions.get(p.id) ?? {},
        })),
    }))
    .filter((m) => m.points.length > 0);

  return {
    camps: camps.map((c) => ({ side: c.side, name: c.name, summary: c.summary, size: c.size })),
    orgs: allOrgs.map((o) => ({
      id: o.submissionId,
      name: o.name,
      short: o.short,
      side: o.camp == null ? null : (sideOf.get(o.camp) ?? null),
    })),
    measures,
  };
}
