import Link from "next/link";
import type { ReactNode } from "react";

import { requireStaff } from "@/lib/session";

import { logout } from "../(konto)/actions";
import "./verwaltung.css";

/** The municipality's workspace: who is logged in, for which municipality. */
export default async function VerwaltungLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  return (
    <>
      <header className="ws-head">
        <div className="wrap ws-head-in">
          <Link href="/" className="wordmark" title="Zur Startseite">
            <span className="wordmark-mark" aria-hidden>
              <i className="ga" />
              <i className="gb" />
            </span>
            Landkarte des Streits
          </Link>
          <Link href="/verwaltung" className="ws-tenant" title="Ihre Verfahren">
            {staff.tenant.name}
          </Link>
          <div className="ws-user">
            <span className="muted small">{staff.user.name}</span>
            <form action={logout}>
              <button type="submit" className="btn btn-quiet btn-small">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      {staff.role === "betrachter" ? (
        <div className="ws-viewer">
          <div className="wrap small">
            Sie sehen sich die Verwaltung von {staff.tenant.name} nur an. Ändern, freigeben und hochladen können hier nur Verwaltung und Redaktion.
          </div>
        </div>
      ) : null}
      <main className="wrap ws-main">{children}</main>
    </>
  );
}
