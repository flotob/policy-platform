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
          <Link href="/verwaltung" className="wordmark">
            <span className="wordmark-mark" aria-hidden>
              <i className="ga" />
              <i className="gb" />
            </span>
            Landkarte des Streits
          </Link>
          <span className="ws-tenant">{staff.tenant.name}</span>
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
      <main className="wrap ws-main">{children}</main>
    </>
  );
}
