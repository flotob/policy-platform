import { nf } from "@policy/landkarte";
import { loadOrganisations, type Agreement, type OrgSummary } from "@policy/landkarte/data/organisations";

import { plural } from "@/components/OrgSlip";
import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

function Near({ label, a }: { label: string; a: Agreement | null }) {
  if (!a) return null;
  return (
    <span className="org-near">
      <span className="muted">{label}: </span>
      {a.other.short} <span className="muted">(gleiche Haltung in {a.same} von {a.both} gemeinsamen Streitfragen)</span>
    </span>
  );
}

function OrgRow({ s, base }: { s: OrgSummary; base: string }) {
  const c = s.counts;
  return (
    <Row
      margin={
        <>
          <div>rund {plural(s.pages, "Seite", "Seiten")}</div>
          <div>{plural(c.args, "Argument", "Argumente")}</div>
          <div>{c.onMap} auf der Landkarte</div>
          <div>{plural(c.singles, "Einzelforderung", "Einzelforderungen")}</div>
          {c.openQuestions ? <div>{plural(c.openQuestions, "offene Frage", "offene Fragen")}</div> : null}
          <div className="muted">Haltung zu {plural(c.votes, "Streitfrage", "Streitfragen")} abgeleitet</div>
        </>
      }
    >
      <p className="row-title">
        <a href={`${base}/organisationen/${s.org.submissionId}`}>{s.org.name}</a>
      </p>
      {s.typeLabel ? <p className="small muted org-type">{s.typeLabel}</p> : null}
      <p className="row-text org-nears">
        <Near label="Am nächsten" a={s.closest} />
        <Near label="Am fernsten" a={s.farthest} />
      </p>
    </Row>
  );
}

export default async function Organisationen({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const list = await loadOrganisations(getDb(), o);
  const groups = [
    ...o.camps.map((c) => ({ camp: c, items: list.filter((s) => s.camp?.group === c.group) })),
    { camp: null, items: list.filter((s) => !s.camp) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Organisationen
        </p>
        <h1>Wer Stellung genommen hat</h1>
        <p className="lead">
          {o.stats.statements} Organisationen haben zum Entwurf Stellung genommen, zusammen rund {nf.format(o.stats.pages)} Seiten. Für jede lässt sich
          nachvollziehen, was aus jedem ihrer Argumente geworden ist und mit wem sie übereinstimmt.
        </p>
      </header>

      <Row
        margin={
          <>
            <div>Haltungen sind aus dem Text der Stellungnahmen abgeleitet (Jev), nicht abgestimmt.</div>
            <div>Eine Seite: rund 2.500 Zeichen.</div>
          </>
        }
      >
        <div className="prose org-explain">
          <p>
            <strong>Auf der Landkarte</strong> heißt: Das Argument ist in eine Streitfrage eingegangen, zu der die Lager Stellung beziehen.{" "}
            <strong>Einzelforderungen</strong> gehören zu keiner Streitfrage, meist weil nur eine Organisation sie vorbringt. Sie bleiben trotzdem sichtbar.
          </p>
          <p>
            <strong>Am nächsten</strong> und <strong>am fernsten</strong>: Gezählt werden die Streitfragen, zu denen sich beide Organisationen geäußert
            haben, und wie oft beide dieselbe Haltung einnehmen, also beide zustimmen oder beide ablehnen.
          </p>
        </div>
      </Row>

      {groups.map((g) => (
        <section key={g.camp?.group ?? "none"}>
          <h2>{g.camp ? `Lager „${g.camp.name}“: ${plural(g.items.length, "Organisation", "Organisationen")}` : "Keinem Lager zugeordnet"}</h2>
          {g.camp?.summary ? <p className="prose">{g.camp.summary}</p> : null}
          {g.items.map((s) => (
            <OrgRow key={s.org.submissionId} s={s} base={base} />
          ))}
        </section>
      ))}

      <p className="small muted org-foot">
        Ein Lager ist eine Gruppe von Organisationen, die bei den Streitfragen ähnlich urteilen. Die Lager hat die Maschine aus den abgeleiteten Haltungen
        gerechnet; ihre Namen hat ein Sprachmodell formuliert. Die Art der Organisation wurde beim Einlesen der Stellungnahmen erfasst.
      </p>
    </>
  );
}
