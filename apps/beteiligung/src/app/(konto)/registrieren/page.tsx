import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { getSession, getStaff } from "@/lib/session";

import { RegisterForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Konto anlegen" };

export default async function Registrieren() {
  if (await getStaff()) redirect("/verwaltung");
  const loggedIn = !!(await getSession());
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
        </div>
        <RegisterForm loggedIn={loggedIn} />
      </main>
    </>
  );
}
