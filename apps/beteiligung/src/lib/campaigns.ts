import { sql } from "@policy/db";

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

/** The public view of a campaign: by the municipality's and the campaign's slug, never a draft. */
export async function getPublicCampaign(tenantSlug: string, slug: string) {
  const r = await rows(sql`
    SELECT c.*, t.name AS tenant_name, t.slug AS tenant_slug FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
    WHERE t.slug = ${tenantSlug} AND c.slug = ${slug} AND c.state <> 'entwurf'`);
  const x = r[0];
  return x ? { ...toCampaign(x), tenant: { name: x.tenant_name as string, slug: x.tenant_slug as string } } : null;
}

export async function listFiles(campaignId: string): Promise<CampaignFile[]> {
  const r = await rows(sql`
    SELECT id, role, filename, size, sender, sender_type, created_at FROM campaign_files
    WHERE campaign_id = ${campaignId} ORDER BY role, created_at`);
  return r.map((x) => ({
    id: x.id as string,
    role: x.role as CampaignFile["role"],
    filename: x.filename as string,
    size: x.size as number,
    sender: (x.sender as string | null) ?? null,
    senderType: (x.sender_type as string | null) ?? null,
    createdAt: String(x.created_at),
  }));
}

/** A free slug for the municipality: "solarpflicht", "solarpflicht-2", … */
export async function freeSlug(tenantId: string, base: string): Promise<string> {
  const taken = new Set((await rows(sql`SELECT slug FROM campaigns WHERE tenant_id = ${tenantId}`)).map((x) => x.slug as string));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
