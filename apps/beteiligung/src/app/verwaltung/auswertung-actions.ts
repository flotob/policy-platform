"use server";

import { sql } from "@policy/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getResult, latestResult, liveResult, namesLocked, saveResult, setCampNames } from "@/lib/auswertung";
import { getReport, latestReport, namingOf, startReport } from "@/lib/bericht";
import { getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/kern";
import { requireEditor, requireInitiator, type Staff } from "@/lib/session";

import type { ActionState } from "./actions";

/**
 * Phase 3 and 4 by button: close the participation (B13) and store the
 * result (W9), name the camps, write the report (R1 → R2/R3 in the
 * background), release or reject it (R4), publish (R5).
 */

async function audit(staff: Staff, action: string, kind: string, id: string, payload: unknown) {
  await getDb().execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${staff.tenant.id}, ${`user:${staff.user.id}`}, ${action}, ${kind}, ${id}, ${JSON.stringify(payload)})`);
}

async function load(id: string, staff: Staff) {
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) redirect("/verwaltung");
  return campaign;
}

const refresh = (id: string) => revalidatePath(`/verwaltung/${id}`, "layout");

/** B13: no more votes; the matrix is frozen and evaluated once more, then stored (W9). */
export async function closeParticipation(id: string): Promise<void> {
  const staff = await requireInitiator();
  const c = await load(id, staff);
  if (c.state !== "offen") redirect(`/verwaltung/${id}/auswertung`);
  if (!(await liveResult(c)).ready) redirect(`/verwaltung/${id}/auswertung?fehler=lager`);
  // Close first, so no vote slips in between the evaluation and the state change.
  await getDb().execute(sql`UPDATE campaigns SET state = 'auswertung', updated_at = now() WHERE id = ${c.id}`);
  const saved = await saveResult({ ...c, state: "auswertung" }, `user:${staff.user.id}`);
  await audit(staff, "campaign.state", "campaign", c.id, { from: "offen", to: "auswertung", result: saved.id, version: saved.version, matrix: saved.result.matrixHash });
  await enqueue(c.tenantId, c.id, "lagernamen", null, null, { resultId: saved.id });
  refresh(id);
  redirect(`/verwaltung/${id}/auswertung`);
}

/** Closed too early: open again, as long as no report has been released. Stored results stay as versions. */
export async function reopenParticipation(id: string): Promise<void> {
  const staff = await requireInitiator();
  const c = await load(id, staff);
  const report = await latestReport(c.id);
  if (!["auswertung", "bericht"].includes(c.state) || (report && ["freigegeben", "veroeffentlicht"].includes(report.state))) redirect(`/verwaltung/${id}/auswertung`);
  await getDb().execute(sql`UPDATE campaigns SET state = 'offen', updated_at = now() WHERE id = ${c.id}`);
  await audit(staff, "campaign.state", "campaign", c.id, { from: c.state, to: "offen" });
  refresh(id);
  redirect(`/verwaltung/${id}/auswertung`);
}

/** The editors confirm or change the machine's camp names. */
export async function saveCampNames(id: string, resultId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const saved = await getResult(c.id, resultId);
  if (!saved?.result.camps) return { error: "Dieses Ergebnis hat keine Lager." };
  if (await namesLocked(saved.id)) return { error: "Der Bericht ist freigegeben; die Namen stehen fest." };
  const k = saved.result.camps.k;
  const names = Array.from({ length: k }, (_, g) => String(form.get(`name${g}`) ?? "").trim().replace(/\s+/g, " "));
  const descriptions = Array.from({ length: k }, (_, g) => String(form.get(`beschreibung${g}`) ?? "").trim().replace(/\s+/g, " "));
  const values = Object.fromEntries([...names.map((n, g) => [`name${g}`, n]), ...descriptions.map((d, g) => [`beschreibung${g}`, d])]);
  if (names.some((n) => n.length < 2 || n.length > 40)) return { error: "Jedes Lager braucht einen Namen mit 2 bis 40 Zeichen.", values };
  if (new Set(names.map((n) => n.toLowerCase())).size < k) return { error: "Zwei Lager haben denselben Namen.", values };
  if (descriptions.some((d) => d.length > 220)) return { error: "Eine Beschreibung ist länger als 220 Zeichen.", values };
  const current = namingOf(saved.campNames);
  await setCampNames(saved.id, { names, descriptions, proposal: current?.proposal ?? null, confirmedBy: `user:${staff.user.id}`, confirmedAt: new Date().toISOString() });
  await audit(staff, "result.camp_names", "campaign_result", saved.id, { names, descriptions, machine: current?.proposal ?? null });
  // A report not yet released still carries the old names in its sentences: it is withdrawn, the next one uses the new ones.
  const changed = current?.confirmedBy && (current.names.join("|") !== names.join("|") || current.descriptions.join("|") !== descriptions.join("|"));
  const open = changed ? await latestReport(c.id) : null;
  if (open && open.resultId === saved.id && ["liste", "text", "geprueft", "durchgefallen"].includes(open.state)) {
    await getDb().execute(sql`
      UPDATE campaign_reports SET state = 'zurueckgewiesen', feedback = 'Die Lagernamen wurden geändert.', decided_by = ${`user:${staff.user.id}`}, decided_at = now(), updated_at = now()
      WHERE id = ${open.id}`);
    await audit(staff, "report.zurueckgewiesen", "campaign_report", open.id, { version: open.version, reason: "Lagernamen geändert" });
    refresh(id);
    return { ok: "Die Namen sind gespeichert. Der Bericht nannte noch die alten; lassen Sie ihn neu schreiben." };
  }
  refresh(id);
  return { ok: "Die Namen sind gespeichert." };
}

/** Let the machine propose names again (e.g. after a failed job). */
export async function reproposeNames(id: string, resultId: string): Promise<void> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const saved = await getResult(c.id, resultId);
  if (saved && !(await namesLocked(saved.id))) await enqueue(c.tenantId, c.id, "lagernamen", null, null, { resultId: saved.id });
  refresh(id);
}

/** R1, then R2/R3 in the background. Needs confirmed camp names. */
export async function makeReport(id: string): Promise<void> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const saved = await latestResult(c.id);
  if (!saved || !["auswertung", "bericht"].includes(c.state)) redirect(`/verwaltung/${id}/auswertung`);
  if (!namingOf(saved.campNames)?.confirmedBy) redirect(`/verwaltung/${id}/auswertung?fehler=namen#lager`);
  const open = await latestReport(c.id);
  if (open && open.resultId === saved.id && ["liste", "text", "geprueft", "durchgefallen", "freigegeben"].includes(open.state)) redirect(`/verwaltung/${id}/bericht`);
  const report = await startReport(c, saved, staff.tenant.name);
  await getDb().execute(sql`UPDATE campaigns SET state = 'bericht', updated_at = now() WHERE id = ${c.id}`);
  await audit(staff, "report.created", "campaign_report", report.id, { version: report.version, result: saved.id, sentences: report.sentences.length });
  refresh(id);
  redirect(`/verwaltung/${id}/bericht`);
}

/** After a failed check: the machine tries again (R2 → R3). */
export async function rewriteReport(id: string, reportId: string): Promise<void> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const report = await getReport(c.id, reportId);
  if (report?.state === "durchgefallen") await enqueue(c.tenantId, c.id, "bericht", null, null, { reportId: report.id });
  refresh(id);
}

/** R4: the editors release. They cannot change a sentence — only release or reject. */
export async function releaseReport(id: string, reportId: string): Promise<void> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const report = await getReport(c.id, reportId);
  if (report?.state !== "geprueft") redirect(`/verwaltung/${id}/bericht`);
  await getDb().execute(sql`
    UPDATE campaign_reports SET state = 'freigegeben', decided_by = ${`user:${staff.user.id}`}, decided_at = now(), updated_at = now()
    WHERE id = ${report.id} AND state = 'geprueft'`);
  await audit(staff, "report.freigegeben", "campaign_report", report.id, { version: report.version });
  refresh(id);
  redirect(`/verwaltung/${id}/bericht`);
}

/** R4: rejected with a reason — a new version is written that reads it. */
export async function rejectReport(id: string, reportId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireEditor();
  const c = await load(id, staff);
  const report = await getReport(c.id, reportId);
  const reason = String(form.get("grund") ?? "").trim();
  if (!report || !["geprueft", "durchgefallen", "freigegeben"].includes(report.state)) return { error: "Diese Fassung lässt sich nicht mehr zurückweisen." };
  if (reason.length < 10) return { error: "Bitte schreiben Sie in einem Satz, was am Text nicht stimmt.", values: { grund: reason } };
  const saved = await getResult(c.id, report.resultId);
  if (!saved) return { error: "Das Ergebnis zu diesem Bericht gibt es nicht mehr." };
  await getDb().execute(sql`
    UPDATE campaign_reports SET state = 'zurueckgewiesen', decided_by = ${`user:${staff.user.id}`}, decided_at = now(), feedback = ${reason}, updated_at = now()
    WHERE id = ${report.id}`);
  await audit(staff, "report.zurueckgewiesen", "campaign_report", report.id, { version: report.version, reason });
  const next = await startReport(c, saved, staff.tenant.name, reason);
  await audit(staff, "report.created", "campaign_report", next.id, { version: next.version, after: report.id });
  refresh(id);
  redirect(`/verwaltung/${id}/bericht`);
}

/** R5: report, results page and open data go public. The initiator decides. */
export async function publishReport(id: string, reportId: string): Promise<void> {
  const staff = await requireInitiator();
  const c = await load(id, staff);
  const report = await getReport(c.id, reportId);
  if (report?.state !== "freigegeben") redirect(`/verwaltung/${id}/bericht`);
  await getDb().execute(sql`UPDATE campaign_reports SET state = 'veroeffentlicht', updated_at = now() WHERE id = ${report.id}`);
  await getDb().execute(sql`UPDATE campaigns SET state = 'veroeffentlicht', updated_at = now() WHERE id = ${c.id}`);
  await audit(staff, "report.veroeffentlicht", "campaign_report", report.id, { version: report.version, result: report.resultId });
  await audit(staff, "campaign.state", "campaign", c.id, { from: c.state, to: "veroeffentlicht" });
  refresh(id);
  revalidatePath(`/${staff.tenant.slug}/${c.slug}`, "layout");
  redirect(`/verwaltung/${id}/bericht`);
}
