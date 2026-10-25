"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { startWithCode, submitShort, uploadStatement, type DoorState } from "./actions";

const MAX = 400;

function Submit({ children, pending }: { children: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className="btn pub-cta" disabled={busy}>
      {busy ? pending : children}
    </button>
  );
}

/** Access "einladung": the code from the letter opens the participation. */
export function CodeForm({ gemeinde, verfahren }: { gemeinde: string; verfahren: string }) {
  const [state, action] = useActionState<DoorState, FormData>(startWithCode.bind(null, gemeinde, verfahren), {});
  return (
    <form action={action} className="door-form">
      <div className="field">
        <label htmlFor="code">Dein Einladungscode</label>
        <input id="code" name="code" className="input code-input" defaultValue={state.values?.code ?? ""} autoComplete="off" placeholder="ABCD-2345" required />
        <span className="hint">Er steht in dem Brief, mit dem die Stadt dich eingeladen hat.</span>
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
      <Submit pending="Wird geprüft …">Mit Code starten</Submit>
    </form>
  );
}

/** Door 2: two sentences, checked while you wait. */
export function ShortForm({ gemeinde, verfahren, needsCode }: { gemeinde: string; verfahren: string; needsCode: boolean }) {
  const [state, action] = useActionState<DoorState, FormData>(submitShort.bind(null, gemeinde, verfahren), {});
  const [text, setText] = useState(state.values?.text ?? "");
  return (
    <form action={action} className="door-form">
      <div className="field">
        <label htmlFor="text" className="visually-hidden">
          Dein Punkt
        </label>
        <textarea
          id="text"
          name="text"
          className="textarea door-text"
          rows={4}
          maxLength={MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Zum Beispiel: Für Familien an der Finanzierungsgrenze sind zwei Prozent mehr Baukosten zu viel."
          required
        />
        <span className="hint num">
          {text.length} von {MAX} Zeichen. Zwei Sätze reichen. Kein Formular, keine Anmeldung.
        </span>
      </div>
      {needsCode ? (
        <div className="field">
          <label htmlFor="code2">Dein Einladungscode</label>
          <input id="code2" name="code" className="input code-input" autoComplete="off" required />
        </div>
      ) : null}
      {state.error ? <p className="error">{state.error}</p> : null}
      <Submit pending="Wird geprüft …">Punkt prüfen lassen</Submit>
    </form>
  );
}

/** Door 3: a full statement, as a private person or for an organisation. */
export function UploadForm({ gemeinde, verfahren, needsCode }: { gemeinde: string; verfahren: string; needsCode: boolean }) {
  const [state, action] = useActionState<DoorState, FormData>(uploadStatement.bind(null, gemeinde, verfahren), {});
  const [als, setAls] = useState(state.values?.als ?? "privat");
  return (
    <form action={action} className="door-form">
      <fieldset className="plain">
        <legend>Du schreibst</legend>
        <label className="check">
          <input type="radio" name="als" value="privat" checked={als === "privat"} onChange={() => setAls("privat")} />
          <span>
            als Privatperson <span className="muted small">— dein Name erscheint nirgends</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" name="als" value="organisation" checked={als === "organisation"} onChange={() => setAls("organisation")} />
          <span>für einen Verein, einen Betrieb, eine Einrichtung</span>
        </label>
      </fieldset>
      {als === "organisation" ? (
        <div className="field-row">
          <div className="field">
            <label htmlFor="org">Name</label>
            <input id="org" name="org" className="input" defaultValue={state.values?.org ?? ""} placeholder="Sportverein Musterstadt e. V." required />
            <span className="hint">Erscheint bei jedem Zitat aus deiner Stellungnahme.</span>
          </div>
          <div className="field">
            <label htmlFor="orgType">Art</label>
            <select id="orgType" name="orgType" className="select" defaultValue={state.values?.orgType ?? "verband"}>
              <option value="verband">Verein oder Verband</option>
              <option value="unternehmen">Betrieb oder Unternehmen</option>
              <option value="wissenschaft">Wissenschaft</option>
              <option value="behoerde">Öffentliche Stelle</option>
            </select>
          </div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="file">Datei</label>
        <input id="file" name="file" type="file" className="input" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" required />
        <span className="hint">PDF, Word oder Text, bis 20 MB. Eingescannte Seiten kann die Maschine noch nicht lesen.</span>
      </div>
      {needsCode ? (
        <div className="field">
          <label htmlFor="code3">Dein Einladungscode</label>
          <input id="code3" name="code" className="input code-input" autoComplete="off" required />
        </div>
      ) : null}
      {state.error ? <p className="error">{state.error}</p> : null}
      <Submit pending="Wird hochgeladen …">Stellungnahme einreichen</Submit>
    </form>
  );
}
