"use client";

import { useActionState, useState } from "react";

import type { ActionState } from "./actions";
import { saveKommune, saveProfil, uploadLogo, uploadPortrait, uploadTitelbild } from "./einstellungen-actions";
import { Status } from "./forms";

type Values = { name: string; stelle: string; email: string; telefon: string; zeiten: string; website: string; impressum: string; datenschutz: string };

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
        <div className="field-row">
          <div className="field">
            <label htmlFor="k-tel">Telefon</label>
            <input id="k-tel" name="telefon" className="input" defaultValue={v.telefon} />
          </div>
          <div className="field">
            <label htmlFor="k-zeiten">Erreichbar</label>
            <input id="k-zeiten" name="zeiten" className="input" maxLength={80} defaultValue={v.zeiten} placeholder="Mo bis Fr, 8 bis 12 Uhr" />
          </div>
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="k-web">Website der Kommune</label>
        <input id="k-web" name="website" className="input" defaultValue={v.website} placeholder="https://www.kommune.de" />
        <span className="hint">Steht auf Ihrer öffentlichen Seite als erster Link.</span>
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

type ProfilValues = { claim: string; gruss_text: string; gruss_name: string; gruss_amt: string; links: { label: string; url: string }[] };

/** One line under the name, the greeting, the links: what makes the public page the town's own. */
export function ProfilForm({ initial, max }: { initial: ProfilValues; max: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProfil, {});
  const sent = state.values;
  const v = (k: keyof Omit<ProfilValues, "links">) => sent?.[k] ?? initial[k];
  const link = (i: number, k: "label" | "url") => sent?.[`link_${k}_${i}`] ?? initial.links[i]?.[k] ?? "";
  const filled = Array.from({ length: max }, (_, i) => Boolean(link(i, "label") || link(i, "url"))).lastIndexOf(true) + 1;
  const [rows, setRows] = useState(Math.min(max, Math.max(filled + 1, 2)));
  const [claim, setClaim] = useState(v("claim"));
  return (
    <form action={action} className="team-invite">
      <div className="field">
        <label htmlFor="p-claim">Ein Satz unter dem Namen</label>
        <input
          id="p-claim"
          name="claim"
          className="input"
          maxLength={90}
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Bevor der Stadtrat entscheidet, fragen wir Sie."
        />
        <span className="hint">Höchstens 90 Zeichen{claim ? `, noch ${90 - [...claim].length} frei` : ""}.</span>
      </div>
      <div className="field">
        <label htmlFor="p-gruss">Ein Wort vorab</label>
        <textarea id="p-gruss" name="gruss_text" className="input" rows={4} maxLength={400} defaultValue={v("gruss_text")} />
        <span className="hint">Höchstens 400 Zeichen. Leer lassen, wenn Sie keine Begrüßung zeigen wollen.</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="p-name">Wer spricht?</label>
          <input id="p-name" name="gruss_name" className="input" maxLength={80} defaultValue={v("gruss_name")} />
        </div>
        <div className="field">
          <label htmlFor="p-amt">Funktion</label>
          <input id="p-amt" name="gruss_amt" className="input" maxLength={80} defaultValue={v("gruss_amt")} placeholder="Bürgermeisterin" />
        </div>
      </div>
      <fieldset className="field">
        <legend className="label">Links</legend>
        <span className="hint">Bis zu {max} Links neben dem Namen der Stadt, etwa Amtsblatt, Instagram oder Mastodon. Bekannte Adressen bekommen ihr Zeichen von selbst.</span>
        <div className="link-rows">
          {Array.from({ length: max }, (_, i) => (
            <div key={i} className="link-row" hidden={i >= rows}>
              <input name={`link_label_${i}`} className="input" aria-label={`Link ${i + 1}: Bezeichnung`} maxLength={40} defaultValue={link(i, "label")} placeholder="Bezeichnung" />
              <input name={`link_url_${i}`} className="input" aria-label={`Link ${i + 1}: Adresse`} defaultValue={link(i, "url")} placeholder="https://" />
            </div>
          ))}
        </div>
        {rows < max ? (
          <button type="button" className="btn btn-quiet btn-small link-add" onClick={() => setRows((r) => Math.min(max, r + 1))}>
            Link hinzufügen
          </button>
        ) : null}
        <span className="hint">Einen Link entfernen Sie, indem Sie beide Felder leeren.</span>
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

/** Title photo (with credit and description) or the greeting's portrait. */
export function ImageForm({ kind, url, credit, alt }: { kind: "titelbild" | "portrait"; url: string | null; credit?: string; alt?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(kind === "titelbild" ? uploadTitelbild : uploadPortrait, {});
  const title = kind === "titelbild";
  const v = (k: "credit" | "alt", d = "") => state.values?.[k] ?? d;
  return (
    <form action={action} className={`team-invite image-form image-form-${kind}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title ? "Ihr Titelbild" : "Ihr Foto"} className="image-preview" />
      ) : (
        <p className="muted small">{title ? "Noch kein Titelbild. Ohne Bild zeigt die Seite eine ruhige Fläche." : "Noch kein Foto. Ohne Foto stehen dort die Anfangsbuchstaben."}</p>
      )}
      <div className="field">
        <label htmlFor={`b-${kind}`}>{url ? (title ? "Anderes Titelbild" : "Anderes Foto") : title ? "Titelbild hochladen" : "Foto hochladen"}</label>
        <input id={`b-${kind}`} name="bild" type="file" className="input file-input" accept="image/jpeg,image/png,image/webp" />
        <span className="hint">
          {title
            ? "Ein Foto aus Ihrer Stadt im Querformat, am besten 2400 × 750 Pixel. JPG, PNG oder WebP, bis 5 MB."
            : "Ein Porträt, am besten quadratisch. JPG, PNG oder WebP, bis 1 MB."}
        </span>
      </div>
      {title ? (
        <div className="field-row">
          <div className="field">
            <label htmlFor="b-credit">Bildnachweis</label>
            <input id="b-credit" name="credit" className="input" maxLength={80} defaultValue={v("credit", credit)} placeholder="Stadt Musterstadt" />
          </div>
          <div className="field">
            <label htmlFor="b-alt">Was ist auf dem Bild zu sehen?</label>
            <input id="b-alt" name="alt" className="input" maxLength={200} defaultValue={v("alt", alt)} placeholder="Der Marktplatz mit Rathaus" />
            <span className="hint">Für Menschen, die das Bild nicht sehen können. Ihr Bildschirmleser liest diesen Satz vor.</span>
          </div>
        </div>
      ) : null}
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          {title && url ? "Speichern" : "Hochladen"}
        </button>
        {url ? (
          <button type="submit" name="entfernen" value="1" className="btn btn-quiet btn-small" disabled={pending}>
            {title ? "Titelbild entfernen" : "Foto entfernen"}
          </button>
        ) : null}
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
        <span className="hint">PNG, JPG, WebP oder SVG, bis 500 KB. Am besten quadratisch: Es steht groß auf Ihrer öffentlichen Seite und klein über jedem Verfahren.</span>
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

/** The town's public address, to put on its website, in the Amtsblatt, on posters. */
export function PublicAddress({ url, path, display, qr }: { url: string; path: string; display: string; qr: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="public-address" aria-labelledby="pa-h">
      <h2 id="pa-h">Ihre öffentliche Seite</h2>
      <p className="public-address-url">{display}</p>
      <p className="small">Diese Adresse gehört auf Ihre Website, ins Amtsblatt und auf Plakate. Dort finden Bürgerinnen und Bürger alle Beteiligungen Ihrer Kommune.</p>
      <div className="public-address-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            });
          }}
        >
          {copied ? "Kopiert" : "Adresse kopieren"}
        </button>
        <a href={path} className="btn btn-quiet btn-small" target="_blank" rel="noreferrer">
          Seite ansehen
        </a>
        <a href={qr} className="btn btn-quiet btn-small" download>
          QR-Code für Plakate
        </a>
      </div>
    </section>
  );
}
