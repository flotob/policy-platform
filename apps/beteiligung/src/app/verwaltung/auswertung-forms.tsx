"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { rejectReport, saveCampNames } from "./auswertung-actions";
import { Status } from "./forms";

/** The camp names: the machine's proposal prefilled, the editors confirm or change it. */
export function CampNamesForm({
  id,
  resultId,
  names,
  descriptions,
  sizes,
  confirmed,
  locked,
}: {
  id: string;
  resultId: string;
  names: string[];
  descriptions: string[];
  sizes: number[];
  confirmed: boolean;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCampNames.bind(null, id, resultId), {});
  return (
    <form action={action} className="ws-form camp-names">
      {sizes.map((n, g) => (
        <fieldset key={g} className={`camp-name c${g}`} disabled={locked}>
          <legend>
            Lager {"ABCDE"[g]} <span className="muted small num">· {n.toLocaleString("de-DE")} Personen</span>
          </legend>
          <div className="field">
            <label htmlFor={`name${g}`}>Name</label>
            <input id={`name${g}`} name={`name${g}`} className="input" maxLength={40} required defaultValue={state.values?.[`name${g}`] ?? names[g] ?? ""} />
          </div>
          <div className="field">
            <label htmlFor={`beschreibung${g}`}>Was dieses Lager eint</label>
            <textarea
              id={`beschreibung${g}`}
              name={`beschreibung${g}`}
              className="textarea"
              rows={2}
              maxLength={220}
              defaultValue={state.values?.[`beschreibung${g}`] ?? descriptions[g] ?? ""}
            />
          </div>
        </fieldset>
      ))}
      {locked ? null : (
        <div className="form-foot">
          <button type="submit" className="btn" disabled={pending}>
            {confirmed ? "Namen ändern" : "Namen übernehmen"}
          </button>
          <Status state={state} pending={pending} />
        </div>
      )}
    </form>
  );
}

/** R4: send the text back, with one sentence on what is wrong. */
export function RejectForm({ id, reportId }: { id: string; reportId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(rejectReport.bind(null, id, reportId), {});
  return (
    <form action={action} className="ws-form reject-form">
      <div className="field">
        <label htmlFor="grund">Was stimmt am Text nicht?</label>
        <textarea id="grund" name="grund" className="textarea" rows={2} required defaultValue={state.values?.grund} />
        <span className="hint">
          Die Schlussfolgerungen selbst können Sie nicht ändern, nur den Text zurückgeben. Die Maschine schreibt eine neue Fassung und liest dabei Ihren Satz.
        </span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn btn-quiet" disabled={pending}>
          Zurückweisen und neu schreiben lassen
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}
