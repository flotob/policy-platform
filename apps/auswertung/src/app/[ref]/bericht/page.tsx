import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DIAG_ORDER, DiagLabel, nf, shortOrg, type Diag, type VerdictKey } from "@policy/landkarte";
import type { Camp, MapPoint, MeasureSummary } from "@policy/landkarte/data";
import { loadEvidence } from "@policy/landkarte/data/evidence";
import {
  byBreadth,
  bySplit,
  campCountsText,
  countOf,
  gapQuestion,
  groupByMeasure,
  loadReport,
  reasonsNote,
  spread,
  type MeasureGroup,
} from "@policy/landkarte/data/report";

import { PrintButton } from "@/components/PrintButton";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

/** How many concrete points the recommendation names per kind. */
const REC_FACTS = 3;
const REC_DESIGN = 3;
const REC_BRIDGES = 3;

const VERDICT_ORDER: VerdictKey[] = ["wertkonflikt", "fakten-und-werte", "werte", "scheinfaktenstreit", "tatsachen", "ausgestaltung", "einig", "duenn"];

const shortTitle = (t: string) => t.replace(/\s*\(.*\)\s*$/, "");
const fmtDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeZone: "Europe/Berlin" }).format(d);

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  const o = await overview(ref);
  return { title: `Bericht zur ${o.procedure}: ${shortTitle(o.title)} — Landkarte des Streits` };
}

/** "die 8 Kernkonflikte" / "der Kernkonflikt" — subject phrases for the recommendation sentence. */
function the(n: number, one: string, many: string, article: "der" | "die"): string {
  return n === 1 ? `${article} ${one}` : `die ${nf.format(n)} ${many}`;
}

function Entry({ p, base, camps, note, text }: { p: MapPoint; base: string; camps: Camp[]; note?: string; text?: string }) {
  const counts = campCountsText(p.votes, camps);
  return (
    <article className="rep-entry" id={`p-${p.id}`}>
      {p.diag === "kern" ? (
        <p className="rep-kicker">
          <DiagLabel diag="kern" />
        </p>
      ) : null}
      {p.question && !text ? <p className="rep-q">{p.question}</p> : null}
      <p className="rep-stmt">
        <a href={`${base}/punkt/${p.id}`}>{text ?? p.text}</a>
      </p>
      {counts ? <p className="rep-counts">{counts}</p> : null}
      {note ? <p className="rep-note">{note}</p> : null}
      {p.befund ? <p className="rep-befund">{p.befund}</p> : null}
    </article>
  );
}

function Groups({ groups, base, camps, note, text }: { groups: MeasureGroup[]; base: string; camps: Camp[]; note?: (p: MapPoint) => string; text?: (p: MapPoint) => string }) {
  return (
    <>
      {groups.map((g) => (
        <div className="rep-group" key={g.measure.slug}>
          <h3 className="rep-measure">
            <a href={`${base}/massnahmen/${g.measure.slug}`}>{g.measure.display}</a>
          </h3>
          {g.points.map((p) => (
            <Entry key={p.id} p={p} base={base} camps={camps} note={note?.(p)} text={text?.(p)} />
          ))}
        </div>
      ))}
    </>
  );
}

/** One line of the recommendation: a concrete point, where it sits, and (optionally) the counts. */
function RecItem({ p, label, where, counts }: { p: MapPoint; label: string; where: string; counts?: string | null }) {
  return (
    <li>
      <a href={`#p-${p.id}`}>{label}</a>
      <span className="rep-where">
        {" "}
        {where}
        {counts ? `. ${counts}` : ""}
      </span>
    </li>
  );
}

function Section({ id, n, title, lead, children }: { id: string; n: number; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="rep-section">
      <h2>
        <span className="rep-num">{n}</span> {title}
      </h2>
      <div className="rep-lead">{lead}</div>
      {children}
    </section>
  );
}

function diagCountsLine(m: MeasureSummary): string {
  const parts = DIAG_ORDER.filter((d) => d !== "luecke" && (m.counts[d] ?? 0) > 0).map((d) => countOf(m.counts[d]!, d));
  const gaps = m.counts.luecke ?? 0;
  return parts.join(", ") + (gaps ? `; dazu ${gaps === 1 ? "eine Lücke" : `${gaps} Lücken`}` : "") + ".";
}

/**
 * Idea 9: the consultation report as one printable document. Everything but
 * the Befunde is assembled from the data by fixed rules — the summary and the
 * recommendation are templates, not model text (concept paper, Phase 4).
 */
export default async function Bericht({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const { points, analysedAt } = await loadReport(getDb(), o.id);
  const s = o.stats;
  const by = (d: Diag) => points.filter((p) => p.diag === d);
  const kerns = by("kern").sort(bySplit);
  const values = by("wert");
  const facts = by("klaerbar");
  const evidence = await loadEvidence(getDb(), o.id);
  const factsEvidenced = facts.filter((p) => (evidence.get(p.id)?.evidenced ?? 0) > 0).length;
  const designs = by("gestaltung");
  const bridges = by("bruecke");
  const warnings = by("warnung");
  const gaps = by("luecke");
  const open = by("offen");
  const sameBridges = bridges.filter((p) => p.reasons === "same_reasons");
  const unclearBridges = bridges.filter((p) => p.reasons === "unclear");
  const [campA, campB] = o.camps;
  const measureOf = (p: MapPoint) => o.measures.find((m) => m.scope === p.scope)?.display ?? p.scope;
  const counts = (p: MapPoint) => campCountsText(p.votes, o.camps);

  const verdicts = VERDICT_ORDER.map((key) => ({ key, measures: o.measures.filter((m) => m.verdict.key === key) })).filter((v) => v.measures.length > 0);

  // The recommendation in the paper's form, from the counts (no model text).
  const valueSubject =
    kerns.length && values.length
      ? `${the(kerns.length, "Kernkonflikt", "Kernkonflikte", "der")} und ${values.length === 1 ? "die weitere Wertfrage" : `die ${values.length} weiteren Wertfragen`}`
      : kerns.length
        ? the(kerns.length, "Kernkonflikt", "Kernkonflikte", "der")
        : the(values.length, "Wertfrage", "Wertfragen", "die");
  const valuePlural = kerns.length + values.length > 1;
  const recFirst = [
    facts.length ? `Vor der Ressortabstimmung ${the(facts.length, "Tatsachenfrage", "Tatsachenfragen", "die")} durch Kurzgutachten oder Daten klären` : null,
    kerns.length + values.length
      ? `${facts.length ? valueSubject : valueSubject.charAt(0).toUpperCase() + valueSubject.slice(1)} ${valuePlural ? "gehören" : "gehört"} auf die politische Leitungsebene, nicht auf die Fachebene`
      : null,
  ].filter(Boolean);
  const buildOn = sameBridges.length ? sameBridges : bridges;
  const recSecond = [
    designs.length
      ? `Über ${designs.length === 1 ? "die Gestaltungsfrage" : `die ${designs.length} Gestaltungsfragen`} lässt sich auf der Fachebene verhandeln`
      : null,
    buildOn.length
      ? `bauen lässt sich auf ${buildOn.length === 1 ? "eine Brücke" : `${buildOn.length} Brücken`}${sameBridges.length ? ", die beide Lager aus denselben Gründen tragen" : ""}`
      : null,
  ].filter(Boolean) as string[];
  if (recSecond.length && !designs.length) recSecond[0] = recSecond[0]!.charAt(0).toUpperCase() + recSecond[0]!.slice(1);

  const toc = [
    { id: "zusammenfassung", title: "Zusammenfassung und Empfehlung" },
    { id: "wertfragen", title: "Wertfragen für die Leitungsebene" },
    { id: "tatsachen", title: "Tatsachenfragen für Gutachten" },
    { id: "gestaltung", title: "Gestaltungsfragen zum Verhandeln" },
    { id: "bruecken", title: "Brücken: worin die Lager übereinstimmen" },
    { id: "luecken", title: "Lücken: was niemand gefragt hat" },
    { id: "teilentscheidungen", title: "Die Teilentscheidungen im Überblick" },
  ];

  return (
    <article className="rep-doc">
      <header className="rep-head">
        <p className="crumbs no-print">
          <a href={base}>Lagebild</a> / Bericht zum Drucken
        </p>
        <p className="rep-kicker-title">Bericht zur {o.procedure}</p>
        <h1>{o.title}</h1>
        <dl className="rep-meta">
          <div>
            <dt>Erstellt am</dt>
            <dd>{fmtDate(new Date())}</dd>
          </div>
          {analysedAt ? (
            <div>
              <dt>Stand der Auswertung</dt>
              <dd>{fmtDate(analysedAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Grundlage</dt>
            <dd>
              {s.statements} Stellungnahmen, rund {nf.format(s.pages)} Seiten
            </dd>
          </div>
        </dl>
        <p className="rep-motto">Dieser Bericht sagt nicht, wie viele dafür waren. Er sagt, was noch zu klären ist und von wem.</p>
        <div className="rep-method">
          <p>
            <strong>Wie dieser Bericht entsteht.</strong> Die Stellungnahmen wurden in einzelne Argumente zerlegt und zu Streitfragen verdichtet. Wie jede
            Organisation zu jeder Streitfrage steht, hat ein Prüfmodell (Jev) aus dem Text ihrer Stellungnahme abgeleitet; abgegeben hat sie diese Voten nicht
            selbst. Ob eine Streitfrage eine Tatsache, eine Wertung oder die Ausgestaltung betrifft, ordnen Sprachmodell und Jev ein. Lager und Diagnosen sind
            daraus nach festen Regeln gerechnet; nur ob beide Lager einer Brücke aus denselben Gründen zustimmen, prüft ein Sprachmodell. Die Befunde zu den
            einzelnen Streitfragen hat ein Sprachmodell formuliert; es durfte die gerechnete Diagnose nicht ändern. Zusammenfassung und Empfehlung dieses
            Berichts sind ohne Sprachmodell aus den Daten zusammengesetzt.{" "}
            <a className="no-print" href={`${base}/methode`}>
              Wie die Karte entsteht
            </a>
          </p>
        </div>
        <div className="rep-tools">
          <PrintButton />
        </div>
        <nav className="rep-toc" aria-label="Inhalt">
          <p className="rep-toc-title">Inhalt</p>
          <ol>
            {toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <Section
        id="zusammenfassung"
        n={1}
        title="Zusammenfassung und Empfehlung"
        lead={
          <>
            <p>
              {s.statements} Organisationen haben zum Entwurf Stellung genommen, zusammen rund {nf.format(s.pages)} Seiten. Daraus wurden {nf.format(s.points)}{" "}
              einzelne Argumente, verdichtet zu {nf.format(s.mapPoints)} Streitfragen in {o.measures.length} Teilentscheidungen.
              {gaps.length ? ` Dazu kommen ${gaps.length === 1 ? "eine kritische Frage" : `${gaps.length} kritische Fragen`}, die niemand gestellt hat.` : ""}
            </p>
            {campA && campB ? (
              <p>
                Wer ähnlich Stellung nimmt, bildet ein Lager. Aus den Voten ergeben sich zwei: „{campA.name}“ mit {campA.size} Organisationen (
                {campA.orgs.map(shortOrg).join(", ")}) und „{campB.name}“ mit {campB.size} (
                {campB.orgs.map(shortOrg).join(", ")}).
              </p>
            ) : null}
            <p>
              Von den {nf.format(s.mapPoints)} Streitfragen sind {countOf(kerns.length + values.length, "wert")}
              {kerns.length ? ` (davon ${countOf(kerns.length, "kern")})` : ""}, {countOf(facts.length, "klaerbar")} und {countOf(designs.length, "gestaltung")}.
              Bei {countOf(bridges.length, "bruecke")} stimmen beide Lager zu
              {warnings.length ? `, bei ${countOf(warnings.length, "warnung")} nur scheinbar, aus unvereinbaren Gründen` : ""}. Bei{" "}
              {open.length === 1 ? "einer Frage" : `${nf.format(open.length)} Fragen`} haben sich aus einem Lager zu wenige Organisationen geäußert, um etwas zu
              sagen.
            </p>
          </>
        }
      >
        <h3>Die Teilentscheidungen nach Art des Streits</h3>
        <ul className="rep-verdicts">
          {verdicts.map((v) => (
            <li key={v.key}>
              <span className={`lk-diag lk-tone-${v.measures[0]!.verdict.tone}`}>{v.measures[0]!.verdict.title}</span>{" "}
              <span className="rep-where">({v.measures.length}):</span>{" "}
              {v.measures.map((m, i) => (
                <span key={m.slug}>
                  {i > 0 ? "; " : ""}
                  <a href={`#m-${m.slug}`}>{m.display}</a>
                </span>
              ))}
            </li>
          ))}
        </ul>

        <h3>Empfehlung</h3>
        <p className="rep-rec">
          {recFirst.length ? `${recFirst.join("; ")}.` : null}
          {recSecond.length ? ` ${recSecond.join(", und ")}.` : null}
          {gaps.length
            ? ` ${gaps.length === 1 ? "Eine kritische Frage hat" : `${gaps.length} kritische Fragen hat`} niemand gestellt: Dort sollte man aktiv nachfragen.`
            : null}
        </p>
        <ol className="rep-recs">
          {facts.length ? (
            <li>
              <p>
                <strong>Durch Gutachten klären, vor der Ressortabstimmung.</strong> Zuerst die Tatsachenfragen, bei denen die Lager am weitesten auseinanderliegen,
                aus jeder Teilentscheidung die schärfste:
              </p>
              <ul>
                {spread(facts, REC_FACTS, bySplit).map((p) => (
                  <RecItem key={p.id} p={p} label={p.question ?? p.text} where={measureOf(p)} />
                ))}
              </ul>
            </li>
          ) : null}
          {kerns.length ? (
            <li>
              <p>
                <strong>Auf die politische Leitungsebene.</strong> Die Kernkonflikte, je Teilentscheidung die Wertfrage, bei der die Lager am weitesten
                auseinanderliegen:
              </p>
              <ul>
                {kerns.map((p) => (
                  <RecItem key={p.id} p={p} label={p.text} where={measureOf(p)} counts={counts(p)} />
                ))}
              </ul>
            </li>
          ) : null}
          {designs.length ? (
            <li>
              <p>
                <strong>Auf der Fachebene verhandeln.</strong> Die Gestaltungsfragen, bei denen die Lager am weitesten auseinanderliegen:
              </p>
              <ul>
                {spread(designs, REC_DESIGN, bySplit).map((p) => (
                  <RecItem key={p.id} p={p} label={p.text} where={measureOf(p)} counts={counts(p)} />
                ))}
              </ul>
            </li>
          ) : null}
          {buildOn.length ? (
            <li>
              <p>
                <strong>Darauf bauen.</strong> Die breitesten Brücken
                {sameBridges.length ? ", bei denen die Prüfung der Begründungen dieselben Gründe in beiden Lagern fand" : ""}:
              </p>
              <ul>
                {spread(buildOn, REC_BRIDGES, byBreadth).map((p) => (
                  <RecItem key={p.id} p={p} label={p.text} where={measureOf(p)} counts={counts(p)} />
                ))}
              </ul>
            </li>
          ) : null}
          {gaps.length ? (
            <li>
              <p>
                <strong>Nachfragen.</strong> Diese kritischen Fragen hat in der {o.procedure} niemand gestellt:
              </p>
              <ul>
                {groupByMeasure(gaps, o.measures)
                  .flatMap((g) => g.points)
                  .map((p) => (
                    <RecItem key={p.id} p={p} label={gapQuestion(p)} where={measureOf(p)} />
                  ))}
              </ul>
            </li>
          ) : null}
        </ol>
      </Section>

      <Section
        id="wertfragen"
        n={2}
        title="Wertfragen für die Leitungsebene"
        lead={
          <p>
            Hier trennt die Lager eine Wertung. Keine Studie kann das entscheiden, nur die Politik. Ein Kernkonflikt ist die Wertfrage, bei der die Lager in einer
            Teilentscheidung am weitesten auseinanderliegen; er steht jeweils zuerst. Zusammen{" "}
            {countOf(kerns.length + values.length, "wert")}, davon {countOf(kerns.length, "kern")}.
          </p>
        }
      >
        <Groups
          groups={groupByMeasure([...kerns, ...values], o.measures, (a, b) => Number(b.diag === "kern") - Number(a.diag === "kern") || bySplit(a, b))}
          base={base}
          camps={o.camps}
        />
        {kerns.length + values.length === 0 ? <p className="rep-empty">Keine Wertfrage trennt die Lager.</p> : null}
      </Section>

      <Section
        id="tatsachen"
        n={3}
        title="Tatsachenfragen für Gutachten"
        lead={
          <p>
            Hier trennt die Lager eine Frage, die sich mit Daten, Gutachten oder Vergleichsfällen klären lässt. Das ist der günstigste Streit: Wer ihn vor der
            Ressortabstimmung klärt, nimmt ihn aus dem politischen Streit. Bei {factsEvidenced} dieser Fragen nennen Stellungnahmen bereits Belege, und ein
            Lager glaubt sie trotzdem nicht: Dort fehlt eher Vermittlung als ein Gutachten. Zusammen {countOf(facts.length, "klaerbar")}, in jeder Teilentscheidung zuerst die, bei denen die Lager am weitesten auseinanderliegen.{" "}
            <a className="no-print" href={`${base}/gutachten`}>
              Als Arbeitsliste: die Gutachten-Agenda
            </a>
          </p>
        }
      >
        <Groups groups={groupByMeasure(facts, o.measures, bySplit)} base={base} camps={o.camps} />
        {facts.length === 0 ? <p className="rep-empty">Keine Tatsachenfrage trennt die Lager.</p> : null}
      </Section>

      <Section
        id="gestaltung"
        n={4}
        title="Gestaltungsfragen zum Verhandeln"
        lead={
          <p>
            Hier streiten die Lager nicht über das Ob, sondern über das Wie: Fristen, Grenzen, Ausnahmen. Solche Fragen lassen sich auf der Fachebene verhandeln.
            Zusammen {countOf(designs.length, "gestaltung")}, in jeder Teilentscheidung zuerst die strittigsten.
          </p>
        }
      >
        <Groups groups={groupByMeasure(designs, o.measures, bySplit)} base={base} camps={o.camps} />
        {designs.length === 0 ? <p className="rep-empty">Über die Ausgestaltung streiten die Lager nicht.</p> : null}
      </Section>

      <Section
        id="bruecken"
        n={5}
        title="Brücken: worin die Lager übereinstimmen"
        lead={
          <p>
            Bei einer Brücke stimmen beide Lager zu. Ob sie es aus denselben Gründen tun, zeigt eine Prüfung der Begründungen: Nur dann trägt die Einigkeit auch
            bei Detailfragen. Von den {countOf(bridges.length, "bruecke")} stützen sich laut dieser Prüfung {sameBridges.length} auf dieselben Gründe
            {unclearBridges.length ? `, bei ${unclearBridges.length} ist das nicht eindeutig` : ""}
            {bridges.length - sameBridges.length - unclearBridges.length
              ? `, ${bridges.length - sameBridges.length - unclearBridges.length} waren für die Prüfung zu dünn belegt`
              : ""}
            . In jeder Teilentscheidung steht die breiteste Zustimmung zuerst.
          </p>
        }
      >
        <Groups groups={groupByMeasure(bridges, o.measures, byBreadth)} base={base} camps={o.camps} note={reasonsNote} />
        {bridges.length === 0 ? <p className="rep-empty">Es gibt keine Brücke zwischen den Lagern.</p> : null}
        <h3 className="rep-sub">Scheinbrücken: Einigkeit aus unvereinbaren Gründen</h3>
        {warnings.length ? (
          <>
            <p className="rep-lead">
              Beide Lager stimmen zu, aber aus Gründen, die sich nicht vertragen. Eine Entscheidung, die sich auf diese Einigkeit stützt, bricht bei der ersten
              Detailfrage.
            </p>
            <Groups groups={groupByMeasure(warnings, o.measures, byBreadth)} base={base} camps={o.camps} note={reasonsNote} />
          </>
        ) : (
          <p className="rep-lead">
            {sameBridges.length + unclearBridges.length
              ? "Die Prüfung der Begründungen hat keine Scheinbrücke gefunden: Bei keiner geprüften Brücke stimmen die Lager aus unvereinbaren Gründen zu."
              : "Keine Brücke war ausreichend belegt, um ihre Begründungen zu prüfen."}
          </p>
        )}
      </Section>

      <Section
        id="luecken"
        n={6}
        title="Lücken: was niemand gefragt hat"
        lead={
          <p>
            Jeder Einwand kommt durch eine von fünf kritischen Fragen: ob die Wirkung eintritt, ob ein anderes Mittel besser wäre, ob ein anderes Ziel leidet, ob
            es sich umsetzen lässt und ob der Wert den Preis rechtfertigt. Die folgenden hat in der {o.procedure} zu der jeweiligen Teilentscheidung niemand gestellt.
            Das kann die wichtigste Erkenntnis sein: Hier sollte man aktiv nachfragen.
          </p>
        }
      >
        <Groups groups={groupByMeasure(gaps, o.measures)} base={base} camps={o.camps} text={gapQuestion} />
        {gaps.length === 0 ? <p className="rep-empty">Zu jeder Teilentscheidung wurden alle fünf kritischen Fragen gestellt.</p> : null}
      </Section>

      <Section
        id="teilentscheidungen"
        n={7}
        title="Die Teilentscheidungen im Überblick"
        lead={
          <p>
            Der Entwurf zerfällt in einzelne Maßnahmen, über die getrennt entschieden werden kann. Für jede: welcher Art der Streit ist, wer handeln muss, und
            woraus das gerechnet ist.
          </p>
        }
      >
        {o.measures.map((m) => (
          <article key={m.slug} id={`m-${m.slug}`} className="rep-mentry">
            <h3 className="rep-measure">
              <a href={`${base}/massnahmen/${m.slug}`}>{m.display}</a>
            </h3>
            {m.description ? (
              <p className="rep-desc">
                {m.description}
                {m.paragraphs.length ? ` (§ ${m.paragraphs.join(", ")})` : ""}
              </p>
            ) : null}
            <p className="rep-verdict">
              <span className={`lk-diag lk-tone-${m.verdict.tone}`}>{m.verdict.title}.</span> {m.verdict.text}
            </p>
            <p className="rep-counts">
              {m.points} Streitfragen aus {nf.format(m.extractionPoints)} Argumenten, {m.withNumbers} davon mit Stimmen aus beiden Lagern. {diagCountsLine(m)}
            </p>
            {m.kern ? (
              <p className="rep-counts">
                Kernkonflikt: <a href={`#p-${m.kern.id}`}>{m.kern.label}</a>
              </p>
            ) : null}
          </article>
        ))}
      </Section>
    </article>
  );
}
