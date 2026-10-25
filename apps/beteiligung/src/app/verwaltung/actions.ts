"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { freeSlug, getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/kern";
import { openingCheck } from "@/lib/redaktion";
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
  if (campaign.state !== "entwurf" && campaign.state !== "vorbereitung") return { error: "Nach dem Freischalten kommen Stellungnahmen über die Beteiligung herein." };
  const r = await getDb().execute(sql`
    INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, uploaded_by)
    VALUES (${staff.tenant.id}, ${campaign.id}, ${role}, ${file.name}, ${file.type || null}, ${file.size}, ${sha}, ${bytes},
            ${sender || null}, ${field(form, "senderType") || null}, ${staff.user.id})
    ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
  if (r.rows.length === 0) return { error: "Diese Datei liegt schon vor." };
  await audit(staff.tenant.id, staff.user.id, "campaign.upload", campaign.id, { filename: file.name, role, size: file.size, sha256: sha });
  // In preparation the machine reads a new statement right away (E4 → Z1–Z5).
  const reading = campaign.state === "vorbereitung" && role === "stellungnahme";
  if (reading) await enqueue(staff.tenant.id, campaign.id, "zerlegen", (r.rows[0] as { id: string }).id);
  revalidatePath(`/verwaltung/${id}`, "layout");
  return { ok: `„${file.name}“ hochgeladen.${reading ? " Die Maschine liest sie jetzt." : ""}` };
}

export async function deleteFile(id: string, fileId: string): Promise<void> {
  const { staff, campaign } = await own(id);
  // A statement the machine has read stays: its moves are evidence in the editors' queue.
  const r = await getDb().execute(sql`
    DELETE FROM campaign_files WHERE id = ${fileId} AND campaign_id = ${campaign.id} AND submission_id IS NULL RETURNING filename`);
  if (r.rows.length) await audit(staff.tenant.id, staff.user.id, "campaign.delete_file", campaign.id, { filename: (r.rows[0] as { filename: string }).filename });
  revalidatePath(`/verwaltung/${id}`, "layout");
}

/** State changes by button; opening the participation has its own action with its own checks. */
const NEXT: Partial<Record<CampaignState, CampaignState[]>> = {
  entwurf: ["vorbereitung"],
  vorbereitung: ["entwurf"],
};

/** The machine's work for a campaign entering preparation: the skeleton first, then every statement not yet read. */
async function queueAnalysis(tenantId: string, campaignId: string, consultationId: string) {
  const db = getDb();
  const sk = await db.execute(sql`
    SELECT 1 FROM map_points WHERE consultation_id = ${consultationId} AND rolle = 'schluss' AND status IN ('draft', 'released') LIMIT 1`);
  if (!sk.rows.length) await enqueue(tenantId, campaignId, "skelett");
  const unread = await db.execute(sql`
    SELECT id FROM campaign_files WHERE campaign_id = ${campaignId} AND role = 'stellungnahme' AND submission_id IS NULL ORDER BY created_at, filename`);
  for (const f of unread.rows as { id: string }[]) await enqueue(tenantId, campaignId, "zerlegen", f.id);
}

export async function setState(id: string, to: CampaignState): Promise<void> {
  const { staff, campaign } = await own(id);
  if (!NEXT[campaign.state]?.includes(to)) redirect(`/verwaltung/${id}`);
  if (to === "vorbereitung" && !(campaign.steps.lage && campaign.steps.wirkung && campaign.steps.weg && campaign.steps.eingriff)) {
    redirect(`/verwaltung/${id}?fehler=begruendung#begruendung`);
  }
  await getDb().execute(sql`UPDATE campaigns SET state = ${to}, updated_at = now() WHERE id = ${campaign.id}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.state", campaign.id, { from: campaign.state, to });
  if (to === "vorbereitung") await queueAnalysis(staff.tenant.id, campaign.id, campaign.consultationId);
  revalidatePath(`/verwaltung/${id}`, "layout");
  redirect(`/verwaltung/${id}${to === "vorbereitung" ? "/punkte" : ""}`);
}

/** E6: open the participation — only with a decided skeleton, the measure itself and every step carried by a released claim. */
export async function openCampaign(id: string): Promise<void> {
  const { staff, campaign } = await own(id);
  if (campaign.state !== "vorbereitung") redirect(`/verwaltung/${id}`);
  const c = await openingCheck(campaign.consultationId);
  if (!(c.hasSkeleton && c.skeletonOpen === 0 && c.rootReleased && c.stepsCovered === 4)) redirect(`/verwaltung/${id}#freischalten`);
  await getDb().execute(sql`UPDATE campaigns SET state = 'offen', updated_at = now() WHERE id = ${campaign.id}`);
  await audit(staff.tenant.id, staff.user.id, "campaign.state", campaign.id, { from: campaign.state, to: "offen", released: c.released });
  revalidatePath(`/verwaltung/${id}`, "layout");
  revalidatePath(`/${staff.tenant.slug}/${campaign.slug}`);
  redirect(`/verwaltung/${id}#freischalten`);
}

/** A failed job gets another go (e.g. after the database or the model was away). */
export async function retryJob(id: string, jobId: string): Promise<void> {
  const { staff, campaign } = await own(id);
  await getDb().execute(sql`
    UPDATE campaign_jobs SET state = 'wartet', attempts = 0, error = NULL, finished_at = NULL
    WHERE id = ${jobId} AND campaign_id = ${campaign.id} AND state = 'fehler'`);
  await audit(staff.tenant.id, staff.user.id, "campaign.job_retry", campaign.id, { job: jobId });
  revalidatePath(`/verwaltung/${id}`, "layout");
}

/** E2 again: a new skeleton from a changed justification — only while none of it is released. */
export async function reproposeSkeleton(id: string): Promise<void> {
  const { staff, campaign } = await own(id);
  const c = await openingCheck(campaign.consultationId);
  if (c.skeletonReleased === 0 && !c.rootReleased) {
    await enqueue(staff.tenant.id, campaign.id, "skelett");
    await audit(staff.tenant.id, staff.user.id, "campaign.skeleton_repropose", campaign.id, {});
  }
  revalidatePath(`/verwaltung/${id}`, "layout");
  redirect(`/verwaltung/${id}/punkte`);
}
