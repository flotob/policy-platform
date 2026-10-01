import { DiagLabel, nf } from "@policy/landkarte";
import { billMeasures, type MeasureSummary } from "@policy/landkarte/data";
import { firstSentence, loadBill, type LawSection, type LawSegment, type SectionHeat } from "@policy/landkarte/data/bill";

import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

type Section = LawSection & { heat: SectionHeat };

const TOP_POINTS = 3;
const SHOW_MEASURES = 3;

/** Heat steps relative to the most-named section: 0 = nobody, 1–4 = light to dark. */
function heatScale(max: number) {
  const t1 = Math.max(1, Math.round(max * 0.15));
  const t2 = Math.max(t1 + 1, Math.round(max * 0.35));
  const t3 = Math.max(t2 + 1, Math.round(max * 0.6));
  const steps = [
    { lo: 1, hi: t1 },
    { lo: t1 + 1, hi: t2 },
    { lo: t2 + 1, hi: t3 },
    { lo: t3 + 1, hi: max },
  ];
  const step = (n: number) => (n <= 0 ? 0 : n <= t1 ? 1 : n <= t2 ? 2 : n <= t3 ? 3 : 4);
  return { step, steps: steps.map((s, i) => ({ ...s, step: i + 1 })).filter((s) => s.lo <= s.hi) };
}

const argumente = (n: number) => (n === 1 ? "1 Argument" : `${nf.format(n)} Argumente`);

function Text({ segments }: { segments: LawSegment[] }) {
  return (
    <div className="gz-body">
      {segments.map((s, i) => (
        <p key={i} className={`gz-seg gz-l${s.level}${s.heading ? " gz-head" : ""}`}>
          {s.marker ? <span className="gz-mk">{s.marker}</span> : null}
          {s.text}
        </p>
      ))}
    </div>
  );
}

/** The legal text: first sentence visible, the whole wording behind a toggle. */
function Wording({ s }: { s: Pick<LawSection, "segments" | "lead"> }) {
  if (s.segments.length === 1 && s.segments[0]!.text === s.lead) return <p className="row-text gz-lead-only">{s.lead}</p>;
  return (
    <details className="gz-text">
      <summary>
        <span className="gz-lead">{s.lead}</span>
        <span className="gz-toggle gz-toggle-open">Wortlaut lesen</span>
        <span className="gz-toggle gz-toggle-close">Wortlaut zuklappen</span>
      </summary>
      <Text segments={s.segments} />
    </details>
  );
}

function MeasureList({ measures, base, label }: { measures: MeasureSummary[]; base: string; label: [string, string] }) {
  if (measures.length === 0) return null;
  const item = (m: MeasureSummary) => (
    <li key={m.slug}>
      <span className={`lk-mark lk-tone-${m.verdict.tone}`} aria-hidden />
      <span>
        <a href={`${base}/massnahmen/${m.slug}`}>{m.display}</a>
        <span className="gz-verdict">{m.verdict.title}</span>
      </span>
    </li>
  );
  return (
    <div>
      <div className="gz-sub">{measures.length === 1 ? label[0] : label[1]}</div>
      <ul className="gz-list">{measures.slice(0, SHOW_MEASURES).map(item)}</ul>
      {measures.length > SHOW_MEASURES ? (
        <details className="gz-more">
          <summary>{measures.length - SHOW_MEASURES} weitere anzeigen</summary>
          <ul className="gz-list">{measures.slice(SHOW_MEASURES).map(item)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function SectionRow({
  s,
  max,
  orgs,
  measures,
  base,
  nested,
}: {
  s: Section;
  max: number;
  orgs: number;
  measures: MeasureSummary[];
  base: string;
  /** Inside an Abschnitt (h3), so the § is an h4. */
  nested: boolean;
}) {
  const H = nested ? "h4" : "h3";
  const h = s.heat;
  const own = measures.filter((m) => m.paragraphs.includes(s.n));
  const quiet = h.points === 0;
  return (
    <Row
      id={`p${s.n}`}
      margin={
        <>
          {quiet ? (
            <p className="gz-quiet-note">Niemand äußert sich ausdrücklich zu diesem Paragraphen.</p>
          ) : (
            <div>
              <span className="gz-bar" aria-hidden>
                <i style={{ width: `${Math.max(2, Math.round((h.points / max) * 100))}%` }} />
              </span>
              <p className="gz-count">
                <b>{argumente(h.points)}</b> {h.points === 1 ? "nennt" : "nennen"} diesen Paragraphen,{" "}
                {h.orgs === 1 ? "aus einer Stellungnahme" : `aus ${h.orgs} von ${orgs} Stellungnahmen`}.
              </p>
            </div>
          )}
          <MeasureList measures={own} base={base} label={["Gehört zur Teilentscheidung", "Gehört zu den Teilentscheidungen"]} />
          {h.mapPoints.length > 0 ? (
            <div>
              <div className="gz-sub">
                {h.mapPoints.length === 1
                  ? "Die Streitfrage dazu"
                  : h.mapPoints.length <= TOP_POINTS
                    ? `Die ${h.mapPoints.length} Streitfragen dazu`
                    : `Streitfragen dazu: die ${TOP_POINTS} meistgenannten von ${h.mapPoints.length}`}
              </div>
              <ul className="gz-list gz-points">
                {h.mapPoints.slice(0, TOP_POINTS).map((p) => (
                  <li key={p.id}>
                    <DiagLabel diag={p.diag} />
                    <a href={`${base}/punkt/${p.id}`}>{p.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : !quiet ? (
            <p className="gz-quiet-note">Keines dieser Argumente gehört zu einer Streitfrage der Karte.</p>
          ) : null}
        </>
      }
    >
      <H className={`row-title gz-title${quiet ? " gz-quiet" : ""}`}>
        <span className="gz-num">§ {s.n}</span> {s.title}
      </H>
      <Wording s={s} />
    </Row>
  );
}

export default async function Gesetz({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const db = getDb();
  const bill = await loadBill(db, o.id);

  const head = (
    <header className="page-head">
      <p className="crumbs">
        <a href={base}>Lagebild</a> / Das Gesetz
      </p>
      <h1>Das Gesetz</h1>
    </header>
  );
  if (!bill || bill.sections.length === 0) {
    return (
      <>
        {head}
        <p className="prose">Zu dieser Anhörung liegt der Text des Gesetzentwurfs nicht vor.</p>
      </>
    );
  }

  const sections = bill.sections;
  const max = Math.max(1, ...sections.map((s) => s.heat.points));
  const scale = heatScale(max);
  const top = [...sections].sort((a, b) => b.heat.points - a.heat.points || a.n - b.n).slice(0, 3);
  const silent = sections.filter((s) => s.heat.points === 0);
  const first = sections[0]!.n;
  const last = sections[sections.length - 1]!.n;

  // Teil → Abschnitt → §§, in the bill's order.
  const parts: { n: number; title: string; chapters: { key: string; title: string | null; sections: Section[] }[] }[] = [];
  for (const s of sections) {
    let part = parts.find((p) => p.n === s.part.n);
    if (!part) parts.push((part = { n: s.part.n, title: s.part.title, chapters: [] }));
    const key = s.chapter ? String(s.chapter.n) : "-";
    let ch = part.chapters.find((c) => c.key === key);
    if (!ch) part.chapters.push((ch = { key, title: s.chapter ? `Abschnitt ${s.chapter.n}: ${s.chapter.title}` : null, sections: [] }));
    ch.sections.push(s);
  }

  const extrasMeasures = await billMeasures(db, o.id);
  const measuresFor = (key: string) =>
    extrasMeasures
      .filter((m) => m.other.some((x) => x.startsWith(`${key}:`)))
      .map((m) => o.measures.find((x) => x.scope === m.name))
      .filter((m): m is MeasureSummary => !!m);

  return (
    <div className="gz">
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Das Gesetz
        </p>
        <h1>Das Gesetz</h1>
        <p className="lead">
          Der Entwurf {bill.law.short ? `zum ${bill.law.short}` : "des Gesetzes"}, Paragraph für Paragraph. Neben jedem Paragraphen steht, wie viele Argumente aus den {o.stats.statements}{" "}
          Stellungnahmen ihn ausdrücklich nennen. Je länger der Balken, desto mehr Argumente drehen sich um den Paragraphen. Von dort führen Verweise zur
          Teilentscheidung, zu der er gehört, und zu den Streitfragen, in denen er genannt wird.
        </p>
      </header>

      <section aria-labelledby="gz-overview">
        <h2 id="gz-overview">Der Entwurf auf einen Blick</h2>
        <p className="prose">
          Jedes Kästchen ist ein Paragraph, je dunkler, desto mehr Argumente nennen ihn. Am häufigsten genannt werden{" "}
          {top.map((s, i) => (
            <span key={s.n}>
              {i > 0 ? (i === top.length - 1 ? " und " : ", ") : null}
              <a href={`#p${s.n}`}>
                § {s.n} {s.title}
              </a>{" "}
              ({argumente(s.heat.points)})
            </span>
          ))}
          .
          {silent.length > 0
            ? ` ${silent.length === 1 ? `Zu § ${silent[0]!.n} äußert sich` : `Zu ${silent.length} Paragraphen äußert sich`} niemand ausdrücklich.`
            : null}
        </p>

        <nav className="gz-strip" aria-label={`Die Paragraphen ${first} bis ${last} nach Zahl der Argumente`}>
          {parts.map((p) => (
            <div key={p.n} className="gz-strip-part">
              <div className="gz-strip-label">
                Teil {p.n}: {p.title}
              </div>
              <ul className="gz-strip-cells">
                {p.chapters.flatMap((c, ci) =>
                  c.sections.map((s, si) => {
                    const label = `§ ${s.n} ${s.title}: ${s.heat.points === 0 ? "kein Argument" : argumente(s.heat.points)}`;
                    return (
                      <li key={s.n} className={ci > 0 && si === 0 ? "gz-cell-break" : undefined}>
                        <a href={`#p${s.n}`} className={`gz-cell gz-h${scale.step(s.heat.points)}`} aria-label={label} title={label}>
                          {s.n}
                        </a>
                      </li>
                    );
                  }),
                )}
              </ul>
            </div>
          ))}
        </nav>
        <ul className="gz-legend" aria-label="Legende">
          <li>Argumente je Paragraph:</li>
          <li>
            <i className="gz-cell gz-h0" aria-hidden /> keine
          </li>
          {scale.steps.map((st) => (
            <li key={st.step}>
              <i className={`gz-cell gz-h${st.step}`} aria-hidden /> {st.lo === st.hi ? st.lo : `${st.lo} bis ${st.hi}`}
            </li>
          ))}
        </ul>
        <p className="small muted gz-note">
          Gezählt werden Argumente, die den Paragraphen mit seiner Nummer nennen, etwa „§ 29“; Verweise auf andere Gesetze wie „§ 71 GEG“ zählen nicht mit.{" "}
          {nf.format(bill.naming)} von {nf.format(bill.arguments)} Argumenten nennen mindestens einen Paragraphen. Wer ein Thema anspricht, ohne den
          Paragraphen zu nennen, steht bei der jeweiligen Teilentscheidung.
        </p>
      </section>

      {parts.map((p) => (
        <section key={p.n} aria-labelledby={`gz-teil-${p.n}`}>
          <h2 id={`gz-teil-${p.n}`}>
            Teil {p.n}: {p.title}
          </h2>
          {p.chapters.map((c) => (
            <div key={c.key} className="gz-chapter">
              {c.title ? <h3>{c.title}</h3> : null}
              {c.sections.map((s) => (
                <SectionRow key={s.n} s={s} max={max} orgs={bill.orgs} measures={o.measures} base={base} nested={!!c.title} />
              ))}
            </div>
          ))}
        </section>
      ))}

      {bill.extras.length > 0 ? (
        <section aria-labelledby="gz-extras">
          <h2 id="gz-extras">Anlagen und weitere Artikel</h2>
          <p className="prose">
            Zum {bill.law.short ?? "Gesetz"} gehören Anlagen mit Einzelheiten zu einzelnen Paragraphen. Die übrigen Artikel des Entwurfs ändern andere Gesetze und regeln, wann
            das Gesetz in Kraft tritt.
          </p>
          <div className="gz-chapter">
            {bill.extras.map((e) => {
              const ref = /§ (\d+)/.exec(e.ref ?? "")?.[1];
              return (
                <Row
                  key={e.key}
                  id={e.key.toLowerCase().replace(/\s+/g, "-")}
                  margin={<MeasureList measures={measuresFor(e.key)} base={base} label={["Gehört zur Teilentscheidung", "Gehört zu den Teilentscheidungen"]} />}
                >
                  <h3 className="row-title gz-title">
                    <span className="gz-num">{e.key}</span> {e.title}
                  </h3>
                  {ref ? (
                    <p className="small muted gz-ref">
                      Ergänzt <a href={`#p${ref}`}>§ {ref}</a>
                    </p>
                  ) : null}
                  <Wording s={{ segments: e.segments, lead: firstSentence(e.segments.find((x) => !x.heading)?.text ?? "") }} />
                </Row>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
