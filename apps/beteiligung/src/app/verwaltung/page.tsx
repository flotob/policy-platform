import Link from "next/link";

import { listCampaigns } from "@/lib/campaigns";
import { kommuneById } from "@/lib/kommune";
import { appUrl } from "@/lib/mail";
import { listTeam } from "@/lib/team";
import { STATES } from "@/lib/params";
import { requireStaff } from "@/lib/session";

export const metadata = { title: "Verfahren" };

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

export default async function Verwaltung({ searchParams }: { searchParams: Promise<{ fehler?: string; willkommen?: string }> }) {
  const staff = await requireStaff();
  const { fehler, willkommen } = await searchParams;
  const [campaigns, k, team] = await Promise.all([listCampaigns(staff.tenant.id), kommuneById(staff.tenant.id), listTeam(staff.tenant.id)]);
  const s = k?.settings;
  const steps = [
    {
      done: !!(s && (s.kontakt.email || s.kontakt.telefon) && s.impressum && s.datenschutz),
      title: "Ihre Kommune einrichten",
      text: "Ansprechpartner, Links zu Ihrem Impressum und Ihrer Datenschutzerklärung, ein Logo. Das steht auf jeder Seite Ihrer Beteiligungen.",
      href: "/verwaltung/einstellungen",
      cta: "Zu den Einstellungen",
    },
    {
      done: team.members.filter((m) => !m.demo).length + team.invites.length > 1,
      title: "Ihr Team einladen",
      text: "Wer Verfahren anlegt, wer die Redaktion macht, wer nur zusieht. Jede Person bekommt eine E-Mail mit einem Link.",
      href: "/verwaltung/team",
      cta: "Zum Team",
    },
    {
      done: campaigns.length > 0,
      title: "Das erste Verfahren anlegen",
      text: "Eine Frage an Ihre Stadt, die Maßnahme im Wortlaut, die Begründung in vier Schritten. Stellungnahmen, die schon vorliegen, laden Sie dazu.",
      href: "/verwaltung/neu",
      cta: "Verfahren anlegen",
    },
  ];
  const guide = staff.role === "initiator" && steps.some((x) => !x.done);
  return (
    <>
      <div className="ws-title">
        <div>
          <h1>Verfahren</h1>
          <p className="muted">Jedes Verfahren stellt eine Maßnahme zur Diskussion.</p>
          <p className="small ws-public">
            Ihre öffentliche Seite:{" "}
            <Link href={`/${staff.tenant.slug}`} target="_blank">
              {appUrl(`/${staff.tenant.slug}`).replace(/^https?:\/\//, "")}
            </Link>
          </p>
        </div>
        {staff.role === "initiator" ? (
          <Link href="/verwaltung/neu" className="btn">
            Neues Verfahren
          </Link>
        ) : null}
      </div>
      {willkommen ? <p className="notice">Willkommen im Team von {staff.tenant.name}.</p> : null}
      {guide ? (
        <section className="start" aria-label="Erste Schritte">
          <h2>Erste Schritte</h2>
          <ol className="start-steps">
            {steps.map((x) => (
              <li key={x.title} className={x.done ? "done" : undefined}>
                <span className="tick" aria-hidden>
                  {x.done ? "✓" : ""}
                </span>
                <div>
                  <b>{x.title}</b>
                  <p className="small muted">{x.text}</p>
                  {x.done ? null : (
                    <Link href={x.href} className="small">
                      {x.cta}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="small muted">
            Danach geht es im Verfahren weiter: Die Maschine liest Begründung und Stellungnahmen und schlägt die ersten Aussagen vor, Ihre Redaktion
            gibt sie frei, dann schalten Sie die Beteiligung frei und teilen den Link. Wie das Ergebnis am Ende aussieht, zeigt das{" "}
            <Link href="/musterstadt/solarpflicht/ergebnis">Beispiel Musterstadt</Link>.
          </p>
        </section>
      ) : null}
      {fehler === "rolle" ? <p className="notice">Verfahren anlegen und ändern dürfen nur Initiatorinnen und Initiatoren Ihrer Kommune.</p> : null}

      {campaigns.length === 0 ? (
        <div className="ws-empty">
          <h2>Noch kein Verfahren</h2>
          <p className="muted">
            Ein Verfahren beginnt mit einer Frage an Ihre Stadt, etwa: „Soll die Stadt für Neubauten eine Solarpflicht einführen?“ Dazu kommen
            die Begründung und, wenn vorhanden, Stellungnahmen, die schon eingegangen sind.
          </p>
          {staff.role === "initiator" ? (
            <Link href="/verwaltung/neu" className="btn">
              Erstes Verfahren anlegen
            </Link>
          ) : null}
        </div>
      ) : (
        <table className="ws-table">
          <thead>
            <tr>
              <th scope="col">Verfahren</th>
              <th scope="col">Stand</th>
              <th scope="col" className="num">Unterlagen</th>
              <th scope="col">Zuletzt geändert</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/verwaltung/${c.id}`} className="ws-link">
                    {c.title}
                  </Link>
                  <span className="muted small ws-q">{c.question}</span>
                </td>
                <td>
                  <span className={`state state-${c.state}`}>{STATES[c.state].label}</span>
                  {c.fictional ? <span className="tag">Beispiel</span> : null}
                </td>
                <td className="num">{c.files}</td>
                <td className="muted">{date.format(new Date(c.updatedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
