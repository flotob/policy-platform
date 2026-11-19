"use client";

import { useActionState } from "react";

import type { ActionState } from "./actions";
import { saveKommune, uploadLogo } from "./einstellungen-actions";
import { Status } from "./forms";

type Values = { name: string; stelle: string; email: string; telefon: string; website: string; impressum: string; datenschutz: string };

export function KommuneForm({ initial, slug }: { initial: Values; slug: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveKommune, {});
  const v = { ...initial, ...(state.values ?? {}) } as Values;
  return (
    <form action={action} className="team-invite">
      <div className="field">
        <label htmlFor="k-name">Name der Kommune</label>
        <input id="k-name" name="name" className="input" required defaultValue={v.name} />
        <span className="hint">So steht sie über jedem Verfahren. Die Adresse bleibt streit.bar/{slug}.</span>
      </div>
      <fieldset className="field team-roles">
        <legend className="label">Ansprechpartner für Bürgerinnen und Bürger</legend>
        <div className="field-row">
          <div className="field">
            <label htmlFor="k-stelle">Stelle oder Name</label>
            <input id="k-stelle" name="stelle" className="input" defaultValue={v.stelle} placeholder="Bürgerbüro, Amt für Stadtentwicklung" />
          </div>
          <div className="field">
            <label htmlFor="k-email">E-Mail</label>
            <input id="k-email" name="email" type="email" className="input" defaultValue={v.email} placeholder="beteiligung@kommune.de" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="k-tel">Telefon</label>
          <input id="k-tel" name="telefon" className="input" defaultValue={v.telefon} />
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="k-web">Website der Kommune</label>
        <input id="k-web" name="website" className="input" defaultValue={v.website} placeholder="https://www.kommune.de" />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="k-imp">Link zu Ihrem Impressum</label>
          <input id="k-imp" name="impressum" className="input" defaultValue={v.impressum} placeholder="https://www.kommune.de/impressum" />
        </div>
        <div className="field">
          <label htmlFor="k-ds">Link zu Ihrer Datenschutzerklärung</label>
          <input id="k-ds" name="datenschutz" className="input" defaultValue={v.datenschutz} placeholder="https://www.kommune.de/datenschutz" />
        </div>
      </div>
      <p className="hint">Für die Daten Ihrer Verfahren ist Ihre Kommune verantwortlich. Beides steht unten auf jeder Seite Ihrer Beteiligungen.</p>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Speichern
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function LogoForm({ logo }: { logo: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadLogo, {});
  return (
    <form action={action} className="team-invite logo-form">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="Ihr Logo" className="logo-preview" />
      ) : (
        <p className="muted small">Noch kein Logo.</p>
      )}
      <div className="field">
        <label htmlFor="k-logo">{logo ? "Anderes Logo" : "Logo hochladen"}</label>
        <input id="k-logo" name="logo" type="file" className="input file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
        <span className="hint">PNG, JPG, WebP oder SVG, bis 500 KB. Es steht klein neben dem Namen der Kommune.</span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          Hochladen
        </button>
        {logo ? (
          <button type="submit" name="entfernen" value="1" className="btn btn-quiet btn-small" disabled={pending}>
            Logo entfernen
          </button>
        ) : null}
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}
