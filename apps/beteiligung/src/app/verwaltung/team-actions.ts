"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Role } from "@/lib/session";
import { requireInitiator, requireStaff } from "@/lib/session";
import { changeRole, createTenant, invite, isPlatformAdmin, removeMember, resendInvite, withdrawInvite, type InviteResult } from "@/lib/team";

import type { ActionState } from "./actions";

export interface InviteState extends ActionState {
  /** Only when the email could not go out: the link to pass on by hand. */
  link?: string;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function inviteMessage(r: InviteResult, values?: Record<string, string>): InviteState {
  if (!r.ok) return { error: r.error, values };
  if (r.mailed) return { ok: `Einladung an ${r.email} ist verschickt.` };
  return {
    error: `Die E-Mail an ${r.email} ließ sich nicht verschicken. Geben Sie diesen Link selbst weiter, er gilt 7 Tage:`,
    link: r.link,
  };
}

export async function inviteColleague(_prev: InviteState, form: FormData): Promise<InviteState> {
  const staff = await requireInitiator();
  const values = { email: field(form, "email"), role: field(form, "role") };
  const r = await invite({ tenantId: staff.tenant.id, email: values.email, role: values.role as Role, inviter: { id: staff.user.id, name: staff.user.name } });
  revalidatePath("/verwaltung/team");
  return inviteMessage(r, values);
}

export async function resendInvitation(inviteId: string, _prev: InviteState): Promise<InviteState> {
  const staff = await requireInitiator();
  const r = await resendInvite(staff.tenant.id, inviteId, { id: staff.user.id, name: staff.user.name });
  revalidatePath("/verwaltung/team");
  return inviteMessage(r);
}

export async function withdrawInvitation(inviteId: string): Promise<void> {
  const staff = await requireInitiator();
  await withdrawInvite(staff.tenant.id, inviteId, staff.user.id);
  revalidatePath("/verwaltung/team");
}

export async function setRole(userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const err = await changeRole(staff.tenant.id, userId, field(form, "role") as Role, staff.user.id);
  revalidatePath("/verwaltung/team");
  return err ? { error: err } : { ok: "Gespeichert." };
}

export async function removeFromTeam(userId: string, _prev: ActionState): Promise<ActionState> {
  const staff = await requireInitiator();
  const err = await removeMember(staff.tenant.id, userId, staff.user.id);
  revalidatePath("/verwaltung/team");
  return err ? { error: err } : { ok: "Entfernt." };
}

/** Platform admins: a new municipality and the invitation for its first person (initiator). */
export async function createMunicipalityWithInvite(_prev: InviteState, form: FormData): Promise<InviteState> {
  const staff = await requireStaff();
  if (!isPlatformAdmin(staff.user)) redirect("/verwaltung");
  const values = { name: field(form, "name"), email: field(form, "email") };
  if (values.name.length < 3) return { error: "Bitte geben Sie den Namen der Kommune an.", values };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return { error: "Diese E-Mail-Adresse sieht nicht vollständig aus.", values };
  const t = await createTenant(values.name, staff.user.id);
  const r = await invite({ tenantId: t.id, email: values.email, role: "initiator", inviter: { id: staff.user.id, name: staff.user.name }, newTown: true });
  revalidatePath("/verwaltung/kommunen");
  const m = inviteMessage(r, values);
  return m.ok ? { ok: `${values.name} ist angelegt (streit.bar/${t.slug}). ${m.ok}` } : m;
}

export async function resendTownInvitation(tenantId: string, inviteId: string, _prev: InviteState): Promise<InviteState> {
  const staff = await requireStaff();
  if (!isPlatformAdmin(staff.user)) redirect("/verwaltung");
  const r = await resendInvite(tenantId, inviteId, { id: staff.user.id, name: staff.user.name });
  revalidatePath("/verwaltung/kommunen");
  return inviteMessage(r);
}
