/**
 * The council's decision and how each statement was handled (the fifth station of the tracking
 * slip). Written by the town after the report is out; public once published.
 */

import { sql } from "@policy/db";

import type { PublicDecision, Outcome } from "./beschluss-words";
import { getDb } from "./db";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

export interface Decision extends PublicDecision {
  state: "entwurf" | "veroeffentlicht";
  publishedAt: string | null;
  updatedAt: string | null;
}

export async function getDecision(campaignId: string): Promise<Decision | null> {
  const [d] = await rows(sql`SELECT * FROM campaign_decisions WHERE campaign_id = ${campaignId}`);
  const ps = await rows(sql`SELECT map_point_id, outcome, reason FROM point_decisions WHERE campaign_id = ${campaignId}`);
  if (!d && !ps.length) return null;
  return {
    gremium: (d?.gremium as string | undefined) ?? "Gemeinderat",
    datum: d?.datum ? new Date(String(d.datum)).toISOString().slice(0, 10) : null,
    summary: (d?.summary as string | null | undefined) ?? null,
    state: ((d?.state as string | undefined) ?? "entwurf") as Decision["state"],
    publishedAt: d?.published_at ? String(d.published_at) : null,
    updatedAt: d?.updated_at ? String(d.updated_at) : null,
    points: Object.fromEntries(ps.map((p) => [p.map_point_id as string, { outcome: p.outcome as Outcome, reason: (p.reason as string | null) ?? null }])),
  };
}

/** The decision as the public may see it: only once published. */
export async function publicDecision(campaignId: string): Promise<PublicDecision | null> {
  const d = await getDecision(campaignId);
  if (!d || d.state !== "veroeffentlicht") return null;
  return { gremium: d.gremium, datum: d.datum, summary: d.summary, points: d.points };
}
