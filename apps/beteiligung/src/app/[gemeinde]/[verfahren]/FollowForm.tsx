"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { followCampaign, type DoorState } from "./actions";

function Send() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-quiet" disabled={pending}>
      {pending ? "Wird gesendet …" : "Benachrichtige mich"}
    </button>
  );
}

/** "Willst du erfahren, was daraus wird?" — voluntary, two messages at most. */
export function FollowForm({ gemeinde, verfahren, token = null, after = "result" }: { gemeinde: string; verfahren: string; token?: string | null; after?: "result" | "decision" }) {
  const [state, action] = useActionState<DoorState, FormData>(followCampaign.bind(null, gemeinde, verfahren, token), {});
  if (state.ok) return <p className="follow-ok" role="status">{state.ok}</p>;
  return (
    <form action={action} className="follow">
      <p className="follow-head">
        <strong>Willst du erfahren, was daraus wird?</strong>{" "}
        {after === "decision"
          ? "Wir schreiben dir einmal: wenn der Gemeinderat entschieden hat, und was aus den Punkten geworden ist."
          : "Wir schreiben dir zweimal: wenn das Ergebnis da ist, und wenn der Gemeinderat entschieden hat."}
      </p>
      <div className="follow-row">
        <label htmlFor="follow-email" className="visually-hidden">
          E-Mail-Adresse
        </label>
        <input id="follow-email" name="email" type="email" className="input" placeholder="deine@adresse.de" autoComplete="email" defaultValue={state.values?.email ?? ""} required />
        <Send />
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
      <p className="follow-fine small muted">
        Freiwillig. Die Adresse steht nicht bei deinen Stimmen, wird nur dafür benutzt und mit einem Klick gelöscht.
      </p>
    </form>
  );
}
