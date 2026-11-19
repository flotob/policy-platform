import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportText } from "@/components/ergebnis/ReportText";
import { PublicFrame } from "@/components/PublicFrame";
import { publishedBundle } from "@/lib/bericht";
import { publicDecision } from "@/lib/beschluss";
import { decisionHead, outcomeOf } from "@/lib/beschluss-words";
import { getPublicCampaign } from "@/lib/campaigns";
import { periodOf } from "@/lib/ergebnis-seite";
import { hiddenOf, hiddenWords, maskHidden } from "@/lib/meldungen";

import "../../public.css";
import "../../../bericht.css";

const day = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

export async function generateMetadata({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  return c ? { title: `Bericht: ${c.title}, ${c.tenant.name}` } : {};
}

/** R5/R7: the released report — what is to be clarified, and by whom. Prints cleanly. */
export default async function Bericht({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const bundle = await publishedBundle(c);
  if (!bundle?.report.text) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  const [period, decision, hidden] = await Promise.all([periodOf(c), publicDecision(c.id), hiddenOf(c)]);
  // What the editors hid after a report is hidden here too: in the tables, and in the text written before.
  const r = maskHidden(bundle.result, hidden);
  const clean = hiddenWords(bundle.result, hidden);
  const report = {
    ...bundle.report,
    text: bundle.report.text?.map((a) => ({ ...a, text: clean(a.text) })) ?? null,
    sentences: bundle.report.sentences.map((x) => ({ ...x, text: clean(x.text) })),
  };
  const decided = decision ? r.statements.filter((s) => decision.points[s.id]) : [];
  return (
    <PublicFrame town={c.tenant} campaign={{ slug: c.slug, title: c.title }} back>
      <main className="wrap pub-report">
        <p className="pub-report-kind">Bericht über die Beteiligung{c.fictional ? " · Beispiel mit erfundenen Inhalten" : ""}</p>
        <h1>{c.title}</h1>
        <p className="pub-report-meta">
          {c.tenant.name}
          {period ? `, Beteiligung ${period}` : ""}. Fassung {report.version}, freigegeben {report.decidedAt ? `am ${day(report.decidedAt)}` : ""} von der Redaktion.
        </p>
        <blockquote className="pub-measure">{c.measure}</blockquote>
        <ReportText text={report.text!} resultsHref={`${base}/ergebnis`} />
        {decision ? (
          <section className="pub-report-decision">
            <h2>Nachtrag: Was der {decision.gremium} beschlossen hat</h2>
            <p>
              <strong>{decisionHead(decision)}</strong> {decision.summary ?? ""}
            </p>
            {decided.length ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Aussage</th>
                    <th scope="col">Behandlung</th>
                  </tr>
                </thead>
                <tbody>
                  {decided.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="num">A{s.nr}</span> {s.text}
                      </td>
                      <td>
                        <b>{outcomeOf(decision.points[s.id]!.outcome)?.label}</b>
                        {decision.points[s.id]!.reason ? `. ${decision.points[s.id]!.reason}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="small muted">Der Nachtrag ist nicht Teil des freigegebenen Berichts. Die Verwaltung hat ihn nach der Sitzung eingetragen.</p>
          </section>
        ) : null}
        <section className="pub-report-how">
          <h2>Wie dieser Bericht entstanden ist</h2>
          <p>
            Die Schlussfolgerungen hat die Maschine nach festen Regeln aus dem gespeicherten Ergebnis zusammengestellt, ohne Sprachmodell. Ein
            Sprachmodell hat sie ausformuliert; ein zweites, unabhängiges Modell und feste Regeln haben geprüft, dass jeder Absatz auf seine Sätze
            zurückgeht und nichts verändert, abgeschwächt oder hinzugefügt wurde. Die Redaktion konnte den Text nur freigeben oder zurückweisen,
            nicht die Schlussfolgerungen ändern.
          </p>
          <p className="no-print">
            <Link href={`${base}/ergebnis`}>Zur Ergebnisseite</Link>, wo jede Zahl bis zum Originalzitat zurückführt.
          </p>
          <details className="no-print">
            <summary>Die {report.sentences.length} Schlussfolgerungen, aus denen der Text entstand</summary>
            <ol className="rp-list">
              {report.sentences.map((s) => (
                <li key={s.id}>
                  <span className="rp-sid num">{s.id}</span>
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
          </details>
        </section>
      </main>
    </PublicFrame>
  );
}
