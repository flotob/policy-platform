import Link from "next/link";

import { listCampaigns } from "@/lib/campaigns";
import { STATES } from "@/lib/params";
import { requireStaff } from "@/lib/session";

export const metadata = { title: "Verfahren" };

const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

export default async function Verwaltung({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const staff = await requireStaff();
  const { fehler } = await searchParams;
  const campaigns = await listCampaigns(staff.tenant.id);
  return (
    <>
      <div className="ws-title">
        <div>
          <h1>Verfahren</h1>
          <p className="muted">Jedes Verfahren stellt eine Maßnahme zur Diskussion.</p>
        </div>
        {staff.role === "initiator" ? (
          <Link href="/verwaltung/neu" className="btn">
            Neues Verfahren
          </Link>
        ) : null}
      </div>
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
