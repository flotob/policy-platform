/**
 * What a municipality shows on its public pages: contact, links to its own imprint and privacy
 * notice, a logo (migration 0020). Edited on /verwaltung/einstellungen by initiators.
 */

import { sql } from "@policy/db";
import { cache } from "react";

import { getDb } from "./db";

export interface KommuneSettings {
  kontakt: { stelle: string; email: string; telefon: string };
  website: string;
  impressum: string;
  datenschutz: string;
}

export interface KommunePublic {
  id: string;
  name: string;
  slug: string;
  settings: KommuneSettings;
  /** Logo URL with a version, or null. */
  logo: string | null;
}

export const EMPTY: KommuneSettings = { kontakt: { stelle: "", email: "", telefon: "" }, website: "", impressum: "", datenschutz: "" };

function normalize(raw: unknown): KommuneSettings {
  const x = (raw ?? {}) as Partial<KommuneSettings> & { kontakt?: Partial<KommuneSettings["kontakt"]> };
  return {
    kontakt: { stelle: x.kontakt?.stelle ?? "", email: x.kontakt?.email ?? "", telefon: x.kontakt?.telefon ?? "" },
    website: x.website ?? "",
    impressum: x.impressum ?? "",
    datenschutz: x.datenschutz ?? "",
  };
}

type Row = { id: string; name: string; slug: string; settings: unknown; has_logo: boolean; logo_v: string | null };

const toPublic = (r: Row): KommunePublic => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  settings: normalize(r.settings),
  logo: r.has_logo ? `/api/logo/${r.slug}?v=${r.logo_v ?? "1"}` : null,
});

export const kommuneBySlug = cache(async (slug: string): Promise<KommunePublic | null> => {
  const r = await getDb().execute(sql`
    SELECT id, name, slug, settings, logo IS NOT NULL AS has_logo, extract(epoch FROM logo_updated_at)::bigint::text AS logo_v
    FROM tenants WHERE slug = ${slug}`);
  const row = r.rows[0] as Row | undefined;
  return row ? toPublic(row) : null;
});

export async function kommuneById(id: string): Promise<KommunePublic | null> {
  const r = await getDb().execute(sql`
    SELECT id, name, slug, settings, logo IS NOT NULL AS has_logo, extract(epoch FROM logo_updated_at)::bigint::text AS logo_v
    FROM tenants WHERE id = ${id}`);
  const row = r.rows[0] as Row | undefined;
  return row ? toPublic(row) : null;
}

/** An address people can follow: http(s) only; a bare domain gets https://. Empty stays empty. */
export function cleanUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function saveSettings(tenantId: string, name: string, s: KommuneSettings, actorId: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`UPDATE tenants SET name = ${name}, settings = ${JSON.stringify(s)}::jsonb WHERE id = ${tenantId}`);
  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${tenantId}, ${`user:${actorId}`}, 'tenant.settings', 'tenant', ${tenantId}, ${JSON.stringify({ name, ...s })})`);
}

export const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
export const LOGO_MAX = 500 * 1024;

export async function saveLogo(tenantId: string, bytes: Uint8Array | null, type: string | null, actorId: string): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    UPDATE tenants SET logo = ${bytes ? Buffer.from(bytes) : null}, logo_type = ${type}, logo_updated_at = ${bytes ? new Date().toISOString() : null}
    WHERE id = ${tenantId}`);
  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${tenantId}, ${`user:${actorId}`}, ${bytes ? "tenant.logo" : "tenant.logo_removed"}, 'tenant', ${tenantId}, ${JSON.stringify({ type, size: bytes?.length ?? 0 })})`);
}

export async function logoOf(slug: string): Promise<{ bytes: Buffer; type: string } | null> {
  const r = await getDb().execute(sql`SELECT logo, logo_type FROM tenants WHERE slug = ${slug} AND logo IS NOT NULL`);
  const row = r.rows[0] as { logo: Buffer; logo_type: string } | undefined;
  return row ? { bytes: row.logo, type: row.logo_type } : null;
}
