import { notFound } from "next/navigation";

import { CampVoices, DIAG_ORDER, DiagLabel, DoorNote, Landkarte, Legend, shortOrg } from "@policy/landkarte";
import { loadMeasure, type SinglePoint } from "@policy/landkarte/data";

import { FindingRow, Row, Strip } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

const SHOW_SINGLES = 12;

function SingleRow({ s }: { s: SinglePoint }) {
  const contested = s.disagree.length > 0;
  return (
    <Row
      margin={
        <>
          <div>Gesagt von {s.orgs.map(shortOrg).join(", ")}</div>
          {s.agree.length ? <div>Zustimmung auch von {s.agree.map(shortOrg).join(", ")}</div> : null}
          {contested ? <div>Abgelehnt von {s.disagree.map(shortOrg).join(", ")}</div> : null}
        </>
      }
    >
      <p className="row-title" style={{ fontSize: "1rem" }}>{s.label}</p>
      {s.summary ? <p className="row-text">{s.summary}</p> : null}
    </Row>
  );
}

export default async function Massnahme({ params }: { params: Promise<{ ref: string; slug: string }> }) {
  const { ref, slug } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const m = await loadMeasure(getDb(), o.id, slug);
  if (!m) notFound();
  const { summary: s, points } = m;
  const live = points.filter((p) => p.typ !== "luecke");
  const instruments = live.filter((p) => p.typ === "verfahren");
  const ordered = [...live].sort((a, b) => DIAG_ORDER.indexOf(a.diag ?? "offen") - DIAG_ORDER.indexOf(b.diag ?? "offen") || a.ord - b.ord);
  const contested = m.singles.filter((x) => x.disagree.length > 0);

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Teilentscheidung
        </p>
        <h1>{s.display}</h1>
        {s.description ? (
          <p className="lead">
            {s.description}
            {s.paragraphs.length ? <span className="muted"> (§ {s.paragraphs.join(", ")})</span> : null}
          </p>
        ) : null}
      </header>

      <Row
        margin={
          <>
            <Strip m={s} />
            <div>
              {s.points} Streitfragen aus {s.extractionPoints} Argumenten
            </div>
            <div>{s.withNumbers} davon mit Stimmen aus beiden Lagern</div>
          </>
        }
      >
        <p className="row-title">
          <span className={`lk-diag lk-tone-${s.verdict.tone}`} style={{ fontSize: "1.125rem", fontFamily: "var(--serif)" }}>
            {s.verdict.title}
          </span>
        </p>
        <p className="row-text">{s.verdict.text}</p>
      </Row>

      <h2>Die Landkarte</h2>
      <p className="prose">
        Jedes Kästchen ist eine Streitfrage. Links und oben, was sich mit Belegen klären lässt; darunter, was nur die Politik entscheiden kann; zuletzt die
        Instrumente, mit denen sich der Streit entschärfen lässt. Die Farbe zeigt die Diagnose.
      </p>
      <Landkarte points={points} href={(p) => (p.typ === "luecke" ? "#luecken" : `${base}/punkt/${p.id}`)} />
      <Legend />

      {instruments.length > 0 ? (
        <section>
          <h2>Womit sich der Streit entschärfen lässt</h2>
          <p className="prose">
            Instrumente bestreiten die Maßnahme nicht, sie federn sie ab: Fristen, Ausnahmen, Grenzen. Jedes antwortet auf eine der kritischen Fragen. Wo beide Lager
            zustimmen, liegt ein Kompromiss nahe.
          </p>
          {instruments.map((p) => (
            <Row
              key={p.id}
              margin={
                <>
                  <DiagLabel diag={p.diag} />
                  <CampVoices votes={p.votes} camps={o.camps} />
                </>
              }
            >
              <p className="row-title">
                <a href={`${base}/punkt/${p.id}`}>{p.text}</a>
              </p>
              <DoorNote door={p.door} />
            </Row>
          ))}
        </section>
      ) : null}

      <section>
        <h2>Alle {live.length} Streitfragen</h2>
        <p className="prose">Geordnet nach Diagnose: zuerst, was die Politik entscheiden muss, dann was Gutachten klären können, dann die Brücken.</p>
        {ordered.map((p) => (
          <FindingRow key={p.id} p={p} base={base} camps={o.camps} showMeasure={false} />
        ))}
      </section>

      {points.some((p) => p.typ === "luecke") ? (
        <section id="luecken">
          <h2>Was niemand gefragt hat</h2>
          {points
            .filter((p) => p.typ === "luecke")
            .map((p) => (
              <Row key={p.id} margin={<DiagLabel diag="luecke" />}>
                <p className="row-text">{p.text.replace(/ — Diese kritische Frage hat im Verfahren niemand gestellt\.$/, "")}</p>
                <p className="small muted">Diese kritische Frage hat in der Anhörung niemand gestellt.</p>
              </Row>
            ))}
        </section>
      ) : null}

      {m.singles.length > 0 ? (
        <section>
          <h2>Selten, aber vielleicht entscheidend: {m.singles.length} Einzelforderungen</h2>
          <p className="prose">
            Diese Argumente gehören zu keiner Streitfrage der Karte, meist weil nur eine Organisation sie vorbringt. Sie gehen nicht verloren: Das eine Argument,
            das nur einmal vorkam, kann das entscheidende sein.
            {contested.length ? ` ${contested.length} davon lehnen andere Organisationen ausdrücklich ab; sie stehen oben.` : ""}
          </p>
          {m.singles.slice(0, SHOW_SINGLES).map((x) => (
            <SingleRow key={x.id} s={x} />
          ))}
          {m.singles.length > SHOW_SINGLES ? (
            <details>
              <summary className="btn" style={{ marginTop: "0.75rem" }}>
                Weitere {m.singles.length - SHOW_SINGLES} anzeigen
              </summary>
              {m.singles.slice(SHOW_SINGLES).map((x) => (
                <SingleRow key={x.id} s={x} />
              ))}
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
