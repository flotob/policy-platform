"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { Status } from "./forms";
import {
  createMunicipalityWithInvite,
  inviteColleague,
  removeFromTeam,
  resendInvitation,
  resendTownInvitation,
  setRole,
  type InviteState,
} from "./team-actions";

type RoleOption = { value: string; label: string; text: string };

function LinkFallback({ state }: { state: InviteState }) {
  if (!state.link) return null;
  return (
    <p className="team-link">
      <input className="input" readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} aria-label="Einladungslink" />
    </p>
  );
}

export function InviteColleagueForm({ roles }: { roles: RoleOption[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteColleague, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="team-invite">
      <div className="field">
        <label htmlFor="inv-email">E-Mail-Adresse</label>
        <input id="inv-email" name="email" type="email" className="input" required defaultValue={v.email} placeholder="name@kommune.de" />
      </div>
      <fieldset className="field team-roles">
        <legend className="label">Rolle</legend>
        {roles.map((r) => (
          <label key={r.value} className="team-role">
            <input type="radio" name="role" value={r.value} defaultChecked={(v.role || "redaktion") === r.value} />
            <span>
              <strong>{r.label}</strong> <span className="muted">{r.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Einladung schicken
        </button>
        <Status state={state} pending={pending} />
      </div>
      <LinkFallback state={state} />
    </form>
  );
}

export function RoleForm({ userId, role, roles }: { userId: string; role: string; roles: RoleOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setRole.bind(null, userId), {});
  return (
    <form action={action} className="team-inline">
      <select name="role" className="select" defaultValue={role} aria-label="Rolle" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <Status state={state} pending={pending} />
    </form>
  );
}

export function RemoveForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeFromTeam.bind(null, userId), {});
  return (
    <form action={action} className="team-inline">
      <button type="submit" className="btn btn-quiet btn-small" disabled={pending} aria-label={`${name} aus dem Team entfernen`}>
        Entfernen
      </button>
      {state.error ? <span className="form-status error">{state.error}</span> : null}
    </form>
  );
}

export function ResendForm({ inviteId, tenantId }: { inviteId: string; tenantId?: string }) {
  const fn = tenantId ? resendTownInvitation.bind(null, tenantId, inviteId) : resendInvitation.bind(null, inviteId);
  const [state, action, pending] = useActionState<InviteState>(fn, {});
  return (
    <form action={action} className="team-inline">
      <button type="submit" className="btn btn-quiet btn-small" disabled={pending}>
        Neu schicken
      </button>
      <Status state={state} pending={pending} />
      <LinkFallback state={state} />
    </form>
  );
}

export function NewTownForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(createMunicipalityWithInvite, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="team-invite">
      <div className="field-row">
        <div className="field">
          <label htmlFor="town-name">Kommune</label>
          <input id="town-name" name="name" className="input" required defaultValue={v.name} placeholder="Stadt Beispielhausen" />
        </div>
        <div className="field">
          <label htmlFor="town-email">E-Mail der ersten Person</label>
          <input id="town-email" name="email" type="email" className="input" required defaultValue={v.email} />
          <span className="hint">Sie wird Initiatorin oder Initiator und lädt ihr Team selbst ein.</span>
        </div>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Anlegen und einladen
        </button>
        <Status state={state} pending={pending} />
      </div>
      <LinkFallback state={state} />
    </form>
  );
}
