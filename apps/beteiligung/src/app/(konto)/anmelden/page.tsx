import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { getSession, getStaff } from "@/lib/session";

import { LoginForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Anmelden" };

export default async function Anmelden() {
  if (await getStaff()) redirect("/verwaltung");
  // Logged in, but no municipality yet: finish the registration.
  if (await getSession()) redirect("/registrieren");
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">
          <h1>Anmelden</h1>
          <p>Für Mitarbeiterinnen und Mitarbeiter von Kommunen, die Verfahren anlegen und betreuen. Bürgerinnen und Bürger brauchen kein Konto.</p>
        </div>
        <LoginForm />
      </main>
    </>
  );
}
