import { DIAG, membersText, nf, sendersText } from "@policy/landkarte";
import { breadth, gap, loadAllMapPoints, type MapPoint } from "@policy/landkarte/data";
import { loadEvidence } from "@policy/landkarte/data/evidence";

import { Verdichtung } from "@/components/Verdichtung";
import { FindingRow, Row, Strip } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

const TOP = 5;

export default async function Lagebild({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const all = await loadAllMapPoints(getDb(), o.id);
  const evidence = await loadEvidence(getDb(), o.id);
  const ev = (p: MapPoint) => evidence.get(p.id)?.evidenced ?? 0;
  const by = (...d: string[]) => all.filter((p) => p.diag && d.includes(p.diag));
  const kerns = by("kern").sort((a, b) => gap(b) - gap(a));
  const values = by("wert");
  const facts = by("klaerbar").sort((a, b) => gap(b) - gap(a));
  const designs = by("gestaltung").sort((a, b) => gap(b) - gap(a));
  const bridges = by("bruecke").sort((a, b) => breadth(b) - breadth(a));
  const warnings = by("warnung");
  // The paper's most dangerous case: a fact both camps believe that nobody backs with evidence.
  const unproven = all.filter((p) => p.typ === "T" && p.diag === "bruecke" && evidence.has(p.id) && ev(p) === 0).sort((a, b) => breadth(b) - breadth(a));
  const factsMediation = facts.filter((p) => ev(p) > 0).length;
  const evidencedTotal = [...evidence.values()].reduce((s2, x) => s2 + x.evidenced, 0);
  const sourcesTotal = [...evidence.values()].reduce((s2, x) => s2 + x.sources, 0);
  const gaps = by("luecke");
  const s = o.stats;

  const section = (title: string, lead: string, points: MapPoint[], more?: { href: string; label: string }) =>
    points.length === 0 ? null : (
      <section>
        <h2>{title}</h2>
        <p className="prose">{lead}</p>
        {points.slice(0, TOP).map((p) => (
          <FindingRow key={p.id} p={p} base={base} camps={o.camps} />
        ))}
        {more && points.length > TOP ? (
          <p className="small">
            <a href={more.href}>{more.label}</a>
          </p>
        ) : null}
      </section>
    );

  return (
    <>
      <header className="page-head">
        <p className="crumbs">Lagebild</p>
        <h1>Was die {o.procedure} ergibt</h1>
        <p className="lead">
          {sendersText(o.stats)} haben zum Entwurf Stellung genommen, zusammen rund {nf.format(s.pages)} Seiten. Daraus
          wurden {nf.format(s.points)} einzelne Argumente, verdichtet zu {nf.format(s.mapPoints)} Streitfragen in {o.measures.length}{" "}
          Teilentscheidungen. Dieses Lagebild sagt nicht, wie viele dafür waren. Es sagt, was noch zu klären ist und von wem.
        </p>
      </header>

      <Verdichtung
        orgs={o.orgs.map((x) => ({ short: x.short, chars: x.chars, points: x.points, camp: o.camps.find((c) => c.group === x.camp)?.side ?? null }))}
        measures={o.measures.map((m) => ({ display: m.display, points: m.points, extraction: m.extractionPoints, counts: m.counts }))}
        stats={{ pages: s.pages, points: s.points, mapPoints: s.mapPoints, statements: s.statements }}
        camps={o.camps.map((c) => ({ name: c.name, size: c.size, side: c.side }))}
      />

      <section className="recommend" aria-label="Empfehlung">
        <h2>Empfehlung</h2>
        <ol>
          <li>
            <strong>Vor der Ressortabstimmung klären:</strong> {facts.length - factsMediation} Tatsachenfragen, zu denen niemand Belege nennt, per Kurzgutachten
            oder Daten{factsMediation ? `; bei ${factsMediation} weiteren liegen Belege vor, dort hilft Vermittlung` : ""}.{" "}
            <a href={`${base}/gutachten`}>Zur Gutachten-Agenda</a>
          </li>
          <li>
            <strong>Auf die Leitungsebene:</strong> {kerns.length} Kernkonflikte, etwa „{kerns[0]?.label}“, und {values.length} weitere Wertfragen. Hier hilft keine
            Studie mehr, hier muss entschieden werden.
          </li>
          <li>
            <strong>Verhandeln:</strong> {designs.length} Fragen der Ausgestaltung (Fristen, Grenzen, Ausnahmen), etwa „{designs[0]?.label}“.
          </li>
          <li>
            <strong>Darauf bauen:</strong> {bridges.length} Brücken, die beide Lager aus denselben Gründen tragen, etwa „{bridges[0]?.label}“.
          </li>
          {unproven.length ? (
            <li>
              <strong>Nachfragen:</strong> {unproven.length} Tatsachen, die alle glauben, aber niemand belegt, und {gaps.length} kritische Fragen, die niemand
              gestellt hat.
            </li>
          ) : null}
        </ol>
      </section>

      {section(
        `Für die Leitungsebene: ${kerns.length + values.length} Wertfragen`,
        `In ${kerns.length} Teilentscheidungen gibt es einen Kernkonflikt: eine Wertung, bei der die Lager am weitesten auseinanderliegen. Keine Studie kann sie entscheiden. Weitere ${values.length} Wertfragen trennen die Lager weniger scharf.`,
        kerns,
        { href: `${base}/bericht#wertfragen`, label: `Alle ${kerns.length + values.length} Wertfragen im Bericht` },
      )}
      {section(
        `Für Gutachten: ${facts.length} Tatsachenfragen`,
        "Hier trennt die Lager eine Frage, die sich mit Daten, Gutachten oder Vergleichsfällen klären lässt. Wer sie vor der Ressortabstimmung klärt, nimmt sie aus dem politischen Streit.",
        facts,
        { href: `${base}/gutachten`, label: `Alle ${facts.length} in der Gutachten-Agenda` },
      )}
      {section(
        `Verhandlungssache: ${designs.length} Gestaltungsfragen`,
        "Über das Ob wird hier wenig gestritten, über das Wie: Fristen, Grenzen, Ausnahmen. Solche Fragen lassen sich verhandeln.",
        designs,
        { href: `${base}/bericht#gestaltung`, label: `Alle ${designs.length} Gestaltungsfragen im Bericht` },
      )}
      {section(
        `Darauf lässt sich bauen: ${bridges.length} Brücken`,
        "Beide Lager stimmen zu, und eine Prüfung der Begründungen zeigt: aus denselben Gründen. Hier lässt sich mit breiter Unterstützung entscheiden.",
        bridges,
        { href: `${base}/bericht#bruecken`, label: `Alle ${bridges.length} Brücken im Bericht` },
      )}
      {section(
        `Geglaubt, aber unbelegt: ${unproven.length} Tatsachen`,
        `Beide Lager halten diese Tatsachen für richtig, aber keine Stellungnahme belegt sie mit Daten, Studien oder anderen Quellen. Das Konzept nennt das den gefährlichsten Fall, weil niemand nachfragt. Insgesamt nennen nur ${evidencedTotal} von ${nf.format(sourcesTotal)} zitierten Textstellen überhaupt Belege.`,
        unproven,
        { href: `${base}/gutachten`, label: "Zur Gutachten-Agenda" },
      )}
      {warnings.length > 0
        ? section(
            `Vorsicht: ${warnings.length} Scheinbrücken`,
            "Beide Lager stimmen zu, aber aus unvereinbaren Gründen. Eine Entscheidung, die sich auf diese Einigkeit stützt, bricht bei der ersten Detailfrage.",
            warnings,
          )
        : null}
      {gaps.length > 0 ? (
        <section>
          <h2>Niemand hat gefragt: {gaps.length} Lücken</h2>
          <p className="prose">
            Jeder Einwand kommt durch eine von fünf kritischen Fragen. Diese hat in der {o.procedure} zu der jeweiligen Teilentscheidung niemand gestellt. Das kann die
            wichtigste Erkenntnis sein: Hier sollte man aktiv nachfragen.
          </p>
          {gaps.map((p) => (
            <Row key={p.id} margin={<span className="lk-diag lk-tone-open">{DIAG.luecke.label}</span>}>
              <p className="row-title">
                <a href={`${base}/massnahmen/${o.measures.find((m) => m.scope === p.scope)?.slug}`}>
                  {o.measures.find((m) => m.scope === p.scope)?.display}
                </a>
              </p>
              <p className="row-text">{p.text.replace(/ — Diese kritische Frage hat im Verfahren niemand gestellt\.$/, "")}</p>
            </Row>
          ))}
        </section>
      ) : null}

      <section>
        <h2>Die {o.measures.length} Teilentscheidungen</h2>
        <p className="prose">
          Der Entwurf zerfällt in einzelne Maßnahmen, über die getrennt entschieden werden kann. Für jede zeigt die Landkarte, welcher Art der Streit ist.
        </p>
        {o.measures.map((m) => (
          <Row
            key={m.slug}
            margin={
              <>
                <Strip m={m} />
                <div>
                  {m.points} Streitfragen aus {nf.format(m.extractionPoints)} Argumenten
                </div>
                {m.kern ? <div>Kernkonflikt: {m.kern.label}</div> : null}
              </>
            }
          >
            <p className="row-title">
              <a href={`${base}/massnahmen/${m.slug}`}>{m.display}</a>
            </p>
            <p className="row-text">
              <span className={`lk-diag lk-tone-${m.verdict.tone}`}>{m.verdict.title}.</span> {m.verdict.text}
            </p>
          </Row>
        ))}
      </section>

      <section>
        <h2>{o.otherCamps.length ? "Die Lager" : "Die beiden Lager"}</h2>
        <p className="prose">
          Wer ähnlich Stellung nimmt, bildet ein Lager. Gerechnet wird das aus den Voten zu allen Streitfragen, nicht aus Verbandszugehörigkeit.
        </p>
        {o.camps.map((c) => (
          <Row
            key={c.group}
            margin={
              <>
                <div>{sendersText({ statements: c.size, privatePersons: c.people })}</div>
                {c.size <= 40 ? (
                  <div className={`lk-voices lk-side-${c.side}`} style={{ display: "block" }}>
                    <span className="lk-voices-dots">
                      {Array.from({ length: c.size }, (_, i) => (
                        <i key={i} className="lk-dot lk-dot-agree" />
                      ))}
                    </span>
                  </div>
                ) : null}
              </>
            }
          >
            <p className="row-title">{c.name}</p>
            {c.summary ? <p className="row-text">{c.summary}</p> : null}
            <p className="small muted" style={{ marginTop: "0.4rem" }}>
              {membersText(c, (n) => n, 15)}
            </p>
          </Row>
        ))}
        {o.otherCamps.map((c) => (
          <Row
            key={c.group}
            margin={
              <>
                <div>{sendersText({ statements: c.size, privatePersons: c.people })}</div>
                <div className="muted">Kleinere dritte Gruppe: Die Diagnosen vergleichen die beiden großen Lager, diese Gruppe fließt dort nicht ein.</div>
              </>
            }
          >
            <p className="row-title">{c.name}</p>
            {c.summary ? <p className="row-text">{c.summary}</p> : null}
            <p className="small muted" style={{ marginTop: "0.4rem" }}>
              {membersText(c, (n) => n, 15)}
            </p>
          </Row>
        ))}
      </section>
    </>
  );
}
