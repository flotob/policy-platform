import { sql } from "@policy/db";
import { redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { isPlatformAdmin, listTenants } from "@/lib/team";

import { NewTownForm, ResendForm } from "../team-forms";

export const metadata = { title: "Kommunen" };

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

/** Platform admins only (env PLATFORM_ADMINS): every municipality on streit.bar, and a new one with its first invitation. */
export default async function Kommunen() {
  const staff = await requireStaff();
  if (!isPlatformAdmin(staff.user)) redirect("/verwaltung");
  const towns = await listTenants();
  const pending = (
    await getDb().execute(sql`
      SELECT DISTINCT ON (tenant_id) id, tenant_id AS "tenantId", email, expires_at <= now() AS expired
      FROM staff_invites WHERE accepted_at IS NULL AND withdrawn_at IS NULL ORDER BY tenant_id, created_at DESC`)
  ).rows as { id: string; tenantId: string; email: string; expired: boolean }[];
  const pendingBy = new Map(pending.map((p) => [p.tenantId, p]));
  return (
    <div className="team">
      <div className="ws-title">
        <div>
          <h1>Kommunen</h1>
          <p className="muted">Alle Kommunen auf streit.bar. Neue Kommunen gibt es nur über diese Seite; die Registrierung ist geschlossen.</p>
        </div>
      </div>
      <section className="team-section">
        <h2>Neue Kommune anlegen</h2>
        <NewTownForm />
      </section>
      <table className="ws-table team-table">
        <thead>
          <tr>
            <th scope="col">Kommune</th>
            <th scope="col" className="num">Team</th>
            <th scope="col" className="num">Verfahren</th>
            <th scope="col">Einladung</th>
            <th scope="col">Angelegt</th>
          </tr>
        </thead>
        <tbody>
          {towns.map((t) => {
            const p = pendingBy.get(t.id);
            return (
              <tr key={t.id}>
                <td>
                  {t.name}
                  <span className="muted small ws-q">streit.bar/{t.slug}</span>
                </td>
                <td className="num">{t.members}</td>
                <td className="num">{t.campaigns}</td>
                <td>
                  {p ? (
                    <>
                      <span className="small">
                        {p.email} {p.expired ? <span className="muted">(abgelaufen)</span> : <span className="muted">(offen)</span>}
                      </span>
                      <ResendForm inviteId={p.id} tenantId={t.id} />
                    </>
                  ) : (
                    <span className="muted small">keine offene</span>
                  )}
                </td>
                <td className="muted">{date.format(new Date(t.createdAt))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
