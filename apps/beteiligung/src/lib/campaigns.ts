import { sql } from "@policy/db";

import { confirmedTown } from "./bestaetigen";
import { getDb } from "./db";
import { paramsOf, type CampaignParams, type CampaignState, type Steps } from "./params";

export interface Campaign {
  id: string;
  tenantId: string;
  consultationId: string;
  slug: string;
  title: string;
  question: string;
  measure: string;
  summary: string | null;
  justification: string | null;
  steps: Steps;
  params: CampaignParams;
  state: CampaignState;
  fictional: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFile {
  id: string;
  role: "entwurf" | "unterlage" | "stellungnahme";
  filename: string;
  size: number;
  sender: string | null;
  senderType: string | null;
  createdAt: string;
  /** Read by the machine (Z1 done), and how many moves it found in it. */
  read: boolean;
  moves: number;
}

type Row = Record<string, unknown>;

function toCampaign(r: Row): Campaign {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    consultationId: r.consultation_id as string,
    slug: r.slug as string,
    title: r.title as string,
    question: r.question as string,
    measure: r.measure as string,
    summary: (r.summary as string | null) ?? null,
    justification: (r.justification as string | null) ?? null,
    steps: (r.steps as Steps) ?? {},
    params: paramsOf(r.params),
    state: r.state as CampaignState,
    fictional: r.fictional as boolean,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

export async function listCampaigns(tenantId: string) {
  const r = await rows(sql`
    SELECT c.*, (SELECT count(*) FROM campaign_files f WHERE f.campaign_id = c.id)::int AS files
    FROM campaigns c WHERE c.tenant_id = ${tenantId} ORDER BY c.updated_at DESC`);
  return r.map((x) => ({ ...toCampaign(x), files: x.files as number }));
}

/** A campaign of this municipality — null for someone else's (tenant isolation in every query). */
export async function getCampaign(tenantId: string, id: string): Promise<Campaign | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await rows(sql`SELECT * FROM campaigns WHERE id = ${id} AND tenant_id = ${tenantId}`);
  return r[0] ? toCampaign(r[0]) : null;
}

/**
 * The public view of a campaign: by the municipality's and the campaign's slug, never a draft. A town in
 * which nobody has confirmed their address yet (lib/bestaetigen.ts) is seen by its own team only, marked
 * `preview` — nobody else sees a procedure in the name of an unconfirmed address.
 */
export async function getPublicCampaign(tenantSlug: string, slug: string) {
  const r = await rows(sql`
    SELECT c.*, t.name AS tenant_name, t.slug AS tenant_slug, ${confirmedTown("t")} AS confirmed
    FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = ${tenantSlug} AND c.slug = ${slug} AND c.state <> 'entwurf'`);
  const x = r[0];
  if (!x) return null;
  const preview = x.confirmed !== true;
  if (preview && !(await ownTeam(x.tenant_id as string))) return null;
  return { ...toCampaign(x), tenant: { name: x.tenant_name as string, slug: x.tenant_slug as string }, preview };
}

/** Whether the logged-in staff member belongs to this town (session loaded only when needed: scripts import this file). */
export async function ownTeam(tenantId: string): Promise<boolean> {
  const { getStaff } = await import("./session");
  return (await getStaff())?.tenant.id === tenantId;
}

export async function listFiles(campaignId: string): Promise<CampaignFile[]> {
  const r = await rows(sql`
    SELECT f.id, f.role, f.filename, f.size, f.sender, f.sender_type, f.created_at, f.submission_id,
      (SELECT count(*) FROM moves m WHERE m.submission_id = f.submission_id)::int AS moves
    FROM campaign_files f WHERE f.campaign_id = ${campaignId} ORDER BY f.role, f.created_at, f.filename`);
  return r.map((x) => ({
    id: x.id as string,
    role: x.role as CampaignFile["role"],
    filename: x.filename as string,
    size: x.size as number,
    sender: (x.sender as string | null) ?? null,
    senderType: (x.sender_type as string | null) ?? null,
    createdAt: String(x.created_at),
    read: !!x.submission_id,
    moves: Number(x.moves ?? 0),
  }));
}

/** A free slug for the municipality: "solarpflicht", "solarpflicht-2", … */
export async function freeSlug(tenantId: string, base: string): Promise<string> {
  const taken = new Set((await rows(sql`SELECT slug FROM campaigns WHERE tenant_id = ${tenantId}`)).map((x) => x.slug as string));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** How many invitation codes exist, how many opened a participation, and how many went out by lot. */
export async function inviteCounts(campaignId: string): Promise<{ total: number; used: number; drawn: number; drawnUsed: number }> {
  const r = await rows(sql`
    SELECT count(*)::int AS total, count(participant_id)::int AS used,
      count(*) FILTER (WHERE kind = 'gelost')::int AS drawn, count(participant_id) FILTER (WHERE kind = 'gelost')::int AS drawn_used
    FROM campaign_invites WHERE campaign_id = ${campaignId}`);
  return { total: Number(r[0]?.total ?? 0), used: Number(r[0]?.used ?? 0), drawn: Number(r[0]?.drawn ?? 0), drawnUsed: Number(r[0]?.drawn_used ?? 0) };
}
