"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Role, Staff } from "@/lib/session";
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

/** Inviting goes out in the town's name: only with a confirmed address (lib/bestaetigen.ts). */
const UNCONFIRMED =
  "Einladen können Sie, sobald Ihre E-Mail-Adresse bestätigt ist. Den Link finden Sie in Ihrer Mail; oben auf der Seite können Sie eine neue anfordern.";

const inviterOf = (staff: Staff) => ({ id: staff.user.id, name: staff.user.name, email: staff.user.email });

export async function inviteColleague(_prev: InviteState, form: FormData): Promise<InviteState> {
  const staff = await requireInitiator();
  const values = { email: field(form, "email"), role: field(form, "role") };
  if (!staff.user.emailVerified) return { error: UNCONFIRMED, values };
  const r = await invite({ tenantId: staff.tenant.id, email: values.email, role: values.role as Role, inviter: inviterOf(staff) });
  revalidatePath("/verwaltung/team");
  return inviteMessage(r, values);
}

export async function resendInvitation(inviteId: string, _prev: InviteState): Promise<InviteState> {
  const staff = await requireInitiator();
  if (!staff.user.emailVerified) return { error: UNCONFIRMED };
  const r = await resendInvite(staff.tenant.id, inviteId, inviterOf(staff));
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
  const r = await invite({ tenantId: t.id, email: values.email, role: "initiator", inviter: inviterOf(staff), newTown: true });
  revalidatePath("/verwaltung/kommunen");
  const m = inviteMessage(r, values);
  return m.ok ? { ok: `${values.name} ist angelegt (streit.bar/${t.slug}). ${m.ok}` } : m;
}

export async function resendTownInvitation(tenantId: string, inviteId: string, _prev: InviteState): Promise<InviteState> {
  const staff = await requireStaff();
  if (!isPlatformAdmin(staff.user)) redirect("/verwaltung");
  const r = await resendInvite(tenantId, inviteId, inviterOf(staff));
  revalidatePath("/verwaltung/kommunen");
  return inviteMessage(r);
}
