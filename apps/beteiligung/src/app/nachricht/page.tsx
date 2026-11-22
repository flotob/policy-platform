import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { checkSignature, followerById } from "@/lib/folgen";

import { answer } from "./actions";

export const metadata = { title: "Nachricht zur Beteiligung" };

/** The two links in our mails: confirm the address, or stop the messages. One button each. */
export default async function Nachricht({ searchParams }: { searchParams: Promise<{ id?: string; a?: string; t?: string; fertig?: string; fehler?: string }> }) {
  const { id = "", a, t = "", fertig, fehler } = await searchParams;
  const purpose = a === "abmelden" ? "abmelden" : "bestaetigen";
  const valid = !fehler && checkSignature(id, purpose, t);
  const f = valid ? await followerById(id) : null;
  let body;
  if (!f) {
    body = (
      <>
        <h1>Dieser Link ist ungültig</h1>
        <p>Vielleicht ist er unvollständig angekommen. Kopieren Sie ihn bitte ganz aus der E-Mail in die Adresszeile.</p>
      </>
    );
  } else if (purpose === "abmelden") {
    body =
      fertig || f.unsubscribed ? (
        <>
          <h1>Sie sind abgemeldet</h1>
          <p>Zu „{f.campaign.title}“ bekommen Sie keine Nachrichten mehr. Ihre Adresse haben wir gelöscht.</p>
          <p>
            <Link href={f.campaign.url}>Zur Beteiligung</Link>
          </p>
        </>
      ) : (
        <>
          <h1>Keine Nachrichten mehr?</h1>
          <p>Zu „{f.campaign.title}“ schreiben wir Ihnen dann nicht mehr, und Ihre Adresse wird gelöscht.</p>
          <form action={answer.bind(null, f.id, "abmelden", t)} className="nachricht-form">
            <button type="submit" className="btn">
              Abmelden
            </button>
          </form>
        </>
      );
  } else if (f.expired) {
    body = (
      <>
        <h1>Dieser Link ist abgelaufen</h1>
        <p>Die Bestätigung gilt sieben Tage. Tragen Sie Ihre Adresse bei „{f.campaign.title}“ einfach noch einmal ein, dann bekommen Sie einen neuen Link.</p>
        <p>
          <Link href={f.campaign.url}>Zur Beteiligung</Link>
        </p>
      </>
    );
  } else {
    body =
      fertig || f.confirmed ? (
        <>
          <h1>Danke, bestätigt</h1>
          <p>
            Wir schreiben Ihnen, wenn das Ergebnis von „{f.campaign.title}“ da ist und wenn der Gemeinderat entschieden hat. Mehr nicht. Jede Nachricht hat
            einen Link zum Abmelden.
          </p>
          <p>
            <Link href={f.campaign.url}>Zur Beteiligung</Link>
          </p>
        </>
      ) : (
        <>
          <h1>Adresse bestätigen</h1>
          <p>
            Sie bekommen höchstens zwei Nachrichten zu „{f.campaign.title}“: wenn das Ergebnis da ist und wenn der Gemeinderat entschieden hat.
          </p>
          <form action={answer.bind(null, f.id, "bestaetigen", t)} className="nachricht-form">
            <button type="submit" className="btn">
              Ja, ich möchte die Nachrichten
            </button>
          </form>
        </>
      );
  }
  return (
    <>
      <SiteHeader />
      <main className="wrap legal">{body}</main>
    </>
  );
}
