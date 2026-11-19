import { requireStaff } from "@/lib/session";
import { listTeam, ROLE_LABEL, ROLE_TEXT, ROLES } from "@/lib/team";

import { withdrawInvitation } from "../team-actions";
import { InviteColleagueForm, RemoveForm, ResendForm, RoleForm } from "../team-forms";

export const metadata = { title: "Team" };

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const short = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function Team() {
  const staff = await requireStaff();
  const { members, invites } = await listTeam(staff.tenant.id);
  const manage = staff.role === "initiator";
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], text: ROLE_TEXT[r] }));
  return (
    <div className="ws-narrow team">
      <div className="ws-title">
        <div>
          <h1>Team</h1>
          <p className="muted">Wer bei {staff.tenant.name} mitarbeitet. Bürgerinnen und Bürger brauchen kein Konto.</p>
        </div>
      </div>

      <table className="ws-table team-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Rolle</th>
            {manage ? <th scope="col">Dabei seit</th> : null}
            {manage ? <th scope="col" aria-label="Aktionen" /> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.name}
                {m.userId === staff.user.id ? <span className="tag">Sie</span> : null}
                {m.demo ? <span className="tag">öffentlicher Beispiel-Zugang</span> : null}
                {manage ? <span className="muted small ws-q">{m.email}</span> : null}
              </td>
              <td>
                {manage && !m.demo && m.userId !== staff.user.id ? <RoleForm userId={m.userId} role={m.role} roles={roles} /> : ROLE_LABEL[m.role]}
              </td>
              {manage ? <td className="muted nowrap">{short.format(new Date(m.since))}</td> : null}
              {manage ? <td>{m.demo || m.userId === staff.user.id ? null : <RemoveForm userId={m.userId} name={m.name} />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      {manage && invites.length ? (
        <section className="team-section">
          <h2>Offene Einladungen</h2>
          <ul className="team-invites">
            {invites.map((i) => (
              <li key={i.id}>
                <span>
                  <strong>{i.email}</strong> <span className="muted">als {ROLE_LABEL[i.role]}</span>
                  <span className="muted small ws-q">
                    {i.expired
                      ? "Abgelaufen. Schicken Sie die Einladung neu, wenn die Person noch dazukommen soll."
                      : `${i.sentAt ? "Verschickt" : "Noch nicht per E-Mail verschickt"} am ${date.format(new Date(i.createdAt))}, gilt bis ${date.format(new Date(i.expiresAt))}`}
                  </span>
                </span>
                <span className="team-actions">
                  <ResendForm inviteId={i.id} />
                  <form action={withdrawInvitation.bind(null, i.id)}>
                    <button type="submit" className="btn btn-quiet btn-small">
                      Zurückziehen
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {manage ? (
        <section className="team-section">
          <h2>Kollegin oder Kollegen einladen</h2>
          <p className="muted">Die Person bekommt eine E-Mail mit einem Link. Damit legt sie ihr Passwort fest und ist im Team. Der Link gilt 7 Tage.</p>
          <InviteColleagueForm roles={roles} />
        </section>
      ) : (
        <p className="muted team-section">Einladen und Rollen ändern können Initiatorinnen und Initiatoren Ihrer Kommune.</p>
      )}
    </div>
  );
}
