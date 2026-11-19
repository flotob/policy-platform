"use client";

import { useActionState, useMemo } from "react";

import type { ActionState } from "./actions";
import { enterLetter } from "./brief-actions";
import { Status } from "./forms";

export function LetterForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(enterLetter.bind(null, id), {});
  const v = state.values ?? {};
  const today = new Date().toISOString().slice(0, 10);
  // After a successful entry the fields start empty again; after an error they keep what was typed.
  const formKey = useMemo(() => (state.ok ? Math.random() : 0), [state]);
  return (
    <form action={action} className="ws-form upload-form" key={formKey}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="weg">Wie kam es?</label>
          <select id="weg" name="weg" className="select" defaultValue={v.weg ?? "brief"}>
            <option value="brief">Brief</option>
            <option value="anruf">Anruf</option>
            <option value="buergerbuero">Im Bürgerbüro</option>
            <option value="email">E-Mail</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="eingang">Eingegangen am</label>
          <input id="eingang" name="eingang" type="date" className="input" defaultValue={v.eingang ?? today} max={today} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="als">Von wem?</label>
          <select id="als" name="als" className="select" defaultValue={v.als ?? "privat"}>
            <option value="privat">Einer Privatperson (wird nie mit Namen gezeigt)</option>
            <option value="organisation">Einer Organisation</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="org">Name der Organisation</label>
          <input id="org" name="org" className="input" defaultValue={v.org} placeholder="nur bei Organisationen" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="letter-text">Der Text</label>
        <textarea id="letter-text" name="text" className="textarea" rows={6} defaultValue={v.text} placeholder="Wörtlich abtippen, bei einem Anruf in den Worten des Anrufers." />
        <span className="hint">Namen und Anschriften von Privatpersonen bitte weglassen.</span>
      </div>
      <div className="field">
        <label htmlFor="scan">Oder einen Scan anhängen</label>
        <input id="scan" name="scan" type="file" className="input file-input" accept="application/pdf,image/png,image/jpeg,image/webp" />
        <span className="hint">PDF oder Foto des Briefs, bis 20 MB. Die Maschine liest ihn ab; Briefkopf und Unterschrift lässt sie weg.</span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Eintragen
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}
