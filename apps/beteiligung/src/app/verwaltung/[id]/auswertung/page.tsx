import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { ResultView } from "@/components/ergebnis/ResultView";
import { latestResult, liveResult, namesLocked } from "@/lib/auswertung";
import { latestReport, namingOf } from "@/lib/bericht";
import { getCampaign } from "@/lib/campaigns";
import { methodParagraphs, periodOf, questionLabels, townShort } from "@/lib/ergebnis-seite";
import { countQueue } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";

import { closeParticipation, makeReport, reopenParticipation, reproposeNames } from "../../auswertung-actions";
import { CampNamesForm } from "../../auswertung-forms";

import "../../../ergebnis.css";
import "./auswertung.css";

export const metadata = { title: "Auswertung" };

const n = (x: number) => x.toLocaleString("de-DE");
const when = (d: string) => new Date(d).toLocaleString("de-DE", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Phase 3 for the municipality: while citizens take part, the results page
 * as it would look now (computed live); closing the participation (B13)
 * freezes the votes and stores the result (W9); then the camps get names
 * and the report can be written.
 */
export default async function Auswertung({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const { fehler } = await searchParams;
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) notFound();
  if (c.state === "entwurf" || c.state === "vorbereitung") {
    return (
      <div className="au">
        <p className="notice">Die Auswertung beginnt, sobald die Beteiligung freigeschaltet ist.</p>
      </div>
    );
  }
  const initiator = staff.role === "initiator";
  const editor = staff.role !== "betrachter";
  const town = townShort(staff.tenant.name);

  if (c.state === "offen") {
    const [r, queue] = await Promise.all([liveResult(c), countQueue(c.consultationId)]);
    const checks = [
      {
        done: r.ready,
        text: r.ready
          ? `Genug Teilnehmende für Lager: ${n(r.clusterable)} haben ausreichend viele Aussagen bewertet.`
          : `Für Lager müssen mindestens ${n(r.needed)} Menschen genug Aussagen bewerten. Bisher: ${n(r.clusterable)}.`,
      },
      {
        done: r.saturation.saturated,
        text: r.saturation.saturated
          ? `Die Debatte ist ausgeschöpft: Die letzten ${n(r.saturation.streak)} Eingaben brachten nichts Neues.`
          : `Noch nicht ausgeschöpft: zuletzt ${n(r.saturation.streak)} Eingaben ohne neuen Punkt, das Fenster sind ${n(r.saturation.window)}. Schließen geht trotzdem.`,
      },
      {
        done: queue === 0,
        text: queue ? `${n(queue)} ${queue === 1 ? "Vorlage wartet" : "Vorlagen warten"} noch in der Redaktion. Was dort noch liegt, kommt nicht mehr zur Abstimmung.` : "Die Redaktion hat nichts mehr offen.",
      },
    ];
    return (
      <div className="au">
        <AutoRefresh active everyMs={30000} />
        <section className="au-panel">
          <h2>Beteiligung schließen und auswerten</h2>
          <p className="au-lead">
            Wenn Sie schließen, nimmt die Beteiligung keine Stimmen und Beiträge mehr an. Die Maschine rechnet das Ergebnis ein letztes Mal und
            speichert es unveränderlich; daraus entstehen Ergebnisseite und Bericht. Solange kein Bericht freigegeben ist, können Sie wieder öffnen.
          </p>
          <ul className="checklist">
            {checks.map((x) => (
              <li key={x.text} className={x.done ? "done" : undefined}>
                <span className="tick" aria-hidden>
                  {x.done ? "✓" : ""}
                </span>
                {x.text}
              </li>
            ))}
          </ul>
          {fehler === "lager" ? <p className="notice">Für ein Ergebnis braucht es Lager, und dafür haben noch zu wenige Menschen abgestimmt.</p> : null}
          {initiator ? (
            <form action={closeParticipation.bind(null, c.id)} className="au-actions">
              <button type="submit" className="btn" disabled={!r.ready}>
                Beteiligung schließen
              </button>
            </form>
          ) : null}
        </section>
        {r.ready ? (
          <section className="au-preview" aria-label="Vorschau der Ergebnisseite">
            <p className="au-label">Vorschau der Ergebnisseite · Zwischenstand, live gerechnet</p>
            <ResultView
              r={r}
              names={null}
              title={c.title}
              town={town}
              measure={c.measure}
              eyebrow={`Zwischenstand · ${staff.tenant.name}${c.fictional ? " · Beispiel mit erfundenen Inhalten" : ""}`}
              period={null}
              questions={questionLabels}
              method={methodParagraphs(c, r)}
              notice="Die Beteiligung läuft noch: Diese Zahlen ändern sich mit jeder Stimme. Namen bekommen die Lager nach dem Schließen."
            />
          </section>
        ) : null}
      </div>
    );
  }

  // Closed: the stored result.
  const saved = await latestResult(c.id);
  if (!saved) {
    return (
      <div className="au">
        <p className="notice">Die Beteiligung ist geschlossen, aber es gibt noch kein gespeichertes Ergebnis.</p>
      </div>
    );
  }
  const [report, locked, period] = await Promise.all([latestReport(c.id), namesLocked(saved.id), periodOf(c)]);
  const naming = namingOf(saved.campNames);
  const confirmed = !!naming?.confirmedBy;
  const r = saved.result;
  const canReopen = initiator && (c.state === "auswertung" || c.state === "bericht") && !(report && ["freigegeben", "veroeffentlicht"].includes(report.state));
  const reportOfThis = report && report.resultId === saved.id && report.state !== "zurueckgewiesen";

  return (
    <div className="au">
      <AutoRefresh active={!naming} everyMs={5000} />
      <section className="au-panel">
        <h2>Das Ergebnis</h2>
        <p className="au-lead">
          Gerechnet am {when(saved.createdAt)} aus {n(r.participation.votes)} Stimmen von {n(r.participation.voters)} Teilnehmenden (Version {saved.version}, Prüfsumme{" "}
          <span className="num">{r.matrixHash.slice(0, 12)}</span>). Dieses Ergebnis ändert sich nicht mehr; Ergebnisseite und Bericht stützen sich nur darauf.
        </p>
        {canReopen ? (
          <form action={reopenParticipation.bind(null, c.id)} className="au-actions">
            <button type="submit" className="btn btn-quiet btn-small">
              Beteiligung wieder öffnen
            </button>
            <span className="small muted">Zu früh geschlossen? Das gespeicherte Ergebnis bleibt als Version erhalten.</span>
          </form>
        ) : null}
      </section>

      <section className="au-panel" id="lager">
        <h2>Die Lager benennen</h2>
        {!naming ? (
          <p className="au-lead">
            <span className="pulse" aria-hidden /> Die Maschine schlägt Namen vor. Das dauert eine halbe Minute; die Seite aktualisiert sich.
          </p>
        ) : (
          <>
            <p className="au-lead">
              {confirmed
                ? locked
                  ? "Die Namen stehen fest: Der Bericht mit diesen Namen ist freigegeben."
                  : "Die Redaktion hat die Namen bestätigt. Sie können sie ändern, bis der Bericht freigegeben ist."
                : "Die Maschine hat Namen vorgeschlagen, aus den Aussagen, bei denen jedes Lager anders abstimmt als die anderen. Übernehmen Sie sie oder ändern Sie sie: Die Menschen in einem Lager sollten sich im Namen wiedererkennen."}
            </p>
            {fehler === "namen" ? <p className="notice">Bevor der Bericht entsteht, braucht jedes Lager einen von der Redaktion bestätigten Namen.</p> : null}
            {naming.proposal && confirmed && naming.proposal.names.join() !== naming.names.join() ? (
              <p className="small muted">Vorschlag der Maschine: {naming.proposal.names.map((x) => `„${x}“`).join(", ")}.</p>
            ) : null}
            {editor ? (
              <CampNamesForm
                key={[...naming.names, ...naming.descriptions].join("|")}
                id={c.id}
                resultId={saved.id}
                names={naming.names}
                descriptions={naming.descriptions}
                sizes={r.camps?.sizes ?? []}
                confirmed={confirmed}
                locked={locked}
              />
            ) : null}
            {editor && !locked ? (
              <form action={reproposeNames.bind(null, c.id, saved.id)} className="au-actions">
                <button type="submit" className="btn btn-quiet btn-small">
                  Neue Vorschläge holen
                </button>
              </form>
            ) : null}
          </>
        )}
      </section>

      <section className="au-panel">
        <h2>Der Bericht</h2>
        {reportOfThis ? (
          <p className="au-lead">
            Der Bericht zu diesem Ergebnis ist in Arbeit: <Link href={`/verwaltung/${c.id}/bericht`}>zum Bericht</Link>.
          </p>
        ) : (
          <>
            <p className="au-lead">
              Der Bericht entsteht in drei Schritten: Die Maschine stellt die Schlussfolgerungen nach festen Regeln zusammen, ein Sprachmodell
              formuliert sie aus, ein zweites, unabhängiges Modell prüft, dass nichts verändert, abgeschwächt oder hinzugefügt wurde. Dann
              entscheidet die Redaktion.
            </p>
            {editor ? (
              <form action={makeReport.bind(null, c.id)} className="au-actions">
                <button type="submit" className="btn" disabled={!confirmed}>
                  Bericht schreiben lassen
                </button>
                {!confirmed ? <span className="small muted">Erst die Lagernamen bestätigen.</span> : null}
              </form>
            ) : null}
          </>
        )}
      </section>

      <section className="au-preview" aria-label="Vorschau der Ergebnisseite">
        <p className="au-label">
          Vorschau der Ergebnisseite{c.state === "veroeffentlicht" ? " · veröffentlicht" : ""}
          {!confirmed && naming ? " · mit den vorgeschlagenen Namen" : ""}
        </p>
        <ResultView
          r={r}
          names={naming?.names ?? null}
          title={c.title}
          town={town}
          measure={c.measure}
          eyebrow={`Online-Anhang zum Bericht · ${staff.tenant.name}${c.fictional ? " · Beispiel mit erfundenen Inhalten" : ""}`}
          period={period}
          questions={questionLabels}
          method={methodParagraphs(c, r)}
        />
      </section>
    </div>
  );
}
