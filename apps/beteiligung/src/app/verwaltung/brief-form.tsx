"use client";

import { useActionState, useMemo, useState } from "react";

import { FilePicker } from "@/components/FilePicker";
import type { KnownSender } from "@/lib/absender";

import type { ActionState } from "./actions";
import { enterLetter } from "./brief-actions";
import { SenderField, Status } from "./forms";

export function LetterForm({ id, senders }: { id: string; senders: KnownSender[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(enterLetter.bind(null, id), {});
  // After a successful entry the fields start empty again; after an error they keep what was typed.
  const formKey = useMemo(() => (state.ok ? Math.random() : 0), [state]);
  return (
    <form action={action} className="ws-form upload-form" key={formKey}>
      <LetterFields values={state.values ?? {}} senders={senders} />
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Eintragen
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

function LetterFields({ values: v, senders }: { values: Record<string, string>; senders: KnownSender[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [als, setAls] = useState(v.als ?? "privat");
  const [org, setOrg] = useState(v.org ?? "");
  return (
    <>
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
          <select id="als" name="als" className="select" value={als} onChange={(e) => setAls(e.target.value)}>
            <option value="privat">Einer Privatperson (wird nie mit Namen gezeigt)</option>
            <option value="organisation">Einer Organisation</option>
          </select>
        </div>
        <SenderField id="org" name="org" label="Name der Organisation" placeholder="nur bei Organisationen" value={org} onChange={setOrg}
          senders={senders} active={als === "organisation"} hint="Erscheint bei jedem Zitat aus diesem Beitrag." />
      </div>
      <div className="field">
        <label htmlFor="letter-text">Der Text</label>
        <textarea id="letter-text" name="text" className="textarea" rows={6} defaultValue={v.text} placeholder="Wörtlich abtippen, bei einem Anruf in den Worten des Anrufers." />
        <span className="hint">Namen und Anschriften von Privatpersonen bitte weglassen.</span>
      </div>
      <FilePicker
        id="scan"
        name="scan"
        label="Oder Scans anhängen"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        together="Sie zählen als ein Absender."
        hint="PDF oder Fotos des Briefs, je bis 20 MB. Mehrere Seiten am besten als ein PDF; Fotos einzelner Seiten gehen auch. Alle zählen als ein Absender. Briefkopf und Unterschrift lässt die Maschine weg."
      />
    </>
  );
}
