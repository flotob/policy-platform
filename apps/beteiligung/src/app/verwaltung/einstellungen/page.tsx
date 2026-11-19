import { kommuneById } from "@/lib/kommune";
import { requireStaff } from "@/lib/session";

import { KommuneForm, LogoForm } from "../einstellungen-forms";

export const metadata = { title: "Einstellungen" };

export default async function Einstellungen() {
  const staff = await requireStaff();
  const k = (await kommuneById(staff.tenant.id))!;
  const s = k.settings;
  const manage = staff.role === "initiator";
  return (
    <div className="ws-narrow team">
      <div className="ws-title">
        <div>
          <h1>Einstellungen</h1>
          <p className="muted">Was Bürgerinnen und Bürger auf den Seiten von {k.name} sehen.</p>
        </div>
      </div>
      {manage ? (
        <>
          <KommuneForm
            slug={k.slug}
            initial={{ name: k.name, stelle: s.kontakt.stelle, email: s.kontakt.email, telefon: s.kontakt.telefon, website: s.website, impressum: s.impressum, datenschutz: s.datenschutz }}
          />
          <section className="team-section">
            <h2>Logo</h2>
            <LogoForm logo={k.logo} />
          </section>
        </>
      ) : (
        <dl className="kv">
          <dt>Ansprechpartner</dt>
          <dd>{[s.kontakt.stelle, s.kontakt.email, s.kontakt.telefon].filter(Boolean).join(" · ") || "nicht angegeben"}</dd>
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
