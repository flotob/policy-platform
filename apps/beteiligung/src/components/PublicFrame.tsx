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
  const contact = s ? [s.kontakt.stelle, s.kontakt.telefon].filter(Boolean).join(", ") : "";
  return (
    <div className="pub">
      <header className="pub-head wrap">
        <Link href="/" className="wordmark pub-mark" title="Zur Startseite">
          <span className="wordmark-mark" aria-hidden>
            <i className="ga" />
            <i className="gb" />
          </span>
          Landkarte des Streits
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
      <footer className="site-foot">
        <div className="wrap small muted pub-foot">
          {s && (contact || s.kontakt.email || s.website) ? (
            <p>
              Fragen zur Beteiligung: {contact}
              {contact && s.kontakt.email ? ", " : ""}
              {s.kontakt.email ? <a href={`mailto:${s.kontakt.email}`}>{s.kontakt.email}</a> : null}
              {s.website ? (
                <>
                  {" · "}
                  <a href={s.website} rel="noopener">
                    Website von {k?.name ?? town.name}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {s?.impressum || s?.datenschutz ? (
            <p>
              {k?.name ?? town.name}:{" "}
              {s.impressum ? (
                <a href={s.impressum} rel="noopener">
                  Impressum
                </a>
              ) : null}
              {s.impressum && s.datenschutz ? " · " : null}
              {s.datenschutz ? (
                <a href={s.datenschutz} rel="noopener">
                  Datenschutz
                </a>
              ) : null}
            </p>
          ) : null}
          <p>
            Eine Beteiligung mit der <Link href="/">Landkarte des Streits</Link> auf streit.bar. Ohne Anmeldung; deine Stimmen bleiben anonym.
          </p>
        </div>
      </footer>
    </div>
  );
}
