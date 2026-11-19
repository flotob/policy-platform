import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Datenschutz" };

export default function Datenschutz() {
  return (
    <>
      <SiteHeader />
      <main className="wrap legal">
        <h1>Datenschutz</h1>
        <p>
          Hier steht, welche Daten streit.bar verarbeitet, wozu und an wen sie gehen. Wir erheben so wenig wie möglich: Wer sich beteiligt, braucht kein
          Konto und gibt keinen Namen an.
        </p>

        <h2>Wer verantwortlich ist</h2>
        <p>
          Für die Website streit.bar und die Konten der Verwaltungen: Legal Tech Center LTC UG (haftungsbeschränkt), Köpenicker Str. 145, 10997 Berlin,{" "}
          <a href="mailto:info@streit.bar">info@streit.bar</a>. Weitere Angaben im <Link href="/impressum">Impressum</Link>.
        </p>
        <p>
          Für die Daten eines Beteiligungsverfahrens ist die Kommune verantwortlich, die es durchführt. Wir verarbeiten sie in ihrem Auftrag. Die
          Datenschutzerklärung der Kommune ist unten auf den Seiten ihrer Beteiligungen verlinkt.
        </p>

        <h2>Wenn Sie sich beteiligen</h2>
        <ul>
          <li>
            Ein Cookie mit einer zufälligen Kennung für das jeweilige Verfahren. Damit zählt Ihre Stimme einmal und Sie können später nachsehen, was
            aus Ihrem Beitrag geworden ist. Es enthält keinen Namen.
          </li>
          <li>Ihre Stimmen zu den Aussagen und, wenn Sie welche schicken, Ihre Texte und Dateien.</li>
          <li>
            Ihre IP-Adresse nur als nicht umkehrbare Prüfsumme, um Missbrauch zu begrenzen (zu viele Teilnahmen von einem Anschluss). Die Adresse
            selbst speichern wir in der Anwendung nicht.
          </li>
          <li>
            Wenn Sie mit einem Code aus einem Brief teilnehmen (Gegenprobe durch Los): dass Ihre Teilnahme über einen solchen Brief kam. Ihren
            Namen und Ihre Anschrift kennt nur die Kommune, die die Briefe verschickt; bei uns werden sie nicht gespeichert.
          </li>
          <li>
            Wenn Sie freiwillig Ihre E-Mail-Adresse angeben, um zu erfahren, was aus der Beteiligung wird: die Adresse und die Links zu Ihren
            Laufzetteln, getrennt von Ihren Stimmen. Wir schreiben Ihnen erst, nachdem Sie die Adresse über einen Link bestätigt haben, und höchstens
            zweimal (Ergebnis, Beschluss). Bestätigt niemand die Adresse, löschen wir sie nach sieben Tagen. Jede Nachricht enthält einen Link zum Abmelden; danach löschen wir die Adresse.
          </li>
        </ul>
        <p>
          Texte können persönliche Angaben enthalten. Die Redaktion der Kommune prüft die Beiträge; Stellen, die eine Privatperson nennen oder
          beschreiben, werden nie öffentlich zitiert. Was Sie zu einer Maßnahme denken, kann eine politische Meinung sein; schreiben Sie deshalb
          nichts, woran man Sie erkennt, wenn Sie das nicht möchten.
        </p>

        <h2>Wenn Sie für eine Kommune arbeiten</h2>
        <p>
          Für Ihr Konto speichern wir Ihren Namen, Ihre E-Mail-Adresse und Ihr Passwort, dieses nur verschlüsselt (als Hash), dazu ein Cookie für
          die Anmeldung. Was Sie in der Verwaltung entscheiden, wird mit Ihrem Konto protokolliert, damit jede Entscheidung nachvollziehbar bleibt.
        </p>

        <h2>Wer die Daten verarbeitet</h2>
        <ul>
          <li>
            <b>Hetzner Online GmbH</b> (Gunzenhausen) betreibt unseren Server. Er steht derzeit in einem Rechenzentrum von Hetzner in den USA
            (Hillsboro, Oregon); der Umzug auf einen Server in Deutschland ist geplant.
          </li>
          <li>
            <b>Anthropic PBC</b> (USA): Ein Sprachmodell (Claude) zerlegt eingereichte Texte in einzelne Aussagen, schlägt Zuordnungen vor und
            formuliert den Bericht. Dafür werden die Texte an Anthropic übermittelt.
          </li>
          <li>
            <b>TypeSafe</b> (USA): Ein zweites Modell (Jev) prüft Zuordnungen und den Bericht. Dafür werden Textausschnitte übermittelt.
          </li>
          <li>
            <b>Resend</b> (USA, Versand über Server in der EU) verschickt E-Mails: an Mitarbeiterinnen und Mitarbeiter der Verwaltung, etwa
            Einladungen und Links zum Zurücksetzen des Passworts, und an Teilnehmende, die um eine Nachricht gebeten haben.
          </li>
        </ul>
        <p>
          Bei Diensten in den USA gelten zusätzliche Garantien für die Übermittlung, etwa der Angemessenheitsbeschluss der EU-Kommission für
          zertifizierte Unternehmen oder Standardvertragsklauseln. Werbung, Tracking und Analysedienste gibt es auf streit.bar nicht. Schriften
          liefern wir selbst aus.
        </p>

        <h2>Wie lange wir Daten speichern</h2>
        <p>
          Beiträge und Stimmen, solange das Verfahren besteht; die Kommune bestimmt, wann personenbezogene Daten eines abgeschlossenen Verfahrens
          gelöscht werden. Ergebnisse und Berichte enthalten nur anonyme Zahlen und Zitate ohne Personenbezug. Konten der Verwaltung, bis sie
          entfernt werden.
        </p>

        <h2>Ihre Rechte</h2>
        <p>
          Sie können Auskunft über Ihre Daten verlangen, ihre Berichtigung oder Löschung, die Einschränkung der Verarbeitung, und Sie können
          widersprechen. Zu einem Beteiligungsverfahren wenden Sie sich am besten an die Kommune, sonst an{" "}
          <a href="mailto:info@streit.bar">info@streit.bar</a>. Sie können sich außerdem bei einer Datenschutzaufsicht beschweren, für uns die
          Berliner Beauftragte für Datenschutz und Informationsfreiheit.
        </p>
      </main>
    </>
  );
}
