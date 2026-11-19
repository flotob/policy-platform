"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptInvitation, login, register, requestReset, resetPassword, type FormState } from "./actions";

export function RegisterForm({ loggedIn, needsCode }: { loggedIn: boolean; needsCode: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(register, {});
  const v = state.values ?? {};
  return (
    <form action={action} className="acc-form" noValidate>
      {!loggedIn ? (
        <>
          <div className="field">
            <label htmlFor="name">Ihr Name</label>
            <input id="name" name="name" className="input" autoComplete="name" required defaultValue={v.name} />
          </div>
          <div className="field">
            <label htmlFor="email">Dienstliche E-Mail-Adresse</label>
            <input id="email" name="email" type="email" className="input" autoComplete="email" required defaultValue={v.email} />
          </div>
          <div className="field">
            <label htmlFor="password">Passwort</label>
            <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required />
            <span className="hint">Mindestens 10 Zeichen.</span>
          </div>
        </>
      ) : null}
      <div className="field">
        <label htmlFor="kommune">Ihre Kommune</label>
        <input id="kommune" name="kommune" className="input" placeholder="Stadt Musterstadt" required defaultValue={v.kommune} />
        <span className="hint">So erscheint sie über jedem Verfahren. Kolleginnen und Kollegen laden Sie später ein.</span>
      </div>
      {needsCode ? (
        <div className="field">
          <label htmlFor="code">Einladungscode</label>
          <input
            id="code"
            name="code"
            className="input num"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            required
            defaultValue={v.code}
          />
          <span className="hint">Groß- und Kleinschreibung und Bindestriche spielen keine Rolle.</span>
        </div>
      ) : null}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Konto wird angelegt …" : loggedIn ? "Kommune anlegen" : "Konto anlegen"}
      </button>
      {!loggedIn ? (
        <p className="small muted acc-alt">
          Schon ein Konto? <Link href="/anmelden">Anmelden</Link>
        </p>
      ) : null}
    </form>
  );
}

export function LoginForm({ signup }: { signup: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="acc-form" noValidate>
      <div className="field">
        <label htmlFor="email">E-Mail-Adresse</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required defaultValue={state.values?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Passwort</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Anmeldung …" : "Anmelden"}
      </button>
      <p className="small muted acc-alt">
        <Link href="/passwort-vergessen">Passwort vergessen?</Link>
      </p>
      <p className="small muted acc-alt">
        {signup ? (
          <>
            Noch kein Konto? <Link href="/registrieren">Konto für Ihre Kommune anlegen</Link>
          </>
        ) : (
          "Noch kein Konto? Konten gibt es auf Einladung, aus Ihrer Kommune oder von uns."
        )}
      </p>
    </form>
  );
}

function ErrorLine({ error }: { error?: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

function NewPasswordFields() {
  return (
    <>
      <div className="field">
        <label htmlFor="password">Passwort</label>
        <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required />
        <span className="hint">Mindestens 10 Zeichen.</span>
      </div>
      <div className="field">
        <label htmlFor="password2">Passwort wiederholen</label>
        <input id="password2" name="password2" type="password" className="input" autoComplete="new-password" minLength={10} required />
      </div>
    </>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestReset, {});
  return (
    <form action={action} className="acc-form" noValidate>
      <div className="field">
        <label htmlFor="email">E-Mail-Adresse Ihres Kontos</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required defaultValue={state.values?.email} />
      </div>
      <ErrorLine error={state.error} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Wird geschickt …" : "Link schicken"}
      </button>
      <p className="small muted acc-alt">
        <Link href="/anmelden">Zurück zur Anmeldung</Link>
      </p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="acc-form" noValidate>
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields />
      <ErrorLine error={state.error} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Wird gespeichert …" : "Passwort speichern"}
      </button>
    </form>
  );
}

export function InviteForm({ token, email, hasAccount }: { token: string; email: string; hasAccount: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInvitation, {});
  return (
    <form action={action} className="acc-form" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <span className="label">E-Mail-Adresse</span>
        <span>{email}</span>
      </div>
      {hasAccount ? (
        <p className="small muted">Zu dieser Adresse gibt es schon ein Konto. Nach dem Annehmen melden Sie sich mit Ihrem bisherigen Passwort an.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="name">Ihr Name</label>
            <input id="name" name="name" className="input" autoComplete="name" required defaultValue={state.values?.name} />
            <span className="hint">So sehen Ihre Kolleginnen und Kollegen, wer etwas freigegeben hat.</span>
          </div>
          <NewPasswordFields />
        </>
      )}
      <ErrorLine error={state.error} />
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Einen Moment …" : hasAccount ? "Einladung annehmen" : "Konto anlegen und beitreten"}
      </button>
    </form>
  );
}
