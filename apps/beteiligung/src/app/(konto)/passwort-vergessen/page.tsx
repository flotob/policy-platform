import { SiteHeader } from "@/components/SiteHeader";

import { ResetRequestForm } from "../AccountForms";
import "../konto.css";

export const metadata = { title: "Passwort vergessen" };

export default async function PasswortVergessen({ searchParams }: { searchParams: Promise<{ gesendet?: string }> }) {
  const { gesendet } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">
          <h1>Passwort vergessen</h1>
          <p>Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort festlegen. Er gilt eine Stunde.</p>
        </div>
        <div className="acc-side">
          {gesendet ? (
            <div className="acc-form">
              <p>
                Wenn es zu dieser Adresse ein Konto gibt, ist die E-Mail unterwegs. Schauen Sie in den nächsten Minuten in Ihr Postfach, auch in den
                Spam-Ordner.
              </p>
            </div>
          ) : (
            <ResetRequestForm />
          )}
        </div>
      </main>
    </>
  );
}
