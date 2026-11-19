import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

import { ResetForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Neues Passwort" };

export default async function PasswortNeu({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">
          <h1>Neues Passwort</h1>
          <p>Danach melden Sie sich mit dem neuen Passwort an. Auf anderen Geräten werden Sie abgemeldet.</p>
        </div>
        <div className="acc-side">
          {token ? (
            <ResetForm token={token} />
          ) : (
            <div className="acc-form">
              <p>
                Dieser Link ist unvollständig. <Link href="/passwort-vergessen">Fordern Sie einen neuen an.</Link>
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
