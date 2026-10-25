"use client";

import Link from "next/link";
import { useActionState } from "react";

import { login, register, type FormState } from "./actions";

export function RegisterForm({ loggedIn }: { loggedIn: boolean }) {
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

export function LoginForm() {
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
        Noch kein Konto? <Link href="/registrieren">Konto für Ihre Kommune anlegen</Link>
      </p>
    </form>
  );
}
