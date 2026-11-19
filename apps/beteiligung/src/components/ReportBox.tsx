"use client";

import { useActionState, useState } from "react";

import { reportFromPage, type ReportState } from "@/app/[gemeinde]/[verfahren]/melden-actions";

const REASONS = [
  { key: "beleidigend", label: "Beleidigend oder hetzerisch" },
  { key: "persoenlich", label: "Nennt oder beschreibt eine Privatperson" },
  { key: "falsch", label: "Gibt einen Beitrag falsch wieder" },
  { key: "sonstiges", label: "Etwas anderes" },
];

/** "Hier stimmt etwas nicht": a small form that opens in place. The editors decide; nothing disappears by itself. */
export function ReportBox({ gemeinde, verfahren, kind, id, label }: { gemeinde: string; verfahren: string; kind: "node" | "move"; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ReportState, FormData>(reportFromPage.bind(null, gemeinde, verfahren, kind, id), {});
  if (state.ok) return <p className="report-done">Danke. Die Redaktion sieht sich das an.</p>;
  if (!open)
    return (
      <button type="button" className="report-open" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <form action={action} className="report-box">
      <fieldset>
        <legend>Was stimmt hier nicht?</legend>
        {REASONS.map((r, i) => (
          <label key={r.key}>
            <input type="radio" name="grund" value={r.key} defaultChecked={i === 0} /> {r.label}
          </label>
        ))}
      </fieldset>
      <label className="report-note">
        Kurz erklären (freiwillig)
        <textarea name="notiz" maxLength={300} rows={2} />
      </label>
      {state.error ? <p className="report-err">{state.error}</p> : null}
      <div className="report-actions">
        <button type="submit" disabled={pending}>
          Melden
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
