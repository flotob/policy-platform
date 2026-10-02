import { nf } from "@policy/landkarte";
import type { BillMeasure, MeasureSummary, Overview } from "@policy/landkarte/data";

import { Row } from "@/components/rows";

const argumente = (n: number) => (n === 1 ? "1 Argument" : `${nf.format(n)} Argumente`);
const streitfragen = (n: number) => (n === 1 ? "1 Streitfrage" : `${n} Streitfragen`);

/** "Handlungsfeld 3.4" → "3.4" (where the field sits in the draft). */
const fieldNo = (m: BillMeasure | undefined) => m?.other.map((x) => /(\d+(?:\.\d+)+)/.exec(x)?.[1]).find(Boolean) ?? null;

/** Heat steps relative to the most-discussed field: 1–4 = light to dark. */
function step(n: number, max: number): number {
  if (n <= 0) return 0;
  const r = n / Math.max(1, max);
  return r <= 0.15 ? 1 : r <= 0.35 ? 2 : r <= 0.6 ? 3 : 4;
}

/**
 * A draft strategy has no sections: its fields of action are the measures.
 * Field by field: what the draft plans (read from it once by the pipeline),
 * how much the statements argue about it, and the verdict of its Landkarte.
 */
export function StrategyView({
  o,
  bill,
  documents,
}: {
  o: Overview;
  bill: BillMeasure[];
  documents: { kind: string; sourceUrl: string | null }[];
}) {
  const base = `/${o.ref}`;
  const fields = bill
    .map((b) => ({ b, m: o.measures.find((m) => m.scope === b.name) }))
    .filter((f): f is { b: BillMeasure; m: MeasureSummary } => !!f.m);
  const max = Math.max(1, ...fields.map((f) => f.m.extractionPoints));
  const ranked = [...fields].sort((a, b) => b.m.extractionPoints - a.m.extractionPoints);
  const top = ranked.slice(0, 3);
  const quiet = ranked.filter((f) => f.m.extractionPoints < max * 0.1);
  const draftUrl = documents.find((d) => d.kind === "strategie:Entwurf")?.sourceUrl;
  const finalUrl = documents.find((d) => d.kind === "strategie:Endfassung")?.sourceUrl;
  const whole = o.measures.filter((m) => !bill.some((b) => b.name === m.scope));

  return (
    <div className="gz">
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Die Strategie
        </p>
        <h1>Die Strategie</h1>
        <p className="lead">
          Der Entwurf, Handlungsfeld für Handlungsfeld. Zu jedem steht, was der Entwurf dort vorhat, wie viele Argumente aus den{" "}
          {nf.format(o.stats.statements)} Stellungnahmen sich darauf beziehen und was die Auswertung dazu ergibt.
        </p>
      </header>

      <section aria-labelledby="st-overview">
        <h2 id="st-overview">Der Entwurf auf einen Blick</h2>
        <p className="prose">
          Am meisten gestritten wird über{" "}
          {top.map((f, i) => (
            <span key={f.m.slug}>
              {i > 0 ? (i === top.length - 1 ? " und " : ", ") : null}
              <a href={`#${f.m.slug}`}>{f.m.display}</a> ({argumente(f.m.extractionPoints)})
            </span>
          ))}
          .
          {quiet.length > 0
            ? ` Kaum Thema sind ${quiet.map((f) => f.m.display).join(", ")}: Dazu schreiben nur wenige Einsender etwas.`
            : null}
        </p>
        <nav className="gz-strip" aria-label="Die Handlungsfelder nach Zahl der Argumente">
          <ul className="gz-strip-cells">
            {fields.map((f) => {
              const label = `${f.m.display}: ${argumente(f.m.extractionPoints)}`;
              return (
                <li key={f.m.slug}>
                  <a href={`#${f.m.slug}`} className={`gz-cell gz-h${step(f.m.extractionPoints, max)}`} aria-label={label} title={label}>
                    {fieldNo(f.b)?.replace(/^\d+\./, "") ?? "·"}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="small muted gz-note">
          Jedes Kästchen ist ein Handlungsfeld, je dunkler, desto mehr Argumente. Wer die Strategie als Ganzes beurteilt oder etwas fordert, das in keinem
          Handlungsfeld vorkommt, steht {whole.length > 0 ? "unter " : ""}
          {whole.map((m, i) => (
            <span key={m.slug}>
              {i > 0 ? " und " : null}
              <a href={`${base}/massnahmen/${m.slug}`}>{m.display}</a>
            </span>
          ))}
          .
        </p>
      </section>

      <section aria-labelledby="st-fields">
        <h2 id="st-fields">Die Handlungsfelder</h2>
        {fields.map(({ b, m }) => (
          <Row
            key={m.slug}
            id={m.slug}
            margin={
              <>
                <div>
                  <span className="gz-bar" aria-hidden>
                    <i style={{ width: `${Math.max(2, Math.round((m.extractionPoints / max) * 100))}%` }} />
                  </span>
                  <p className="gz-count">
                    <b>{argumente(m.extractionPoints)}</b>, davon {m.extractionPoints - m.singles} in {streitfragen(m.points)} der Landkarte.
                  </p>
                </div>
                <div>
                  <span className={`lk-mark lk-tone-${m.verdict.tone}`} aria-hidden /> <span className="gz-verdict">{m.verdict.title}</span>
                </div>
                <a href={`${base}/massnahmen/${m.slug}`}>Zur Landkarte</a>
              </>
            }
          >
            <h3 className="row-title gz-title">
              {fieldNo(b) ? <span className="gz-num">{fieldNo(b)}</span> : null} {m.display}
            </h3>
            <p className="row-text">{b.description}</p>
            {m.kern ? (
              <p className="small muted">
                Kernkonflikt: <a href={`${base}/punkt/${m.kern.id}`}>{m.kern.question ?? m.kern.label}</a>
              </p>
            ) : null}
          </Row>
        ))}
      </section>

      {draftUrl || finalUrl ? (
        <p className="small muted gz-note">
          Was der Entwurf je Handlungsfeld vorhat, hat ein Sprachmodell aus dem Entwurf zusammengefasst. Die Originale:{" "}
          {draftUrl ? <a href={draftUrl}>Entwurf</a> : null}
          {draftUrl && finalUrl ? " und " : null}
          {finalUrl ? <a href={finalUrl}>Endfassung</a> : null}.
        </p>
      ) : null}
    </div>
  );
}
