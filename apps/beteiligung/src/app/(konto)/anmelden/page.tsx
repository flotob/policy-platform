import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { demoLogin } from "@/lib/demo-login";
import { getSession, getStaff } from "@/lib/session";

import { loginDemo } from "../actions";
import { LoginForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Anmelden" };

export default async function Anmelden() {
  if (await getStaff()) redirect("/verwaltung");
  // Logged in, but no municipality yet: finish the registration.
  if (await getSession()) redirect("/registrieren");
  const demo = demoLogin();
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">
          <h1>Anmelden</h1>
          <p>Für Mitarbeiterinnen und Mitarbeiter von Kommunen, die Verfahren anlegen und betreuen. Bürgerinnen und Bürger brauchen kein Konto.</p>
        </div>
        <div className="acc-side">
          {demo ? (
            <form action={loginDemo} className="acc-demo">
              <h2>Ohne Konto ausprobieren</h2>
              <p>
                Schauen Sie sich die Verwaltung des erfundenen Beispiels Musterstadt an: Begründung, Redaktion, Lagebild, Auswertung und Bericht. Nur
                ansehen, nichts ändern.
              </p>
              <button type="submit" className="btn">
                Beispiel ansehen
              </button>
              <p className="small muted">
                Zugang: {demo.email} · Passwort: <span className="num">{demo.password}</span>
              </p>
            </form>
          ) : null}
          <LoginForm />
        </div>
      </main>
    </>
  );
}
