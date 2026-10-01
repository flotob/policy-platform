import { notFound } from "next/navigation";

import { DIAG, DOOR, DiagLabel, QuoteBlock, shortOrg, slugOf, TYP, TypTag } from "@policy/landkarte";
import { loadPoint, type MemberTrail, type OrgVote } from "@policy/landkarte/data";
import { EVIDENCE_LABEL, evidenceVerdict } from "@policy/landkarte/data/evidence";

import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

const pct = (x: number | null | undefined) => (x == null ? "" : `${Math.round(x * 100)} %`);

/** "Ein Argument hier stützt „X“" */
const REL_OUT: Record<string, string> = {
  supports: "stützt",
  empirics: "bestreitet die Wirkung von",
  alternatives: "nennt eine Alternative zu",
  goal_conflict: "sieht einen Zielkonflikt mit",
  feasibility: "bezweifelt die Machbarkeit von",
  value_conflict: "stellt den Wert in Frage von",
};
/** "„X“ stützt diese Streitfrage" */
const REL_IN: Record<string, string> = {
  supports: "stützt diese Streitfrage",
  empirics: "bestreitet ihre Wirkung",
  alternatives: "nennt eine Alternative dazu",
  goal_conflict: "sieht einen Zielkonflikt mit ihr",
  feasibility: "bezweifelt ihre Machbarkeit",
  value_conflict: "stellt ihren Wert in Frage",
};

const ACTION: Record<string, string> = {
  split: "in mehrere Argumente geteilt",
  rewrite: "umformuliert",
  keep: "geprüft und unverändert gelassen",
  drop: "verworfen",
};

const FLAG: Record<string, string> = {
  several_claims: "mehrere Behauptungen in einem Satz",
  mixed_fact_value: "Tatsache und Wertung vermischt",
  not_standalone: "ohne Kontext nicht verständlich",
  not_neutral: "nicht neutral formuliert",
  personal_data: "personenbezogene Angaben",
  meta: "Bemerkung über das Verfahren",
  off_topic: "nicht zum Thema",
  role_uncertain: "Rolle im Argument unsicher",
  demand_as_claim: "Forderung als Behauptung formuliert",
  fact_value_uncertain: "Tatsache oder Wertung unsicher",
};

function VoteList({ votes, side, name }: { votes: OrgVote[]; side: "a" | "b"; name: string }) {
  return (
    <div className={`lk-voices lk-side-${side}`} style={{ display: "block", marginBottom: "0.6rem" }}>
      <strong className="small">{name}</strong>
      <ul className="votelist">
        {votes.map((v) => (
          <li key={v.org.submissionId}>
            <i className={`lk-dot lk-dot-${v.value === 1 ? "agree" : v.value === -1 ? "disagree" : "silent"}`} aria-hidden />
            <span>{v.org.short}</span>
            <span className="muted">{v.value === 1 ? "stimmt zu" : v.value === -1 ? "lehnt ab" : "äußert sich nicht"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trail({ m, base }: { m: MemberTrail; base: string }) {
  const steps: string[] = [];
  if (m.created) steps.push(`Aus der Stellungnahme von ${m.created.org} zerlegt (Sprachmodell${m.created.model ? `, ${m.created.model}` : ""}).`);
  if (m.intake) {
    const flags = m.intake.flagsBefore.map((f) => FLAG[f] ?? f);
    if (m.intake.action && m.intake.action !== "keep") {
      steps.push(
        `Automatische Prüfung (Jev) fand: ${flags.join(", ") || "Nachbesserungsbedarf"}. Die maschinelle Redaktion hat das Argument ${ACTION[m.intake.action] ?? m.intake.action}${m.intake.reason ? `: „${m.intake.reason}“` : "."}`,
      );
    } else {
      steps.push(`Automatische Prüfung (Jev): ${flags.length ? `geprüft, Hinweise: ${flags.join(", ")}` : "ohne Beanstandung"}.`);
    }
  }
  if (m.matched.length) {
    steps.push(
      `Abgleich (Jev): dasselbe Argument auch bei ${m.matched.map((x) => `${x.org}${x.pSame != null ? ` (${pct(x.pSame)} sicher)` : ""}`).join(", ")}.`,
    );
  } else if (m.created) {
    steps.push("Abgleich (Jev): als neues Argument erkannt, keine andere Stellungnahme sagt dasselbe.");
  }
  if (m.measure) {
    steps.push(
      m.measure.secondOpinion
        ? `Maßnahme: Jev war unsicher (${pct(m.measure.confidence)}); das Sprachmodell hat entschieden: „${m.measure.secondOpinion.measure}“.`
        : `Maßnahme zugeordnet (Jev, ${pct(m.measure.confidence)} sicher).`,
    );
  } else {
    steps.push("Maßnahme zugeordnet über den genannten Paragraphen (Regel, keine KI).");
  }
  if (m.mapAssign) steps.push(`Dieser Streitfrage zugeordnet (Jev, ${pct(m.mapAssign.confidence)} sicher).`);
  return (
    <details className="trail">
      <summary>
        <span>{m.label}</span>
        <span className="muted small"> {m.sources.map((s) => shortOrg(s.org)).join(", ")}</span>
      </summary>
      {m.summary ? <p className="row-text">{m.summary}</p> : null}
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {m.sources.map((s, i) =>
        s.quote ? (
          <blockquote key={i} className="lk-quote">
            <p>„{s.quote}“</p>
            <footer>
              <a href={`${base}/organisationen/${s.submissionId}`}>{s.org}</a>
            </footer>
          </blockquote>
        ) : null,
      )}
    </details>
  );
}

export default async function Punkt({ params }: { params: Promise<{ ref: string; id: string }> }) {
  const { ref, id } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const d = await loadPoint(getDb(), o.id, id);
  if (!d) notFound();
  const { point: p, measure } = d;
  const campOf = (side: "a" | "b") => o.camps.find((c) => c.side === side);
  const votesOf = (side: "a" | "b") => d.votes.filter((v) => v.org.camp === campOf(side)?.group);
  const diag = DIAG[p.diag ?? "offen"];

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / <a href={`${base}/massnahmen/${measure.slug}`}>{measure.display}</a> / Streitfrage
        </p>
        {p.question ? <p className="lead" style={{ fontSize: "1.0625rem", marginBottom: "0.5rem" }}>{p.question}</p> : null}
        <h1 style={{ maxWidth: "30ch", fontSize: "1.9375rem" }}>{p.text}</h1>
        <p style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", margin: 0 }}>
          <DiagLabel diag={p.diag} />
          <TypTag typ={p.typ} />
          <span className="small muted">{TYP[p.typ].explain}</span>
        </p>
      </header>

      <div className="three">
        <section>
          <h3>Wer es für richtig hält</h3>
          {(["a", "b"] as const).map((side) => (
            <VoteList key={side} votes={votesOf(side)} side={side} name={campOf(side)?.name ?? ""} />
          ))}
          <p className="small muted">Abgeleitet aus dem Text der Stellungnahmen (Jev), nicht abgestimmt.</p>
        </section>
        <section>
          <h3>Was belegt ist und was folgt</h3>
          <p className="small">
            <strong>{diag.label}.</strong> {diag.explain}
          </p>
          {p.reasons ? (
            <p className="small">
              Begründungs-Check:{" "}
              {p.reasons === "same_reasons"
                ? "Die sichtbaren Gründe beider Lager weisen in dieselbe Richtung."
                : p.reasons === "diverging_reasons"
                  ? "Die Lager stimmen aus unvereinbaren Gründen zu."
                  : "Die Gründe sind aus dem Material nicht zu erkennen."}
              {p.reasonsRationale ? <span className="muted"> {p.reasonsRationale}</span> : null}
            </p>
          ) : null}
          {(() => {
            const all = d.members.flatMap((m) => m.sources);
            const judged = all.filter((x) => x.evidence !== null);
            const ev = judged.filter((x) => x.evidence && x.evidence !== "none");
            if (judged.length === 0) return <p className="small muted">Ob Belege vorliegen, ist für diese Streitfrage noch nicht ausgewertet.</p>;
            const verdict = evidenceVerdict(p.typ, p.diag, ev.length);
            return (
              <>
                <p className="small">
                  <strong>Belege:</strong>{" "}
                  {ev.length === 0
                    ? `Keine der ${judged.length} zitierten Textstellen nennt Daten, Studien oder andere Belege.`
                    : `${ev.length} von ${judged.length} zitierten Textstellen nennen Belege: ${[...new Set(ev.map((x) => EVIDENCE_LABEL[x.evidence!]))].join(", ")} (${[...new Set(ev.map((x) => shortOrg(x.org)))].join(", ")}).`}
                </p>
                {verdict ? <p className="small">{verdict}</p> : null}
              </>
            );
          })()}
        </section>
        <section>
          <h3>Woher es stammt</h3>
          <p className="small">
            {p.members} {p.members === 1 ? "Argument" : "Argumente"} aus {p.orgs} {p.orgs === 1 ? "Stellungnahme" : "Stellungnahmen"}
          </p>
          {p.quotes.slice(0, 2).map((q, i) => (
            <QuoteBlock key={i} quote={q} />
          ))}
        </section>
      </div>

      {p.befund ? (
        <>
          <h2>Befund</h2>
          <Row margin={<span>Das Ergebnis ist gerechnet; das Sprachmodell hat es nur ausformuliert und darf es nicht ändern.</span>}>
            <p className="prose" style={{ margin: 0 }}>{p.befund}</p>
          </Row>
        </>
      ) : null}

      {d.related.length > 0 ? (
        <>
          <h2>Wie es mit anderen Streitfragen zusammenhängt</h2>
          {d.related.slice(0, 10).map((r, i) => (
            <Row key={i} margin={<a href={`${base}/massnahmen/${slugOf(r.scope)}`}>{r.scope === "übergreifend" ? "Das Vorhaben als Ganzes" : r.scope}</a>}>
              <p className="row-text" style={{ marginTop: 0 }}>
                {r.direction === "out" ? (
                  <>
                    Ein Argument hier {REL_OUT[r.kind] ?? r.kind} <a href={`${base}/punkt/${r.mapPointId}`}>„{r.label}“</a>
                  </>
                ) : (
                  <>
                    <a href={`${base}/punkt/${r.mapPointId}`}>„{r.label}“</a> {REL_IN[r.kind] ?? r.kind}
                  </>
                )}
                {r.n > 1 ? <span className="muted"> ({r.n}-mal)</span> : null}
              </p>
            </Row>
          ))}
        </>
      ) : null}

      <h2>Prüfpfad</h2>
      <p className="prose">
        Jedes Argument unter dieser Streitfrage lässt sich bis zur Textstelle zurückverfolgen, mit jeder Entscheidung der Maschine und wie sicher sie war.
        {p.door ? ` Die meisten nehmen die ${DOOR[p.door].label} auf: ${DOOR[p.door].question}` : ""}
      </p>
      {d.members.map((m) => (
        <Trail key={m.id} m={m} base={base} />
      ))}
    </>
  );
}
