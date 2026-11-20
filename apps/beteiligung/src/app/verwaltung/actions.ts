"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { sameSender } from "@policy/pipeline/kern/absender";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dropEmptySender, filesOf, knownSenders, privateSender, uploadProblem } from "@/lib/absender";
import { freeSlug, getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/kern";
import { openingCheck } from "@/lib/redaktion";
import { inviteCode } from "@/lib/teilnahme";
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
  if (SETTLED.includes(campaign.state)) return { error: "Die Beteiligung ist geschlossen; Maßnahme, Begründung und Ablauf bleiben, wie sie ausgewertet wurden." };
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
  if (SETTLED.includes(campaign.state)) return { error: "Die Beteiligung ist geschlossen; Maßnahme, Begründung und Ablauf bleiben, wie sie ausgewertet wurden." };
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
  if (SETTLED.includes(campaign.state)) return { error: "Die Beteiligung ist geschlossen; Maßnahme, Begründung und Ablauf bleiben, wie sie ausgewertet wurden." };
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

/**
 * Upload: one or several files of one kind. Statements uploaded together are one sender (a statement and
 * its attachments); a later statement under the same organisation name joins that sender, spelled as
 * the first time (lib/absender.ts).
 */
export async function uploadFile(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const values = valuesOf(form);
  const files = filesOf(form, "file");
  const problem = uploadProblem(files, false);
  if (problem) return { error: problem, values };
  const role = field(form, "role");
  if (!["entwurf", "unterlage", "stellungnahme"].includes(role)) return { error: "Bitte wählen Sie, was die Datei ist.", values };
  let sender = field(form, "sender");
  const senderType = field(form, "senderType");
  // A private person is never named in public: the name (if typed) stays internal, the quotes say "Privatperson".
  if (role === "stellungnahme" && !sender && senderType !== "privat")
    return { error: "Von wem stammt die Stellungnahme? Der Absender erscheint später bei jedem Zitat; bei Privatpersonen wählen Sie „Privatperson“.", values };
  if (campaign.state !== "entwurf" && campaign.state !== "vorbereitung") return { error: "Nach dem Freischalten kommen Stellungnahmen über die Beteiligung herein.", values };
  const statement = role === "stellungnahme";
  const named = statement && senderType !== "privat";
  if (named) sender = sameSender(sender, (await knownSenders(campaign.id)).map((s) => s.name)) ?? sender;
  const read = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      return { file, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
    }),
  );
  const db = getDb();
  const { added, skipped } = await db.transaction(async (tx) => {
    // A private person's files uploaded together are one person; a single file needs no shared participant.
    const together = statement && !named && read.length > 1 ? await privateSender(tx, campaign) : null;
    const added: { id: string; name: string; size: number; sha: string }[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const x of read) {
      if (seen.has(x.sha)) continue;
      seen.add(x.sha);
      const r = await tx.execute(sql`
        INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, uploaded_by, participant_id)
        VALUES (${staff.tenant.id}, ${campaign.id}, ${role}, ${x.file.name}, ${x.file.type || null}, ${x.file.size}, ${x.sha}, ${x.bytes},
                ${sender || null}, ${senderType || null}, ${staff.user.id}, ${together})
        ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
      const fid = (r.rows[0] as { id: string } | undefined)?.id;
      if (fid) added.push({ id: fid, name: x.file.name, size: x.file.size, sha: x.sha });
      else skipped.push(x.file.name);
    }
    if (together && !added.length) await tx.execute(sql`DELETE FROM participants WHERE id = ${together}`);
    return { added, skipped };
  });
  if (!added.length) return { error: skipped.length === 1 ? "Diese Datei liegt schon vor." : "Diese Dateien liegen schon vor.", values };
  for (const f of added)
    await audit(staff.tenant.id, staff.user.id, "campaign.upload", campaign.id, { filename: f.name, role, size: f.size, sha256: f.sha, together: added.length });
  // In preparation the machine reads a new statement right away (E4 → Z1–Z5).
  const reading = campaign.state === "vorbereitung" && statement;
  if (reading) for (const f of added) await enqueue(staff.tenant.id, campaign.id, "zerlegen", f.id);
  revalidatePath(`/verwaltung/${id}`, "layout");
  const what = added.length === 1 ? `„${added[0]!.name}“ hochgeladen.` : `${added.length} Dateien hochgeladen${statement ? ", sie zählen als ein Absender" : ""}.`;
  const dup = skipped.length ? ` ${skipped.map((n) => `„${n}“`).join(", ")} ${skipped.length === 1 ? "lag" : "lagen"} schon vor.` : "";
  return { ok: `${what}${dup}${reading ? " Die Maschine liest jetzt." : ""}` };
}

export async function deleteFile(id: string, fileId: string): Promise<void> {
  const { staff, campaign } = await own(id);
  // A statement the machine has read stays: its moves are evidence in the editors' queue.
  const r = await getDb().execute(sql`
    DELETE FROM campaign_files WHERE id = ${fileId} AND campaign_id = ${campaign.id} AND submission_id IS NULL RETURNING filename, participant_id`);
  const gone = r.rows[0] as { filename: string; participant_id: string | null } | undefined;
  if (gone) {
    await dropEmptySender(gone.participant_id);
    await audit(staff.tenant.id, staff.user.id, "campaign.delete_file", campaign.id, { filename: gone.filename });
  }
  revalidatePath(`/verwaltung/${id}`, "layout");
}

/** After closing, the procedure stays as it was evaluated. */
const SETTLED: CampaignState[] = ["auswertung", "bericht", "veroeffentlicht"];

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

/**
 * Codes for letters, shown once for printing, kept only as hashes: invitations (access
 * "einladung") or the cross-check by lot (any procedure; the drawn residents' votes are also
 * counted apart).
 */
export async function generateInvites(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { staff, campaign } = await own(id);
  const kind = campaign.params.access === "einladung" && field(form, "kind") !== "gelost" ? "einladung" : "gelost";
  const values = { kind };
  const count = Math.round(Number(field(form, "count")));
  if (!Number.isFinite(count) || count < 1 || count > 5000) return { error: "Zwischen 1 und 5000 Codes auf einmal.", values };
  const codes = Array.from({ length: count }, () => inviteCode());
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const c of codes) {
      await tx.execute(sql`
        INSERT INTO campaign_invites (tenant_id, campaign_id, code_hash, kind) VALUES (${staff.tenant.id}, ${campaign.id}, ${c.hash}, ${kind}) ON CONFLICT DO NOTHING`);
    }
  });
  await audit(staff.tenant.id, staff.user.id, "campaign.invites", campaign.id, { count, kind });
  revalidatePath(`/verwaltung/${id}`);
  return { ok: codes.map((c) => c.code).join("\n"), values };
}
