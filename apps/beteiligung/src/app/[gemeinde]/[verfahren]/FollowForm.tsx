"use client";

import { useActionState, useEffect, useState } from "react";
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

/** "Möchten Sie erfahren, was daraus wird?" — voluntary, two messages at most. */
export function FollowForm({
  gemeinde,
  verfahren,
  token = null,
  after = "result",
  onDone,
}: {
  gemeinde: string;
  verfahren: string;
  token?: string | null;
  after?: "result" | "decision";
  onDone?: () => void;
}) {
  const [state, action] = useActionState<DoorState, FormData>(followCampaign.bind(null, gemeinde, verfahren, token), {});
  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state.ok, onDone]);
  if (state.ok) return <p className="follow-ok" role="status">{state.ok}</p>;
  return (
    <form action={action} className="follow">
      <p className="follow-head">
        <strong>Möchten Sie erfahren, was daraus wird?</strong>{" "}
        {after === "decision"
          ? "Wir schreiben Ihnen einmal: wenn der Gemeinderat entschieden hat, und was aus den Punkten geworden ist."
          : "Wir schreiben Ihnen zweimal: wenn das Ergebnis da ist, und wenn der Gemeinderat entschieden hat."}
      </p>
      <div className="follow-row">
        <label htmlFor="follow-email" className="visually-hidden">
          E-Mail-Adresse
        </label>
        <input id="follow-email" name="email" type="email" className="input" placeholder="name@beispiel.de" autoComplete="email" defaultValue={state.values?.email ?? ""} required />
        <Send />
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
      <p className="follow-fine small muted">
        Freiwillig. Die Adresse steht nicht bei Ihren Stimmen, wird nur dafür benutzt und mit einem Klick gelöscht.
      </p>
    </form>
  );
}

const KEY = (gemeinde: string, verfahren: string) => `folgen:${gemeinde}/${verfahren}`;
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private window: the box simply comes back */
  }
};

/**
 * The offer while voting: shown from the first vote on, can be closed, and stays one click away
 * as a single line. Once this browser has signed up, it does not come back (the page only
 * remembers that in the browser; the address is not linked to the votes).
 */
export function FollowPrompt({ gemeinde, verfahren, open: startOpen = false }: { gemeinde: string; verfahren: string; open?: boolean }) {
  const key = KEY(gemeinde, verfahren);
  const [mode, setMode] = useState<"offen" | "zu" | "fertig" | null>(null);
  useEffect(() => {
    const v = read(key);
    setMode(v === "fertig" ? "fertig" : v === "zu" && !startOpen ? "zu" : "offen");
  }, [key, startOpen]);
  if (mode === null || mode === "fertig") return null;
  if (mode === "zu")
    return (
      <button type="button" className="follow-reopen" onClick={() => setMode("offen")}>
        Per E-Mail erfahren, was daraus wird
      </button>
    );
  return (
    <div className="follow-card">
      <button
        type="button"
        className="follow-close"
        aria-label="Schließen"
        onClick={() => {
          write(key, "zu");
          setMode("zu");
        }}
      >
        ×
      </button>
      <FollowForm gemeinde={gemeinde} verfahren={verfahren} onDone={() => write(key, "fertig")} />
    </div>
  );
}
