import { kommuneById, LINKS_MAX } from "@/lib/kommune";
import { appUrl } from "@/lib/mail";
import { requireStaff } from "@/lib/session";

import { ImageForm, KommuneForm, LogoForm, ProfilForm, PublicAddress } from "../einstellungen-forms";

export const metadata = { title: "Einstellungen" };

export default async function Einstellungen() {
  const staff = await requireStaff();
  const k = (await kommuneById(staff.tenant.id))!;
  const s = k.settings;
  const manage = staff.role === "initiator";
  const url = appUrl(`/${k.slug}`);
  return (
    <div className="ws-narrow team">
      <div className="ws-title">
        <div>
          <h1>Einstellungen</h1>
          <p className="muted">Was Bürgerinnen und Bürger auf den Seiten von {k.name} sehen.</p>
        </div>
      </div>
      <PublicAddress url={url} path={`/${k.slug}`} display={url.replace(/^https?:\/\//, "")} qr={`/api/qr/${k.slug}`} />
      {manage ? (
        <>
          <section className="team-section">
            <h2>Titelbild</h2>
            <p className="muted">Das große Bild oben auf Ihrer öffentlichen Seite.</p>
            <ImageForm kind="titelbild" url={k.titelbild} credit={s.titelbild.credit} alt={s.titelbild.alt} />
          </section>
          <section className="team-section">
            <h2>Logo oder Wappen</h2>
            <LogoForm logo={k.logo} />
          </section>
          <section className="team-section">
            <h2>So stellt sich die Kommune vor</h2>
            <p className="muted">Ein Satz unter dem Namen, ein Wort vorab, Ihre Links. Alles ist freiwillig; was leer bleibt, erscheint nicht.</p>
            <ProfilForm
              max={LINKS_MAX}
              initial={{ claim: s.claim, gruss_text: s.gruss.text, gruss_name: s.gruss.name, gruss_amt: s.gruss.amt, links: s.links }}
            />
            <ImageForm kind="portrait" url={k.portrait} />
          </section>
          <section className="team-section">
            <h2>Kontakt und Rechtliches</h2>
            <KommuneForm
              slug={k.slug}
              initial={{
                name: k.name,
                stelle: s.kontakt.stelle,
                email: s.kontakt.email,
                telefon: s.kontakt.telefon,
                zeiten: s.kontakt.zeiten,
                website: s.website,
                impressum: s.impressum,
                datenschutz: s.datenschutz,
              }}
            />
          </section>
        </>
      ) : (
        <dl className="kv">
          <dt>Ansprechpartner</dt>
          <dd>{[s.kontakt.stelle, s.kontakt.email, s.kontakt.telefon, s.kontakt.zeiten].filter(Boolean).join(", ") || "nicht angegeben"}</dd>
          <dt>Website</dt>
          <dd>{s.website || "nicht angegeben"}</dd>
          <dt>Impressum</dt>
          <dd>{s.impressum || "nicht angegeben"}</dd>
          <dt>Datenschutz</dt>
          <dd>{s.datenschutz || "nicht angegeben"}</dd>
          <dd className="muted small">Ändern können das Initiatorinnen und Initiatoren Ihrer Kommune.</dd>
        </dl>
      )}
    </div>
  );
}
