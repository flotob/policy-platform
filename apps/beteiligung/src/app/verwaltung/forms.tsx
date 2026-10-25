"use client";

import { useActionState } from "react";

import { EDITORIAL_MODES, STEPS, type CampaignParams, type EditorialMode, type Steps } from "@/lib/params";

import { createCampaign, generateInvites, saveBasics, saveJustification, saveProcess, uploadFile, type ActionState } from "./actions";

function Status({ state, pending }: { state: ActionState; pending: boolean }) {
  if (pending) return <span className="form-status muted">Wird gespeichert …</span>;
  if (state.error)
    return (
      <span className="form-status error" role="alert">
        {state.error}
      </span>
    );
  if (state.ok)
    return (
      <span className="form-status ok" role="status">
        {state.ok}
      </span>
    );
  return null;
}

const QUESTION_HINT = "Eine Frage, die man mit Ja oder Nein beantworten kann. Sie steht groß über der Beteiligung.";
const MEASURE_HINT = "Was genau beschlossen werden soll, in ein oder zwei Sätzen. Über diesen Wortlaut wird am Ende abgestimmt.";

export function NewCampaignForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCampaign, {});
  return (
    <form action={action} className="ws-form">
      <div className="field">
        <label htmlFor="title">Titel</label>
        <input id="title" name="title" className="input" placeholder="Solarpflicht für Neubauten" required defaultValue={state.values?.title} />
      </div>
      <div className="field">
        <label htmlFor="question">Entscheidungsfrage</label>
        <input id="question" name="question" className="input" placeholder="Soll die Stadt für Neubauten eine Solarpflicht einführen?" required defaultValue={state.values?.question} />
        <span className="hint">{QUESTION_HINT}</span>
      </div>
      <div className="field">
        <label htmlFor="measure">Die Maßnahme</label>
        <textarea
          id="measure"
          name="measure"
          className="textarea"
          placeholder="Die Stadt verpflichtet Bauherren, auf jedem Neubau eine Solaranlage zu errichten."
          required
          defaultValue={state.values?.measure}
        />
        <span className="hint">{MEASURE_HINT}</span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Verfahren anlegen
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function BasicsForm(props: { id: string; title: string; question: string; measure: string; summary: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBasics.bind(null, props.id), {});
  const v = { title: props.title, question: props.question, measure: props.measure, summary: props.summary ?? "", ...state.values };
  return (
    <form action={action} className="ws-form">
      <div className="field">
        <label htmlFor="title">Titel</label>
        <input id="title" name="title" className="input" defaultValue={v.title} required />
      </div>
      <div className="field">
        <label htmlFor="question">Entscheidungsfrage</label>
        <input id="question" name="question" className="input" defaultValue={v.question} required />
        <span className="hint">{QUESTION_HINT}</span>
      </div>
      <div className="field">
        <label htmlFor="measure">Die Maßnahme</label>
        <textarea id="measure" name="measure" className="textarea" defaultValue={v.measure} required />
        <span className="hint">{MEASURE_HINT}</span>
      </div>
      <div className="field">
        <label htmlFor="summary">Kurz erklärt, für Bürgerinnen und Bürger</label>
        <textarea id="summary" name="summary" className="textarea" defaultValue={v.summary} />
        <span className="hint">Zwei, drei Sätze auf der Startseite der Beteiligung: worum es geht und warum die Stadt fragt. Ohne Amtsdeutsch.</span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Speichern
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function JustificationForm(props: { id: string; justification: string | null; steps: Steps }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveJustification.bind(null, props.id), {});
  return (
    <form action={action} className="ws-form">
      <div className="field">
        <label htmlFor="justification">Die Begründung, wie sie in der Vorlage steht</label>
        <textarea id="justification" name="justification" className="textarea tall" defaultValue={props.justification ?? ""} />
        <span className="hint">
          Fügen Sie die Begründung aus der Beschlussvorlage ein. Bei der Vorbereitung schlägt die Maschine daraus die vier Schritte unten vor; Sie
          können sie auch selbst schreiben.
        </span>
      </div>
      <fieldset className="steps-edit">
        <legend>Die Begründung in vier Schritten</legend>
        <p className="hint">
          Wer eine Maßnahme begründet, macht vier Schritte. Jeder Beitrag aus der Beteiligung stützt einen davon oder greift ihn an. So sieht man
          am Ende, welcher Schritt hält und an welchem der Streit hängt.
        </p>
        {STEPS.map((s, i) => (
          <div className="field step-field" key={s.key}>
            <label htmlFor={`step_${s.key}`}>
              <span className="step-no">{i + 1}</span> {s.label}
            </label>
            <span className="hint">{s.hint}</span>
            <textarea id={`step_${s.key}`} name={`step_${s.key}`} className="textarea" defaultValue={props.steps[s.key] ?? ""} />
          </div>
        ))}
      </fieldset>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Speichern
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function ProcessForm({ id, params }: { id: string; params: CampaignParams }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProcess.bind(null, id), {});
  return (
    <form action={action} className="ws-form">
      <fieldset className="plain">
        <legend className="label">Wie man mitmachen kann</legend>
        <label className="check">
          <input type="checkbox" name="door_abstimmen" defaultChecked={params.doors.abstimmen} />
          <span>
            <strong>Abstimmen.</strong> Zu jeder Aussage zustimmen, ablehnen oder überspringen. Ohne Anmeldung.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" name="door_kurzaussage" defaultChecked={params.doors.kurzaussage} />
          <span>
            <strong>Eigenen Punkt einbringen.</strong> In zwei Sätzen sagen, was in der Debatte fehlt.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" name="door_stellungnahme" defaultChecked={params.doors.stellungnahme} />
          <span>
            <strong>Stellungnahme einreichen.</strong> Ein ganzes Schreiben mit Anlagen, etwa von Verbänden oder Fachleuten.
          </span>
        </label>
      </fieldset>
      <div className="field-row">
        <div className="field">
          <label htmlFor="start">Beginn</label>
          <input id="start" name="start" type="date" className="input" defaultValue={params.start ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="end">Spätestes Ende</label>
          <input id="end" name="end" type="date" className="input" defaultValue={params.end ?? ""} />
          <span className="hint">Kommt vorher nichts Neues mehr, können Sie früher schließen.</span>
        </div>
      </div>
      <fieldset className="plain">
        <legend className="label">Wer neue Punkte prüft</legend>
        {(Object.keys(EDITORIAL_MODES) as EditorialMode[]).map((m) => (
          <label className="check" key={m}>
            <input type="radio" name="editorialMode" value={m} defaultChecked={params.editorialMode === m} />
            <span>
              <strong>{EDITORIAL_MODES[m].label}.</strong> {EDITORIAL_MODES[m].text}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="plain">
        <legend className="label">Wer teilnehmen kann</legend>
        <label className="check">
          <input type="radio" name="access" value="offen" defaultChecked={params.access === "offen"} />
          <span>
            <strong>Alle mit dem Link.</strong> Keine Anmeldung, eine Stimme pro Aussage und Gerät.
          </span>
        </label>
        <label className="check">
          <input type="radio" name="access" value="einladung" defaultChecked={params.access === "einladung"} />
          <span>
            <strong>Nur mit Einladungscode.</strong> Etwa für einen Bürgerrat oder ausgewählte Haushalte.
          </span>
        </label>
      </fieldset>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Speichern
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function UploadForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadFile.bind(null, id), {});
  return (
    <form action={action} className="ws-form upload-form">
      <div className="field-row">
        <div className="field">
          <label htmlFor="role">Was ist das?</label>
          <select id="role" name="role" className="select" defaultValue={state.values?.role ?? "stellungnahme"} key={state.values?.role ?? "r"}>
            <option value="entwurf">Entwurf (Satzung, Vorlage)</option>
            <option value="unterlage">Unterlage (Gutachten, Daten)</option>
            <option value="stellungnahme">Eingegangene Stellungnahme</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="file">Datei</label>
          <input id="file" name="file" type="file" className="input" accept=".pdf,.docx,.doc,.txt,.odt" required />
          <span className="hint">PDF, Word oder Text, bis 20 MB.</span>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sender">Absender (bei Stellungnahmen)</label>
          <input id="sender" name="sender" className="input" placeholder="Stadtwerke Musterstadt" defaultValue={state.values?.sender} />
        </div>
        <div className="field">
          <label htmlFor="senderType">Art des Absenders</label>
          <select id="senderType" name="senderType" className="select" defaultValue={state.values?.senderType ?? ""} key={state.values?.senderType ?? "t"}>
            <option value="">Keine Angabe</option>
            <option value="verband">Verband oder Verein</option>
            <option value="unternehmen">Unternehmen</option>
            <option value="behoerde">Behörde oder öffentliche Stelle</option>
            <option value="wissenschaft">Wissenschaft</option>
            <option value="politik">Politik</option>
            <option value="privat">Privatperson</option>
          </select>
        </div>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Hochladen
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

/** Invitation codes: generated here, shown exactly once to print or send. */
export function InviteForm({ id, total, used }: { id: string; total: number; used: number }) {
  const [state, action] = useActionState<ActionState, FormData>(generateInvites.bind(null, id), {});
  return (
    <div className="invites">
      <p className="small muted">
        {total ? `${total} Codes erzeugt, ${used} davon benutzt.` : "Noch keine Codes."} Jeder Code öffnet die Beteiligung für genau eine Person.
      </p>
      <form action={action} className="invites-form">
        <label htmlFor="count" className="small">
          Neue Codes
        </label>
        <input id="count" name="count" type="number" min={1} max={5000} defaultValue={100} className="input" style={{ width: 110 }} />
        <button type="submit" className="btn btn-quiet btn-small">
          Codes erzeugen
        </button>
      </form>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.ok ? (
        <div className="field">
          <label htmlFor="codes">Die neuen Codes: jetzt kopieren oder drucken. Sie werden nicht noch einmal angezeigt.</label>
          <textarea id="codes" className="textarea num" readOnly rows={8} value={state.ok} />
        </div>
      ) : null}
    </div>
  );
}
