import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { ReportText, SentenceList } from "@/components/ergebnis/ReportText";
import { latestResult } from "@/lib/auswertung";
import { listReports, namingOf, REPORT_STATES } from "@/lib/bericht";
import { getCampaign } from "@/lib/campaigns";
import { listJobs } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";
import { actorName } from "@/lib/vocab";

import { makeReport, publishReport, releaseReport, rewriteReport } from "../../auswertung-actions";
import { RejectForm } from "../../auswertung-forms";

import "../../../bericht.css";
import "../auswertung/auswertung.css";
import "./bericht.css";

export const metadata = { title: "Bericht" };

const pc = (p: number) => `${Math.round(p * 100)} %`;
const when = (d: string) => new Date(d).toLocaleString("de-DE", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Phase 4 for the municipality (R1–R5): the binding list of conclusions, the
 * text the machine wrote from it, the check, and the editors' decision.
 */
export default async function Bericht({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) notFound();
  const [reports, saved, jobs] = await Promise.all([listReports(c.id), latestResult(c.id), listJobs(c.id)]);
  const editor = staff.role !== "betrachter";
  const initiator = staff.role === "initiator";
  const report = reports[0];
  const older = reports.slice(1);
  const resultsHref = `/verwaltung/${c.id}/auswertung`;
  const publicBase = `/${staff.tenant.slug}/${c.slug}`;

  if (!report) {
    const confirmed = !!namingOf(saved?.campNames)?.confirmedBy;
    return (
      <div className="au">
        <section className="au-panel">
          <h2>Noch kein Bericht</h2>
          <p className="au-lead">
            {saved
              ? confirmed
                ? "Die Lager sind benannt. Der Bericht kann entstehen."
                : "Zuerst bekommen die Lager ihre Namen, unter Auswertung. Dann kann der Bericht entstehen."
              : "Ein Bericht entsteht, wenn die Beteiligung geschlossen ist."}
          </p>
          {saved && editor ? (
            <form action={makeReport.bind(null, c.id)} className="au-actions">
              <button type="submit" className="btn" disabled={!confirmed}>
                Bericht schreiben lassen
              </button>
              {!confirmed ? <Link href={`/verwaltung/${c.id}/auswertung#lager`}>Lager benennen</Link> : null}
            </form>
          ) : null}
        </section>
      </div>
    );
  }

  const busy = jobs.some((j) => j.kind === "bericht" && (j.state === "wartet" || j.state === "laeuft"));
  const st = REPORT_STATES[report.state];
  const flagged = report.checks?.reader.filter((x) => !x.pass).map((x) => x.absatz) ?? [];
  const ruleFlagged = report.checks?.rules.map((x) => x.absatz).filter((x): x is number => x !== null) ?? [];

  return (
    <div className="au rp">
      <AutoRefresh active={busy || report.state === "liste"} everyMs={5000} />
      <section className="au-panel">
        <div className="rp-head">
          <h2>Bericht, Fassung {report.version}</h2>
          <span className={`rp-state rp-${report.state}`}>{st.label}</span>
        </div>
        <p className="au-lead">{busy ? "Die Maschine schreibt den Text und lässt ihn gegenlesen. Das dauert ein bis zwei Minuten." : st.text}</p>
        {report.feedback ? (
          <p className="small muted">
            Diese Fassung antwortet auf die Zurückweisung: „{report.feedback}“
          </p>
        ) : null}
        {report.decidedBy && (report.state === "freigegeben" || report.state === "veroeffentlicht") ? (
          <p className="small muted">
            Freigegeben {actorName(report.decidedBy, { [staff.user.id]: staff.user.name })}
            {report.decidedAt ? ` am ${when(report.decidedAt)}` : ""}.
          </p>
        ) : null}

        {editor ? (
          <div className="rp-actions">
            {report.state === "geprueft" ? (
              <form action={releaseReport.bind(null, c.id, report.id)}>
                <button type="submit" className="btn">
                  Bericht freigeben
                </button>
              </form>
            ) : null}
            {report.state === "durchgefallen" && !busy ? (
              <form action={rewriteReport.bind(null, c.id, report.id)}>
                <button type="submit" className="btn">
                  Noch einmal schreiben lassen
                </button>
              </form>
            ) : null}
            {report.state === "freigegeben" && initiator ? (
              <form action={publishReport.bind(null, c.id, report.id)}>
                <button type="submit" className="btn">
                  Bericht und Ergebnis veröffentlichen
                </button>
              </form>
            ) : null}
            {report.state === "veroeffentlicht" ? (
              <p className="rp-links">
                <Link href={`${publicBase}/bericht`} className="btn btn-quiet">
                  Öffentlicher Bericht
                </Link>
                <Link href={`${publicBase}/ergebnis`} className="btn btn-quiet">
                  Öffentliche Ergebnisseite
                </Link>
              </p>
            ) : null}
            {["geprueft", "durchgefallen", "freigegeben"].includes(report.state) && !busy ? <RejectForm id={c.id} reportId={report.id} /> : null}
          </div>
        ) : null}
      </section>

      {report.text ? (
        <div className="rp-cols">
          <section>
            <p className="au-label">Der Text · jeder Absatz nennt die Sätze, die er wiedergibt</p>
            <ReportText text={report.text} resultsHref={resultsHref} ids flagged={[...flagged, ...ruleFlagged]} />
          </section>
          <aside>
            <p className="au-label">Die Prüfung</p>
            {report.checks ? (
              <div className="rp-check">
                <p>
                  <b>{report.checks.passed ? "Bestanden." : "Nicht bestanden."}</b> {report.checks.attempts === 1 ? "Im ersten Entwurf." : `Nach ${report.checks.attempts} Entwürfen.`}
                </p>
                <h3>Nach Regeln</h3>
                {report.checks.rules.length ? (
                  <ul>
                    {report.checks.rules.map((x, i) => (
                      <li key={i}>{x.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">
                    Jeder Absatz verweist auf seine Sätze, jeder Satz kommt vor, keine Zahl und keine Aussage, die nicht in den Sätzen steht.
                  </p>
                )}
                <h3>Der Gegenleser</h3>
                <p className="small muted">
                  Ein zweites, unabhängiges Modell (Jev) liest jeden Absatz gegen seine Sätze: Ist nichts ergänzt? Zeigt jeder Befund in dieselbe Richtung?
                  Ist nichts abgeschwächt oder verstärkt?
                </p>
                <table className="rp-reader num">
                  <thead>
                    <tr>
                      <th>Absatz</th>
                      <th>nichts ergänzt</th>
                      <th>Richtung</th>
                      <th>Stärke</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.checks.reader.map((x) => (
                      <tr key={x.absatz} className={x.pass ? undefined : "bad"}>
                        <td>{x.absatz}</td>
                        <td>{pc(x.treu)}</td>
                        <td>{pc(x.richtung)}</td>
                        <td>{pc(x.staerke)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">Unter 50 % gilt ein Absatz als beanstandet.</p>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      <details className="rp-sentences" open={!report.text}>
        <summary>Die Schlussfolgerungen: {report.sentences.length} Sätze, nach festen Regeln aus dem Ergebnis</summary>
        <p className="small muted">
          Diese Liste ist bindend. Der Text darf sie nur ausformulieren; die Redaktion kann ihn freigeben oder zurückweisen, aber keinen Satz ändern.
        </p>
        <SentenceList sentences={report.sentences} resultsHref={resultsHref} />
      </details>

      {older.length ? (
        <section className="rp-older">
          <h3>Frühere Fassungen</h3>
          <ul>
            {older.map((o) => (
              <li key={o.id}>
                Fassung {o.version}: {REPORT_STATES[o.state].label}
                {o.feedback && o.state === "zurueckgewiesen" ? ` — „${o.feedback}“` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
