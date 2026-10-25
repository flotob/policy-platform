import Link from "next/link";
import type { ReactNode } from "react";

/** Every citizen page: the way back to the start page, where you are (town / campaign), the page, a quiet footer. */
export function PublicFrame({
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
            {town.name}
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
        <div className="wrap small muted">
          Eine Beteiligung mit der <Link href="/">Landkarte des Streits</Link>. Ohne Anmeldung; deine Stimmen bleiben anonym.
        </div>
      </footer>
    </div>
  );
}
