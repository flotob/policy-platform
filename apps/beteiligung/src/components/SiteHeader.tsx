import Link from "next/link";

import { getStaff } from "@/lib/session";

/** Public header: the product, the way in for municipalities. */
export async function SiteHeader() {
  const staff = await getStaff();
  return (
    <header className="site-head">
      <div className="wrap site-head-in">
        <Link href="/" className="wordmark">
          <span className="wordmark-mark" aria-hidden>
            <i className="ga" />
            <i className="gb" />
          </span>
          Landkarte des Streits
        </Link>
        <nav className="site-nav" aria-label="Hauptnavigation">
          <Link href="/#ablauf">So funktioniert es</Link>
          <Link href="/musterstadt/solarpflicht">Beispiel</Link>
          {staff ? (
            <Link href="/verwaltung" className="btn btn-small">
              Zur Verwaltung
            </Link>
          ) : (
            <>
              <Link href="/anmelden">Anmelden</Link>
              <Link href="/registrieren" className="btn btn-small">
                Verfahren anlegen
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
