import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { readConfirmation } from "@/lib/bestaetigen";
import { getSession } from "@/lib/session";

import { confirmMyAddress } from "../actions";
import "../konto.css";

export const metadata = { title: "Adresse bestätigen" };

/** The link from the sign-up mail: one button confirms the address (mail scanners open links, they press no buttons). */
export default async function AdresseBestaetigen({ searchParams }: { searchParams: Promise<{ u?: string; z?: string; t?: string }> }) {
  const { u = "", z = "", t = "" } = await searchParams;
  const [state, session] = await Promise.all([readConfirmation(u, z, t), getSession()]);
  const mine = session?.user.id === u;
  const next = mine ? (
    <Link href="/verwaltung" className="btn">
      Zur Verwaltung
    </Link>
  ) : (
    <Link href="/anmelden" className="btn">
      Anmelden
    </Link>
  );
  let text;
  let side;
  if (state.kind === "ungueltig") {
    text = (
      <>
        <h1>Dieser Link ist ungültig</h1>
        <p>Vielleicht ist er unvollständig angekommen. Kopieren Sie ihn bitte ganz aus der E-Mail in die Adresszeile.</p>
        <p>Angemeldet können Sie oben in der Verwaltung jederzeit eine neue Mail anfordern.</p>
      </>
    );
    side = next;
  } else if (state.kind === "abgelaufen") {
    text = (
      <>
        <h1>Dieser Link ist abgelaufen</h1>
        <p>Er galt sieben Tage. Melden Sie sich an; oben in der Verwaltung können Sie eine neue Mail anfordern.</p>
      </>
    );
    side = next;
  } else if (state.kind === "erledigt") {
    text = (
      <>
        <h1>Danke, Ihre Adresse ist bestätigt</h1>
        <p>Sie können jetzt Beteiligungen freischalten und Ihr Team einladen.</p>
      </>
    );
    side = next;
  } else {
    text = (
      <>
        <h1>Adresse bestätigen</h1>
        <p>Bestätigen Sie, dass {state.email} Ihre Adresse ist. Danach können Sie Beteiligungen freischalten und Ihr Team einladen.</p>
      </>
    );
    side = (
      <form action={confirmMyAddress.bind(null, u, z, t)} className="acc-form">
        <button type="submit" className="btn">
          Ja, das ist meine Adresse
        </button>
      </form>
    );
  }
  return (
    <>
      <SiteHeader />
      <main className="wrap acc">
        <div className="acc-text">{text}</div>
        <div className="acc-side">{side}</div>
      </main>
    </>
  );
}
