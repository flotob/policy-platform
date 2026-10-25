import Link from "next/link";
import type { ReactNode } from "react";

/** Every citizen page of a campaign: the fiction banner where it applies, the town, the page, a quiet footer. */
export function PublicFrame({
  town,
  campaign,
  fictional,
  children,
  back,
}: {
  town: { name: string; slug: string };
  campaign?: { slug: string; title: string };
  fictional: boolean;
  children: ReactNode;
  back?: boolean;
}) {
  return (
    <div className="pub">
      {fictional ? (
        <div className="pub-fiction">
          <div className="wrap">Ein Beispiel mit erfundenen Inhalten. Musterstadt gibt es nicht.</div>
        </div>
      ) : null}
      <header className="pub-head wrap">
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
