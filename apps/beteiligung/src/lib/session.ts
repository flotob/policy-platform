import { sql } from "@policy/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "./auth";
import { getDb } from "./db";

export type Role = "initiator" | "redaktion" | "betrachter";

export interface Staff {
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; name: string };
  role: Role;
}

/** The logged-in staff member, once per request; null for visitors. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The municipality the user works for (the first membership; several per user come later). */
export const getStaff = cache(async (): Promise<Staff | null> => {
  const session = await getSession();
  if (!session) return null;
  const r = await getDb().execute(sql`
    SELECT t.id, t.slug, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = ${session.user.id} ORDER BY m.created_at LIMIT 1`);
  const t = r.rows[0] as { id: string; slug: string; name: string; role: Role } | undefined;
  if (!t) return null;
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    tenant: { id: t.id, slug: t.slug, name: t.name },
    role: t.role,
  };
});

/** Staff pages: logged-in members only. */
export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect((await getSession()) ? "/registrieren" : "/anmelden");
  return staff;
}

/** Changing a campaign needs the initiator role. */
export async function requireInitiator(): Promise<Staff> {
  const staff = await requireStaff();
  if (staff.role !== "initiator") redirect("/verwaltung?fehler=rolle");
  return staff;
}
