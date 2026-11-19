import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { demoLogin } from "@/lib/demo-login";
import { getSession, getStaff } from "@/lib/session";
import { signupMode } from "@/lib/signup";

import { loginDemo } from "../actions";
import { LoginForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Anmelden" };

export default async function Anmelden({ searchParams }: { searchParams: Promise<{ passwort?: string; einladung?: string; hinweis?: string }> }) {
  const q = await searchParams;
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
          {q.passwort === "neu" ? <p className="notice">Ihr neues Passwort gilt. Melden Sie sich damit an.</p> : null}
          {q.hinweis === "beispiel" ? <p className="notice">Das Beispiel ist gerade nicht erreichbar. Bitte versuchen Sie es in ein paar Minuten noch einmal.</p> : null}
          {q.einladung === "angenommen" ? (
            <p className="notice">Einladung angenommen. Melden Sie sich mit Ihrem bisherigen Passwort an.</p>
          ) : null}
          <LoginForm signup={signupMode() !== "closed"} />
        </div>
      </main>
    </>
  );
}
