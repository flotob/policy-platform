import type { Metadata } from "next";

import { CampVoices, displayScope, nf } from "@policy/landkarte";
import { loadEvidence } from "@policy/landkarte/data/evidence";
import { bySplit, CLARIFICATION, clarificationsOf, groupByMeasure, loadReport, type Clarification } from "@policy/landkarte/data/report";

import { PrintButton } from "@/components/PrintButton";
import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

const shortTitle = (t: string) => t.replace(/\s*\(.*\)\s*$/, "");
const fmtDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(d);

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  const o = await overview(ref);
  return { title: `Gutachten-Agenda: ${shortTitle(o.title)} — Landkarte des Streits` };
}

/**
 * Idea 5: the study agenda. Every Landkarten-Punkt where a factual question
 * divides the camps (diag "klaerbar"), by measure, sharpest split first —
 * the cheapest conflict, settled by a study before the inter-ministerial round.
 */
export default async function Gutachten({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const { points, analysedAt } = await loadReport(getDb(), o.id);
  const facts = points.filter((p) => p.diag === "klaerbar");
  const groups = groupByMeasure(facts, o.measures, bySplit);
  const kinds = new Map(facts.map((p) => [p.id, clarificationsOf(p.befund)]));
  // The paper's evidence × belief matrix: evidenced but disputed → mediation; unevidenced and disputed → a study.
  const evidence = await loadEvidence(getDb(), o.id);
  const evidenced = (id: string) => (evidence.get(id)?.evidenced ?? 0) > 0;
  const mediation = facts.filter((p) => evidenced(p.id)).length;
  const kindCounts = (Object.keys(CLARIFICATION) as Clarification[])
    .map((k) => ({ k, n: facts.filter((p) => kinds.get(p.id)?.includes(k)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  return (
    <div className="rep-agenda">
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Gutachten-Agenda
        </p>
        <h1>Was ein Gutachten klären kann</h1>
        {facts.length > 0 ? (
          <p className="lead">
            {facts.length === 1 ? "Eine Streitfrage trennt" : `${nf.format(facts.length)} Streitfragen trennen`} die beiden Lager an einer Tatsache, nicht an
            einer Wertung. Das ist der günstigste Streit: Ein Kurzgutachten, Messdaten oder eine juristische Kurzstellungnahme können ihn klären, bevor die
            Ressortabstimmung beginnt. Was danach noch strittig ist, ist der politische Kern.
          </p>
        ) : (
          <p className="lead">In dieser Anhörung trennt keine Tatsachenfrage die beiden Lager. Was strittig ist, sind Wertungen und die Ausgestaltung.</p>
        )}
        <p className="rep-ag-stand small muted">
          {shortTitle(o.title)}
          {analysedAt ? `. Stand der Auswertung: ${fmtDate(analysedAt)}` : ""}.
        </p>
      </header>

      <div className="rep-ag-tools">
        <PrintButton />
      </div>

      {facts.length > 0 ? (
        <Row
          margin={
            kindCounts.length > 0 ? (
              <>
                <div>
                  <strong>Was die Befunde als Klärung vorschlagen</strong>
                </div>
                <ul className="rep-ag-kinds">
                  {kindCounts.map(({ k, n }) => (
                    <li key={k}>
                      {CLARIFICATION[k]}: {n} von {facts.length}
                    </li>
                  ))}
                </ul>
                <div className="muted">Ein Befund kann mehreres nennen.</div>
              </>
            ) : null
          }
        >
          <div className="prose">
            <p>
              Geordnet nach Teilentscheidung, in jeder zuerst die Fragen, bei denen die Lager am weitesten auseinanderliegen. Jeder Eintrag nennt die Frage, die
              Aussage, über die gestritten wird, und den Befund: worin der Streit besteht und welche Klärung sich anbietet. Am Rand steht ein Kreis je
              Organisation: gefüllt stimmt der Aussage zu, durchgestrichen lehnt sie ab, blass äußert sich nicht.
            </p>
            <p>
              Bei {facts.length - mediation} dieser Fragen nennt keine Stellungnahme Belege: Daten mit Quelle, Studien, andere Rechtsquellen oder Beispiele aus der
              Praxis. Dort hilft ein Gutachten. Bei {mediation} liegen Belege schon vor, und trotzdem glaubt ein Lager die Aussage nicht. Dort fehlt eher
              Vermittlung als ein Gutachten: Die Evidenz ist da, sie ist nur nicht angekommen. Ob ein Beleg stimmt, prüft die Auswertung nicht.
            </p>
          </div>
          <ol className="rep-ag-toc">
            {groups.map((g) => (
              <li key={g.measure.slug}>
                <a href={`#${g.measure.slug}`}>{g.measure.display}</a>
                <span className="muted">
                  {" "}
                  {g.points.length} {g.points.length === 1 ? "Frage" : "Fragen"}
                </span>
              </li>
            ))}
          </ol>
        </Row>
      ) : null}

      {groups.map((g) => (
        <section key={g.measure.slug} id={g.measure.slug} className="rep-ag-group">
          <h2>
            <a href={`${base}/massnahmen/${g.measure.slug}`}>{g.measure.display}</a>
          </h2>
          <p className="rep-ag-meta">
            <span className={`lk-diag lk-tone-${g.measure.verdict.tone}`}>{g.measure.verdict.title}</span>
            <span className="muted">
              {g.points.length} {g.points.length === 1 ? "Tatsachenfrage" : "Tatsachenfragen"} von {g.measure.points} Streitfragen
              {g.measure.paragraphs.length ? `, § ${g.measure.paragraphs.join(", ")}` : ""}
            </span>
          </p>
          {g.points.map((p) => {
            const k = kinds.get(p.id) ?? [];
            return (
              <Row
                key={p.id}
                id={`p-${p.id}`}
                margin={
                  <>
                    <CampVoices votes={p.votes} camps={o.camps} />
                    <div>
                      <strong>{evidenced(p.id) ? "Vermittlung statt Gutachten" : "Gutachten nötig"}</strong>
                      <br />
                      {evidenced(p.id)
                        ? `${evidence.get(p.id)!.evidenced} zitierte Textstellen nennen Belege; ein Lager glaubt sie trotzdem nicht.`
                        : "Keine Stellungnahme nennt Belege."}
                    </div>
                    {k.length ? <div>Klärung laut Befund: {k.map((x) => CLARIFICATION[x]).join(", ")}</div> : null}
                    <div className="muted">{displayScope(p.scope)}</div>
                  </>
                }
              >
                {p.question ? <p className="muted small rep-ag-q">{p.question}</p> : null}
                <p className="row-title">
                  <a href={`${base}/punkt/${p.id}`}>{p.text}</a>
                </p>
                {p.befund ? <p className="row-text">{p.befund}</p> : <p className="row-text muted">Zu dieser Frage liegt noch kein Befund vor.</p>}
              </Row>
            );
          })}
        </section>
      ))}
    </div>
  );
}
