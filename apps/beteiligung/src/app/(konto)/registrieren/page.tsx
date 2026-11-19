import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { getSession, getStaff } from "@/lib/session";
import { signupMode } from "@/lib/signup";

import { RegisterForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Konto anlegen" };

export default async function Registrieren() {
  if (await getStaff()) redirect("/verwaltung");
  const loggedIn = !!(await getSession());
  const mode = signupMode();
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">
          <h1>{loggedIn ? "Ihre Kommune anlegen" : "Ein Konto für Ihre Kommune"}</h1>
          <p>
            Mit dem Konto legen Sie Verfahren an: Sie stellen eine Maßnahme zur Diskussion, laden Begründung und Stellungnahmen hoch und
            schalten die Beteiligung frei, wenn alles bereit ist. Bis dahin sieht niemand außerhalb Ihrer Verwaltung etwas.
          </p>
          {mode === "code" ? (
            <p>Zum Anlegen brauchen Sie einen Einladungscode. Sie bekommen ihn von uns; er ist für alle Kommunen derselbe.</p>
          ) : null}
        </div>
        {mode !== "closed" ? (
          <RegisterForm loggedIn={loggedIn} needsCode={mode === "code"} />
        ) : (
          <div className="acc-form">
            <p className="notice">
              Neue Kommunen schalten wir derzeit auf Anfrage frei. Wenn Ihre Verwaltung schon ein Konto hat, <Link href="/anmelden">melden Sie sich an</Link>.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
