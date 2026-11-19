import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Impressum" };

export default function Impressum() {
  return (
    <>
      <SiteHeader />
      <main className="wrap legal">
        <h1>Impressum</h1>
        <p>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>
        <address>
          Legal Tech Center LTC UG (haftungsbeschränkt)
          <br />
          c/o Knowledge Tools – Gesellschaft für Lern- und Wissenschaftssysteme mbH
          <br />
          Köpenicker Str. 145
          <br />
          10997 Berlin
        </address>

        <h2>Vertreten durch</h2>
        <p>Stephan Breidenbach, Geschäftsführer</p>

        <h2>Kontakt</h2>
        <p>
          E-Mail: <a href="mailto:info@streit.bar">info@streit.bar</a>
        </p>

        <h2>Registereintrag</h2>
        <p>Amtsgericht Berlin-Charlottenburg, HRB 187368 B</p>

        <h2>Umsatzsteuer-Identifikationsnummer</h2>
        <p>DE312546735 (gemäß § 27a Umsatzsteuergesetz)</p>

        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>Stephan Breidenbach, Anschrift wie oben</p>

        <h2>Inhalte der Beteiligungen</h2>
        <p>
          Für den Inhalt eines Beteiligungsverfahrens, also die Frage, die Begründung und die Unterlagen, ist die Kommune verantwortlich, die es
          durchführt. Ihr Impressum steht unten auf jeder Seite ihrer Beteiligungen. Beiträge von Bürgerinnen und Bürgern geben deren Meinung
          wieder.
        </p>
      </main>
    </>
  );
}
