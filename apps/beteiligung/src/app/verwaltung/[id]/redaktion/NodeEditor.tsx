"use client";

import { useState } from "react";

import type { Node } from "@/lib/redaktion";
import { QUESTIONS, STEPS } from "@/lib/params";
import { TYP } from "@/lib/vocab";

/**
 * The wording and the fixed fields of one point, as the editors release it
 * (Z7) or correct it later (A2). The question list follows the chosen step:
 * only questions that can attack that step are offered.
 */
export function NodeEditor({
  node,
  action,
  submitLabel,
  hint,
}: {
  node: Node;
  action: (form: FormData) => Promise<void>;
  submitLabel: string;
  hint?: string;
}) {
  const [schritt, setSchritt] = useState(node.schritt ?? "lage");
  const [richtung, setRichtung] = useState(node.richtung ?? "stuetzt");
  const questions = QUESTIONS.filter((q) => (q.steps as readonly string[]).includes(schritt));
  const [frage, setFrage] = useState(node.frage ?? questions[0]?.key ?? "lage");
  const frageOk = questions.some((q) => q.key === frage) ? frage : (questions[0]?.key ?? "lage");
  const isRoot = node.rolle === "schluss";
  const isPremise = node.rolle === "praemisse";

  return (
    <form action={action} className="ne">
      <div className="field">
        <label htmlFor={`text-${node.id}`}>Aussage, über die abgestimmt wird</label>
        <textarea id={`text-${node.id}`} name="text" className="textarea ne-text" defaultValue={node.text} required rows={3} />
        <span className="hint">Ein Satz, eine Behauptung, neutral. Wer zustimmt, muss genau wissen, wozu.</span>
      </div>
      <div className="field ne-label">
        <label htmlFor={`label-${node.id}`}>Stichwort für die Übersicht</label>
        <input id={`label-${node.id}`} name="label" className="input" defaultValue={node.label} maxLength={60} required />
      </div>

      {isRoot ? null : (
        <fieldset className="plain ne-typ">
          <legend>Art der Aussage</legend>
          <div className="seg">
            {(Object.keys(TYP) as (keyof typeof TYP)[])
              .filter((k) => !isPremise || k !== "verfahren")
              .map((k) => (
                <label key={k} title={TYP[k].text}>
                  <input type="radio" name="typ" value={k} defaultChecked={node.typ === k} required />
                  <span>{TYP[k].label}</span>
                </label>
              ))}
          </div>
        </fieldset>
      )}

      {isRoot ? null : (
        <div className="ne-grid">
          <div className="field">
            <label htmlFor={`schritt-${node.id}`}>Schritt der Begründung</label>
            <select id={`schritt-${node.id}`} name="schritt" className="select" value={schritt} onChange={(e) => setSchritt(e.target.value as typeof schritt)}>
              {STEPS.map((s, i) => (
                <option key={s.key} value={s.key}>
                  {i + 1}. {s.label}
                </option>
              ))}
            </select>
          </div>
          {isPremise ? null : (
            <>
              <fieldset className="plain">
                <legend>Richtung</legend>
                <div className="seg">
                  <label>
                    <input type="radio" name="richtung" value="stuetzt" checked={richtung === "stuetzt"} onChange={() => setRichtung("stuetzt")} />
                    <span>stützt den Schritt</span>
                  </label>
                  <label>
                    <input type="radio" name="richtung" value="greift_an" checked={richtung === "greift_an"} onChange={() => setRichtung("greift_an")} />
                    <span>greift ihn an</span>
                  </label>
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor={`frage-${node.id}`}>Prüffrage</label>
                <select id={`frage-${node.id}`} name="frage" className="select" value={frageOk} onChange={(e) => setFrage(e.target.value as typeof frage)}>
                  {questions.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
              {richtung === "greift_an" ? (
                <div className="field">
                  <label htmlFor={`einwand-${node.id}`}>Der Einwand, wie er erhoben wird</label>
                  <input id={`einwand-${node.id}`} name="einwand" className="input" defaultValue={node.einwand ?? ""} placeholder="Das Handwerk schafft die Menge nicht." />
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      <div className="form-foot">
        <button type="submit" className="btn">
          {submitLabel}
        </button>
        {hint ? <span className="small muted">{hint}</span> : null}
      </div>
    </form>
  );
}
