"use client";

import { useActionState } from "react";

import { OUTCOMES } from "@/lib/beschluss-words";

import type { ActionState } from "./actions";
import { saveDecision } from "./beschluss-actions";
import { Status } from "./forms";

export interface DecisionItem {
  id: string;
  nr: number;
  text: string;
  label: string;
  outcome: string;
  reason: string;
}

/**
 * The town's note on the council's decision: the meeting, what was decided, and per statement how
 * it was handled (Stephan's closed list) with one sentence. Minutes per statement, not days: the
 * map has sorted them already.
 */
export function DecisionForm({
  id,
  head,
  groups,
  canPublish,
  canEdit,
  published,
}: {
  id: string;
  head: { gremium: string; datum: string; summary: string };
  groups: { title: string; hint: string; items: DecisionItem[] }[];
  canPublish: boolean;
  /** Viewers see the form, but cannot save. */
  canEdit: boolean;
  published: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveDecision.bind(null, id),
    {},
  );
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  return (
    <form action={action} className="bs-form">
      <fieldset disabled={!canEdit} className="bs-fields">
        <div className="bs-head">
          <div className="field">
            <label htmlFor="gremium">Gremium</label>
            <input
              id="gremium"
              name="gremium"
              className="input"
              defaultValue={v("gremium", head.gremium)}
              maxLength={80}
            />
          </div>
          <div className="field">
            <label htmlFor="datum">Sitzung am</label>
            <input
              id="datum"
              name="datum"
              type="date"
              className="input"
              defaultValue={v("datum", head.datum)}
            />
          </div>
          <div className="field bs-summary">
            <label htmlFor="summary">Was beschlossen wurde</label>
            <textarea
              id="summary"
              name="summary"
              className="textarea"
              rows={3}
              maxLength={800}
              defaultValue={v("summary", head.summary)}
              placeholder="Zum Beispiel: Der Gemeinderat hat die Solarpflicht für Neubauten ab 2028 beschlossen, mit einer Härtefallklausel für kleine Bauvorhaben."
            />
            <span className="hint">
              Zwei, drei Sätze. Er steht auf der Seite der Beteiligung und in
              der Nachricht an alle, die darum gebeten haben.
            </span>
          </div>
        </div>
        {groups.map((g) => (
          <section key={g.title} className="bs-group">
            <h3>{g.title}</h3>
            <p className="small muted">{g.hint}</p>
            {g.items.map((x) => (
              <div key={x.id} className="bs-row">
                <p className="bs-text">
                  <span className="bs-nr num">{x.nr}</span>
                  {x.text}
                  <span className="bs-cat">{x.label}</span>
                </p>
                <select
                  name={`o_${x.id}`}
                  className="input bs-select"
                  defaultValue={v(`o_${x.id}`, x.outcome)}
                  aria-label={`Behandlung der Aussage ${x.nr}`}
                >
                  <option value="">Nicht vermerkt</option>
                  {OUTCOMES.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  name={`r_${x.id}`}
                  className="input bs-reason"
                  maxLength={300}
                  defaultValue={v(`r_${x.id}`, x.reason)}
                  placeholder="Ein Satz: wie, oder warum nicht"
                  aria-label={`Begründung zur Aussage ${x.nr}`}
                />
              </div>
            ))}
          </section>
        ))}
      </fieldset>
      {canEdit ? (
        <div className="form-foot bs-foot">
          <button
            type="submit"
            name="publish"
            value="0"
            className={canPublish && !published ? "btn btn-quiet" : "btn"}
            disabled={pending}
          >
            {published ? "Änderungen speichern" : "Als Entwurf speichern"}
          </button>
          {canPublish && !published ? (
            <button
              type="submit"
              name="publish"
              value="1"
              className="btn"
              disabled={pending}
            >
              Veröffentlichen
            </button>
          ) : null}
          <Status state={state} pending={pending} />
        </div>
      ) : null}
    </form>
  );
}
