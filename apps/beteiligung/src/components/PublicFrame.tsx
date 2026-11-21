import Link from "next/link";
import type { ReactNode } from "react";

import { kommuneBySlug } from "@/lib/kommune";

/** Every citizen page: the way back to the start page, where you are (town / campaign), the page, the town's contact and legal links. */
export async function PublicFrame({
  town,
  campaign,
  children,
  back,
}: {
  town: { name: string; slug: string };
  campaign?: { slug: string; title: string };
  children: ReactNode;
  back?: boolean;
}) {
  const k = await kommuneBySlug(town.slug);
  const s = k?.settings;
  const name = k?.name ?? town.name;
  const townLinks = s
    ? [
        { label: "Website", url: s.website },
        { label: "Impressum", url: s.impressum },
        { label: "Datenschutz", url: s.datenschutz },
      ].filter((l) => l.url)
    : [];
  return (
    <div className="pub">
      <header className="pub-head wrap">
        <Link href="/" className="wordmark pub-mark" title="Zur Startseite">
          <span className="wordmark-mark" aria-hidden>
            <i className="ga" />
            <i className="gb" />
          </span>
          streit.bar
        </Link>
        <nav className="pub-crumbs" aria-label="Sie sind hier">
          <Link href={`/${town.slug}`} className="pub-town">
            {k?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={k.logo} alt="" className="pub-logo" />
            ) : null}
            {k?.name ?? town.name}
          </Link>
          {campaign && back ? (
            <>
              <span className="pub-sep" aria-hidden>
                /
              </span>
              <Link href={`/${town.slug}/${campaign.slug}`} className="pub-town">
                {campaign.title}
              </Link>
            </>
          ) : null}
        </nav>
      </header>
      {children}
      {/* One footer in three columns: the town (its own links), who answers questions, streit.bar. It replaces
          the operator's strip (LegalFooter) on these pages, so streit.bar's imprint is linked here. */}
      <footer className="site-foot pub-foot">
        <div className="wrap pub-foot-grid">
          <div>
            <p className="pub-foot-h">
              <Link href={`/${town.slug}`}>{name}</Link>
            </p>
            {townLinks.length ? (
              <ul className="pub-foot-list">
                {townLinks.map((l) => (
                  <li key={l.label}>
                    <a href={l.url} rel="noopener">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {s && (s.kontakt.stelle || s.kontakt.email || s.kontakt.telefon) ? (
            <div>
              <p className="pub-foot-h">Fragen zur Beteiligung</p>
              <ul className="pub-foot-list">
                {s.kontakt.stelle ? <li>{s.kontakt.stelle}</li> : null}
                {s.kontakt.email ? (
                  <li>
                    <a href={`mailto:${s.kontakt.email}`}>{s.kontakt.email}</a>
                  </li>
                ) : null}
                {s.kontakt.telefon ? (
                  <li>
                    <a href={`tel:${s.kontakt.telefon.replace(/[^\d+]/g, "")}`}>{s.kontakt.telefon}</a>
                  </li>
                ) : null}
                {s.kontakt.zeiten ? <li className="pub-foot-quiet">{s.kontakt.zeiten}</li> : null}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="pub-foot-h">
              <Link href="/">streit.bar</Link>
            </p>
            <ul className="pub-foot-list">
              <li className="pub-foot-quiet">Ohne Anmeldung. Deine Stimmen bleiben anonym.</li>
              <li>
                <Link href="/impressum">Impressum</Link>
              </li>
              <li>
                <Link href="/datenschutz">Datenschutz</Link>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
