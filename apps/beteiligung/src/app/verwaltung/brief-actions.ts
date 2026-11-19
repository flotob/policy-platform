"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { revalidatePath } from "next/cache";

import { getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/kern";
import { requireEditor } from "@/lib/session";

import type { ActionState } from "./actions";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const WEGE: Record<string, string> = { brief: "Brief", anruf: "Anruf", buergerbuero: "Bürgerbüro", email: "E-Mail" };
const SCAN_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_SCAN = 20 * 1024 * 1024;

/**
 * The paper route: the editors enter what came by letter, phone or at the counter, typed or as a
 * scan (the machine reads scans in its job, kern/ocr.ts). It becomes a statement like any upload:
 * the machine decomposes it, every quote points back to it. Before opening as well as while open.
 */
export async function enterLetter(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireEditor();
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) return { error: "Dieses Verfahren gibt es nicht." };
  const values = Object.fromEntries(["weg", "als", "org", "eingang", "text"].map((k) => [k, field(form, k)]));
  if (!["entwurf", "vorbereitung", "offen"].includes(c.state)) return { error: "Die Beteiligung ist geschlossen. Neue Beiträge kommen nicht mehr in die Auswertung.", values };
  const weg = WEGE[values.weg!] ?? "Brief";
  const org = values.als === "organisation" ? values.org! : "";
  if (values.als === "organisation" && org.length < 3) return { error: "Für welche Organisation? Der Name erscheint bei jedem Zitat.", values };
  const scan = form.get("scan");
  const hasScan = scan instanceof File && scan.size > 0;
  const text = values.text!;
  if (!hasScan && text.length < 40) return { error: "Bitte den Text eintragen (mindestens ein, zwei Sätze) oder einen Scan anhängen.", values };
  if (hasScan && !SCAN_TYPES.includes(scan.type)) return { error: "Scans bitte als PDF, JPG, PNG oder WebP.", values };
  if (hasScan && scan.size > MAX_SCAN) return { error: "Der Scan ist größer als 20 MB.", values };

  const day = values.eingang && /^\d{4}-\d{2}-\d{2}$/.test(values.eingang) ? new Date(`${values.eingang}T12:00:00`) : new Date();
  const dateDe = day.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const bytes = hasScan ? new Uint8Array(await scan.arrayBuffer()) : new TextEncoder().encode(text);
  const ext = hasScan ? (scan.name.split(".").pop() ?? "pdf") : "txt";
  const filename = `${weg} vom ${dateDe}${org ? `, ${org}` : ""}${hasScan ? " (Scan)" : ""}.${ext}`;
  const sha = createHash("sha256").update(bytes).digest("hex");
  const db = getDb();
  const r = await db.execute(sql`
    INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, uploaded_by, created_at)
    VALUES (${c.tenantId}, ${c.id}, 'stellungnahme', ${filename}, ${hasScan ? scan.type : "text/plain"}, ${bytes.length}, ${sha}, ${Buffer.from(bytes)},
            ${org || null}, ${org ? "verband" : "privat"}, ${staff.user.id}, ${day.toISOString()})
    ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
  if (!r.rows.length) return { error: "Genau dieser Beitrag liegt schon vor.", values };
  const fileId = (r.rows[0] as { id: string }).id;
  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${c.tenantId}, ${`user:${staff.user.id}`}, 'campaign.letter', 'campaign', ${c.id}, ${JSON.stringify({ file: fileId, weg, org: org || null, scan: hasScan, eingang: day.toISOString().slice(0, 10) })})`);
  const reading = c.state !== "entwurf";
  if (reading) await enqueue(c.tenantId, c.id, "zerlegen", fileId);
  revalidatePath(`/verwaltung/${id}`, "layout");
  return {
    ok: `${weg} eingetragen.${reading ? (hasScan ? " Die Maschine liest den Scan und zerlegt ihn." : " Die Maschine zerlegt ihn jetzt.") : " Die Maschine liest ihn, sobald die Vorbereitung beginnt."}`,
  };
}
