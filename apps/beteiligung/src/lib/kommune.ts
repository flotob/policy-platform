/**
 * What a municipality shows on its public pages: contact, links to its own imprint and privacy
 * notice, a logo (migration 0020), and its public page as a profile (migration 0023): a title
 * photo, one line under the name, a greeting with a portrait, links, opening hours. Edited on
 * /verwaltung/einstellungen by initiators.
 */

import { sql } from "@policy/db";
import { cache } from "react";

import { getDb } from "./db";

export interface KommuneLink {
  label: string;
  url: string;
}

export interface KommuneSettings {
  kontakt: { stelle: string; email: string; telefon: string; zeiten: string };
  website: string;
  impressum: string;
  datenschutz: string;
  /** One line under the town's name on its public page. */
  claim: string;
  /** "Ein Wort vorab": a greeting, who speaks, in which office. */
  gruss: { text: string; name: string; amt: string };
  /** Up to LINKS_MAX links beside the name (the website always comes first, from `website`). */
  links: KommuneLink[];
  /** The title photo's credit and what it shows (for screen readers). */
  titelbild: { credit: string; alt: string };
}

export type ImageKind = "titelbild" | "portrait";

export interface KommunePublic {
  id: string;
  name: string;
  slug: string;
  settings: KommuneSettings;
  /** Logo URL with a version, or null. */
  logo: string | null;
  /** Title photo and greeting portrait, URL with a version, or null. */
  titelbild: string | null;
  portrait: string | null;
}

export const LIMITS = { claim: 90, gruss: 400, name: 80, amt: 80, zeiten: 80, label: 40, credit: 80, alt: 200 } as const;
export const LINKS_MAX = 5;

export const EMPTY: KommuneSettings = {
  kontakt: { stelle: "", email: "", telefon: "", zeiten: "" },
  website: "",
  impressum: "",
  datenschutz: "",
  claim: "",
  gruss: { text: "", name: "", amt: "" },
  links: [],
  titelbild: { credit: "", alt: "" },
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

function normalize(raw: unknown): KommuneSettings {
  const x = (raw ?? {}) as Record<string, unknown>;
  const k = (x.kontakt ?? {}) as Record<string, unknown>;
  const g = (x.gruss ?? {}) as Record<string, unknown>;
  const t = (x.titelbild ?? {}) as Record<string, unknown>;
  const links = Array.isArray(x.links) ? (x.links as unknown[]) : [];
  return {
    kontakt: { stelle: str(k.stelle), email: str(k.email), telefon: str(k.telefon), zeiten: str(k.zeiten) },
    website: str(x.website),
    impressum: str(x.impressum),
    datenschutz: str(x.datenschutz),
    claim: str(x.claim),
    gruss: { text: str(g.text), name: str(g.name), amt: str(g.amt) },
    links: links
      .map((l) => ({ label: str((l as Record<string, unknown>)?.label), url: str((l as Record<string, unknown>)?.url) }))
      .filter((l) => l.label && l.url)
      .slice(0, LINKS_MAX),
    titelbild: { credit: str(t.credit), alt: str(t.alt) },
  };
}

type Row = {
  id: string;
  name: string;
  slug: string;
  settings: unknown;
  has_logo: boolean;
  logo_v: string | null;
  titelbild_v: string | null;
  portrait_v: string | null;
};

const toPublic = (r: Row): KommunePublic => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  settings: normalize(r.settings),
  logo: r.has_logo ? `/api/logo/${r.slug}?v=${r.logo_v ?? "1"}` : null,
  titelbild: r.titelbild_v ? `/api/bild/${r.slug}/titelbild?v=${r.titelbild_v}` : null,
  portrait: r.portrait_v ? `/api/bild/${r.slug}/portrait?v=${r.portrait_v}` : null,
});

const SELECT = sql`
  SELECT t.id, t.name, t.slug, t.settings, t.logo IS NOT NULL AS has_logo, extract(epoch FROM t.logo_updated_at)::bigint::text AS logo_v,
    (SELECT extract(epoch FROM updated_at)::bigint::text FROM tenant_images WHERE tenant_id = t.id AND kind = 'titelbild') AS titelbild_v,
    (SELECT extract(epoch FROM updated_at)::bigint::text FROM tenant_images WHERE tenant_id = t.id AND kind = 'portrait') AS portrait_v
  FROM tenants t`;

export const kommuneBySlug = cache(async (slug: string): Promise<KommunePublic | null> => {
  const r = await getDb().execute(sql`${SELECT} WHERE t.slug = ${slug}`);
  const row = r.rows[0] as Row | undefined;
  return row ? toPublic(row) : null;
});

export async function kommuneById(id: string): Promise<KommunePublic | null> {
  const r = await getDb().execute(sql`${SELECT} WHERE t.id = ${id}`);
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

/** Photos only (no SVG): the type comes from the file's first bytes, never from what the browser claims. */
export function photoType(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export const IMAGE_MAX: Record<ImageKind, number> = { titelbild: 5 * 1024 * 1024, portrait: 1024 * 1024 };

export async function saveImage(tenantId: string, kind: ImageKind, bytes: Uint8Array | null, type: string | null, actorId: string): Promise<void> {
  const db = getDb();
  if (bytes && type) {
    await db.execute(sql`
      INSERT INTO tenant_images (tenant_id, kind, bytes, type, updated_at) VALUES (${tenantId}, ${kind}, ${Buffer.from(bytes)}, ${type}, now())
      ON CONFLICT (tenant_id, kind) DO UPDATE SET bytes = excluded.bytes, type = excluded.type, updated_at = now()`);
  } else {
    await db.execute(sql`DELETE FROM tenant_images WHERE tenant_id = ${tenantId} AND kind = ${kind}`);
  }
  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${tenantId}, ${`user:${actorId}`}, ${bytes ? `tenant.${kind}` : `tenant.${kind}_removed`}, 'tenant', ${tenantId}, ${JSON.stringify({ type, size: bytes?.length ?? 0 })})`);
}

export async function imageOf(slug: string, kind: ImageKind): Promise<{ bytes: Buffer; type: string } | null> {
  const r = await getDb().execute(sql`
    SELECT i.bytes, i.type FROM tenant_images i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = ${slug} AND i.kind = ${kind}`);
  const row = r.rows[0] as { bytes: Buffer; type: string } | undefined;
  return row ? { bytes: row.bytes, type: row.type } : null;
}
