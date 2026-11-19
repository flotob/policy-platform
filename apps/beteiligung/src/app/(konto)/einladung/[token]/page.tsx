import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { readInvite, ROLE_LABEL, ROLE_TEXT } from "@/lib/team";

import { InviteForm } from "../../AccountForms";
import "../../konto.css";

export const metadata = { title: "Einladung" };

export default async function Einladung({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await readInvite(token);
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        {inv.state === "offen" ? (
          <>
            <div className="acc-text">
              <h1>Einladung von {inv.tenantName}</h1>
              <p>
                Sie arbeiten im Team von {inv.tenantName} mit. Ihre Rolle: {ROLE_LABEL[inv.role]} ({ROLE_TEXT[inv.role]}).
              </p>
            </div>
            <div className="acc-side">
              <InviteForm token={token} email={inv.email} hasAccount={inv.hasAccount} />
            </div>
          </>
        ) : (
          <div className="acc-text">
            <h1>{inv.state === "angenommen" ? "Einladung schon angenommen" : "Einladung gilt nicht mehr"}</h1>
            <p>
              {inv.state === "angenommen" ? (
                <>
                  Diese Einladung wurde schon angenommen. <Link href="/anmelden">Zur Anmeldung</Link>
                </>
              ) : inv.state === "abgelaufen" ? (
                "Der Link ist abgelaufen. Bitten Sie die Person, die Sie eingeladen hat, Ihnen die Einladung noch einmal zu schicken."
              ) : (
                "Diesen Link kennen wir nicht, oder die Einladung wurde zurückgezogen. Bitten Sie um eine neue."
              )}
            </p>
          </div>
        )}
      </main>
    </>
  );
}
