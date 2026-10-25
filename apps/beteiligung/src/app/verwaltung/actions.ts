"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { freeSlug, getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { DEFAULT_PARAMS, STEPS, type CampaignParams, type CampaignState, type EditorialMode } from "@/lib/params";
import { requireInitiator } from "@/lib/session";
import { slugify } from "@/lib/slug";

export interface ActionState {
  error?: string;
  ok?: string;
  /** What was submitted: forms show it again after an error (React resets uncontrolled fields). */
  values?: Record<string, string>;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
/** All text fields of a form, to hand back with an error. */
const valuesOf = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
/** A decision question is a question: add the mark if it is missing. */
const asQuestion = (q: string) => (q && !/[?？]$/.test(q) ? `${q.replace(/[.!]+$/, "")}?` : q);
/** Files up to this size are kept in the database (statements, statutes, decision papers). */
const MAX_FILE = 20 * 1024 * 1024;

async function audit(tenantId: string, userId: string, action: string, campaignId: string, payload: unknown) {
  await getDb().execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${tenantId}, ${`user:${userId}`}, ${action}, 'campaign', ${campaignId}, ${JSON.stringify(payload)})`);
}

/** The campaign of the caller's municipality, or a redirect: never someone else's. */
async function own(id: string) {
  const staff = await requireInitiator();
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) redirect("/verwaltung");
  return { staff, campaign };
}

export async function createCampaign(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const title = field(form, "title");
  const question = asQuestion(field(form, "question"));
  const measure = field(form, "measure");
  const values = valuesOf(form);
  if (title.length < 3) return { error: "Bitte geben Sie dem Verfahren einen Titel.", values };
  if (question.length < 10) return { error: "Bitte formulieren Sie die Entscheidungsfrage, etwa: „Soll die Stadt … einführen?“", values };
  if (measure.length < 10) return { error: "Bitte beschreiben Sie die Maßnahme in einem oder zwei Sätzen.", values };

  const slug = await freeSlug(staff.tenant.id, slugify(title) || "verfahren");
  const db = getDb();
  let id = "";
  await db.transaction(async (tx) => {
    // The pipeline works on a consultation; the campaign owns exactly one.
    const c = await tx.execute(sql`
      INSERT INTO consultations (tenant_id, title, status, source_system, source_ref)
      VALUES (${staff.tenant.id}, ${title}, 'draft', 'beteiligung', ${`${staff.tenant.slug}/${slug}`}) RETURNING id`);
    const consultationId = (c.rows[0] as { id: string }).id;
    const r = await tx.execute(sql`
      INSERT INTO campaigns (tenant_id, consultation_id, slug, title, question, measure, params, created_by)
      VALUES (${staff.tenant.id}, ${consultationId}, ${slug}, ${title}, ${question}, ${measure}, ${JSON.stringify(DEFAULT_PARAMS)}, ${staff.user.id})
      RETURNING id`);
    id = (r.rows[0] as { id: string }).id;
  });
  await audit(staff.tenant.id, staff.user.id, "campaign.create", id, { title, slug });
  redirect(`/verwaltung/${id}`);
}

export async function saveBasics(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const title = field(form, "title");
  const question = asQuestion(field(form, "question"));
  const measure = field(form, "measure");
  const summary = field(form, "summary");
  const values = valuesOf(form);
  if (title.length < 3) return { error: "Bitte geben Sie dem Verfahren einen Titel.", values };
  if (question.length < 10) return { error: "Bitte formulieren Sie die Entscheidungsfrage.", values };
  if (measure.length < 10) return { error: "Bitte beschreiben Sie die Maßnahme in einem oder zwei Sätzen.", values };
  await getDb().execute(sql`
    UPDATE campaigns SET title = ${title}, question = ${question}, measure = ${measure}, summary = ${summary || null}, updated_at = now()
    WHERE id = ${campaign.id}`);
  await getDb().execute(sql`UPDATE consultations SET title = ${title} WHERE id = ${campaign.consultationId}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.update_basics", campaign.id, { title, question });
  revalidatePath(`/verwaltung/${id}`);
  return { ok: "Gespeichert.", values: { ...values, question } };
}

export async function saveJustification(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const justification = field(form, "justification");
  const steps = Object.fromEntries(STEPS.map((s) => [s.key, field(form, `step_${s.key}`)]).filter(([, v]) => v));
  await getDb().execute(sql`
    UPDATE campaigns SET justification = ${justification || null}, steps = ${JSON.stringify(steps)}, updated_at = now()
    WHERE id = ${campaign.id}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.update_justification", campaign.id, { steps: Object.keys(steps) });
  revalidatePath(`/verwaltung/${id}`);
  return { ok: "Gespeichert." };
}

export async function saveProcess(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const start = field(form, "start") || null;
  const end = field(form, "end") || null;
  if (start && end && end < start) return { error: "Das Ende liegt vor dem Beginn.", values: valuesOf(form) };
  const doors = { abstimmen: form.has("door_abstimmen"), kurzaussage: form.has("door_kurzaussage"), stellungnahme: form.has("door_stellungnahme") };
  if (!doors.abstimmen) return { error: "Abstimmen gehört zu jedem Verfahren: Ohne Stimmen gibt es keine Lager und keine Landkarte.", values: valuesOf(form) };
  const mode = field(form, "editorialMode") as EditorialMode;
  const params: CampaignParams = {
    ...campaign.params,
    doors,
    start,
    end,
    editorialMode: (["mensch", "assistiert", "ki"] as const).includes(mode) ? mode : DEFAULT_PARAMS.editorialMode,
    access: field(form, "access") === "einladung" ? "einladung" : "offen",
  };
  await getDb().execute(sql`UPDATE campaigns SET params = ${JSON.stringify(params)}, updated_at = now() WHERE id = ${campaign.id}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.update_params", campaign.id, params);
  revalidatePath(`/verwaltung/${id}`);
  return { ok: "Gespeichert." };
}

export async function uploadFile(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Bitte wählen Sie eine Datei aus." };
  if (file.size > MAX_FILE) return { error: "Die Datei ist größer als 20 MB. Bitte teilen Sie sie auf." };
  const role = field(form, "role");
  if (!["entwurf", "unterlage", "stellungnahme"].includes(role)) return { error: "Bitte wählen Sie, was die Datei ist." };
  const sender = field(form, "sender");
  if (role === "stellungnahme" && !sender) return { error: "Von wem stammt die Stellungnahme? Der Absender erscheint später bei jedem Zitat.", values: valuesOf(form) };
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const r = await getDb().execute(sql`
    INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, uploaded_by)
    VALUES (${staff.tenant.id}, ${campaign.id}, ${role}, ${file.name}, ${file.type || null}, ${file.size}, ${sha}, ${bytes},
            ${sender || null}, ${field(form, "senderType") || null}, ${staff.user.id})
    ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
  if (r.rows.length === 0) return { error: "Diese Datei liegt schon vor." };
  await audit(staff.tenant.id, staff.user.id, "campaign.upload", campaign.id, { filename: file.name, role, size: file.size, sha256: sha });
  revalidatePath(`/verwaltung/${id}`);
  return { ok: `„${file.name}“ hochgeladen.` };
}

export async function deleteFile(id: string, fileId: string): Promise<void> {
  const { staff, campaign } = await own(id);
  const r = await getDb().execute(sql`DELETE FROM campaign_files WHERE id = ${fileId} AND campaign_id = ${campaign.id} RETURNING filename`);
  if (r.rows.length) await audit(staff.tenant.id, staff.user.id, "campaign.delete_file", campaign.id, { filename: (r.rows[0] as { filename: string }).filename });
  revalidatePath(`/verwaltung/${id}`);
}

/** State changes the workspace offers now; opening the participation needs released points (milestone 2). */
const NEXT: Partial<Record<CampaignState, CampaignState[]>> = {
  entwurf: ["vorbereitung"],
  vorbereitung: ["entwurf"],
};

export async function setState(id: string, to: CampaignState): Promise<void> {
  const { staff, campaign } = await own(id);
  if (!NEXT[campaign.state]?.includes(to)) redirect(`/verwaltung/${id}`);
  if (to === "vorbereitung" && !(campaign.steps.lage && campaign.steps.wirkung && campaign.steps.weg && campaign.steps.eingriff)) {
    redirect(`/verwaltung/${id}?fehler=begruendung#begruendung`);
  }
  await getDb().execute(sql`UPDATE campaigns SET state = ${to}, updated_at = now() WHERE id = ${campaign.id}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.state", campaign.id, { from: campaign.state, to });
  revalidatePath(`/verwaltung/${id}`);
  redirect(`/verwaltung/${id}`);
}
