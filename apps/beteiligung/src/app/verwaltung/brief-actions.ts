"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { sameSender } from "@policy/pipeline/kern/absender";
import { revalidatePath } from "next/cache";

import { filesOf, knownSenders, privateSender, uploadProblem } from "@/lib/absender";
import { getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/kern";
import { requireEditor } from "@/lib/session";

import type { ActionState } from "./actions";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const WEGE: Record<string, string> = { brief: "Brief", anruf: "Anruf", buergerbuero: "Bürgerbüro", email: "E-Mail" };
const SCAN_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

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
  let org = values.als === "organisation" ? values.org! : "";
  if (values.als === "organisation" && org.length < 3) return { error: "Für welche Organisation? Der Name erscheint bei jedem Zitat.", values };
  // Several scans (the pages of a letter, or a letter and its attachments) are one sender.
  const scans = filesOf(form, "scan");
  const text = values.text!;
  if (!scans.length && text.length < 40) return { error: "Bitte den Text eintragen (mindestens ein, zwei Sätze) oder einen Scan anhängen.", values };
  if (scans.some((s) => !SCAN_TYPES.includes(s.type))) return { error: "Scans bitte als PDF, JPG, PNG oder WebP.", values };
  const problem = scans.length ? uploadProblem(scans, false) : null;
  if (problem) return { error: problem, values };
  // The same organisation as before: same spelling, same sender.
  if (org) org = sameSender(org, (await knownSenders(c.id)).map((s) => s.name)) ?? org;

  const day = values.eingang && /^\d{4}-\d{2}-\d{2}$/.test(values.eingang) ? new Date(`${values.eingang}T12:00:00`) : new Date();
  const dateDe = day.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const head = `${weg} vom ${dateDe}${org ? `, ${org}` : ""}`;
  const parts = scans.length
    ? await Promise.all(
        scans.map(async (s, i) => ({
          bytes: new Uint8Array(await s.arrayBuffer()),
          mime: s.type,
          filename: `${head} (Scan${scans.length > 1 ? ` ${i + 1} von ${scans.length}` : ""}).${s.name.split(".").pop() ?? "pdf"}`,
        })),
      )
    : [{ bytes: new TextEncoder().encode(text), mime: "text/plain", filename: `${head}.txt` }];
  const db = getDb();
  const fileIds = await db.transaction(async (tx) => {
    const together = !org && parts.length > 1 ? await privateSender(tx, c) : null;
    const ids: string[] = [];
    for (const p of parts) {
      const sha = createHash("sha256").update(p.bytes).digest("hex");
      const r = await tx.execute(sql`
        INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, uploaded_by, created_at, participant_id)
        VALUES (${c.tenantId}, ${c.id}, 'stellungnahme', ${p.filename}, ${p.mime}, ${p.bytes.length}, ${sha}, ${Buffer.from(p.bytes)},
                ${org || null}, ${org ? "verband" : "privat"}, ${staff.user.id}, ${day.toISOString()}, ${together})
        ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
      if (r.rows.length) ids.push((r.rows[0] as { id: string }).id);
    }
    if (together && !ids.length) await tx.execute(sql`DELETE FROM participants WHERE id = ${together}`);
    return ids;
  });
  if (!fileIds.length) return { error: parts.length === 1 ? "Genau dieser Beitrag liegt schon vor." : "Genau diese Scans liegen schon vor.", values };
  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${c.tenantId}, ${`user:${staff.user.id}`}, 'campaign.letter', 'campaign', ${c.id}, ${JSON.stringify({ files: fileIds, weg, org: org || null, scans: scans.length, eingang: day.toISOString().slice(0, 10) })})`);
  const reading = c.state !== "entwurf";
  if (reading) for (const f of fileIds) await enqueue(c.tenantId, c.id, "zerlegen", f);
  revalidatePath(`/verwaltung/${id}`, "layout");
  const scanWords = fileIds.length > 1 ? ` Die Maschine liest die ${fileIds.length} Scans und zerlegt sie.` : " Die Maschine liest den Scan und zerlegt ihn.";
  return {
    ok: `${weg} eingetragen.${reading ? (scans.length ? scanWords : " Die Maschine zerlegt ihn jetzt.") : " Die Maschine liest ihn, sobald die Vorbereitung beginnt."}`,
  };
}
