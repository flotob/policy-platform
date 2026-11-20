import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { ResultView } from "@/components/ergebnis/ResultView";
import { latestResult, liveResult, namesLocked } from "@/lib/auswertung";
import { latestReport, namingOf } from "@/lib/bericht";
import { hiddenOf, maskHidden } from "@/lib/meldungen";
import { getCampaign } from "@/lib/campaigns";
import { methodParagraphs, periodOf, questionLabels, townShort } from "@/lib/ergebnis-seite";
import { countQueue, countReading } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";

import { closeParticipation, makeReport, reopenParticipation, reproposeNames } from "../../auswertung-actions";
import { CampNamesForm } from "../../auswertung-forms";

import "../../../ergebnis.css";
import "./auswertung.css";

export const metadata = { title: "Auswertung" };

const n = (x: number) => x.toLocaleString("de-DE");
const when = (d: string) => new Date(d).toLocaleString("de-DE", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

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
    const [r, queue, reading] = await Promise.all([liveResult(c), countQueue(c.consultationId), countReading(c.id)]);
    const checks = [
      {
        done: r.ready,
        text: r.ready
          ? `Genug Teilnehmende für Lager: ${n(r.clusterable)} haben ausreichend viele Aussagen bewertet.`
          : `Für Lager müssen mindestens ${n(r.needed)} Menschen genug Aussagen bewerten. Bisher: ${n(r.clusterable)}. Schließen geht trotzdem: Dann zählt das Ergebnis die Stimmen aller zusammen und zeigt die Argumente, ohne Lager.`,
      },
      {
        done: r.saturation.saturated,
        text: r.saturation.saturated
          ? `Die Debatte ist ausgeschöpft: Die letzten ${n(r.saturation.streak)} Eingaben brachten nichts Neues.`
          : `Noch nicht ausgeschöpft: ${
              r.saturation.streak === 0
                ? "Die letzte Eingabe brachte noch einen neuen Punkt."
                : r.saturation.streak === 1
                  ? "Die letzte Eingabe brachte nichts Neues, die davor schon."
                  : `Die letzten ${n(r.saturation.streak)} Eingaben brachten nichts Neues.`
            } Als ausgeschöpft gilt die Debatte, wenn ${n(r.saturation.window)} Eingaben in Folge nichts Neues bringen. Schließen geht trotzdem.`,
      },
      {
        done: queue === 0,
        text: queue ? `${n(queue)} ${queue === 1 ? "Vorlage wartet" : "Vorlagen warten"} noch in der Redaktion. Was dort noch liegt, kommt nicht mehr zur Abstimmung.` : "Die Redaktion hat nichts mehr offen.",
      },
      {
        done: reading.reading === 0 && reading.failed === 0,
        text:
          [
            !reading.reading
              ? ""
              : reading.reading === 1
                ? "Eine Eingabe liest die Maschine noch. Sie wird danach einsortiert, zählt aber nicht mehr im Ergebnis. Warten Sie ein paar Minuten, wenn sie mitzählen soll."
                : `${n(reading.reading)} Eingaben liest die Maschine noch. Sie werden danach einsortiert, zählen aber nicht mehr im Ergebnis. Warten Sie ein paar Minuten, wenn sie mitzählen sollen.`,
            !reading.failed
              ? ""
              : reading.failed === 1
                ? "Eine Eingabe konnte die Maschine nicht lesen; sie zählt nicht, solange niemand sie oben erneut anstößt."
                : `${n(reading.failed)} Eingaben konnte die Maschine nicht lesen; sie zählen nicht, solange niemand sie oben erneut anstößt.`,
          ]
            .filter(Boolean)
            .join(" ") || "Die Maschine hat alle Eingaben gelesen.",
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
          {fehler === "leer" ? <p className="notice">Noch hat niemand abgestimmt. Für ein Ergebnis braucht es mindestens eine Stimme.</p> : null}
          {initiator ? (
            <form action={closeParticipation.bind(null, c.id)} className="au-actions">
              <button type="submit" className="btn" disabled={!r.participation.voters}>
                Beteiligung schließen
              </button>
            </form>
          ) : null}
        </section>
        {r.participation.voters ? (
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
              notice={`Die Beteiligung läuft noch: Diese Zahlen ändern sich mit jeder Stimme.${r.ready ? " Namen bekommen die Lager nach dem Schließen." : ""}`}
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
  // Without camps there is nothing to name: the report can start at once.
  const confirmed = !!naming?.confirmedBy || !saved.result.camps;
  const r = maskHidden(saved.result, await hiddenOf(c));
  const canReopen = initiator && (c.state === "auswertung" || c.state === "bericht") && !(report && ["freigegeben", "veroeffentlicht"].includes(report.state));
  const reportOfThis = report && report.resultId === saved.id && report.state !== "zurueckgewiesen";

  return (
    <div className="au">
      <AutoRefresh active={!naming && !!saved.result.camps} everyMs={5000} />
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

      {!r.camps ? (
        <section className="au-panel" id="lager">
          <h2>Ohne Lager</h2>
          <p className="au-lead">
            Für Lager haben zu wenige Menschen abgestimmt ({n(r.clusterable)} von mindestens {n(r.needed)}). Das Ergebnis zählt deshalb die Stimmen
            aller zusammen und zeigt die Argumente Schritt für Schritt, aber kein Urteil über Brücken, Streit oder die vier Stufen.
          </p>
        </section>
      ) : (
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
      )}

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
