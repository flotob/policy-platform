import { notFound } from "next/navigation";

import { DiagMark, displayScope, shortOrg, slugOf } from "@policy/landkarte";
import {
  loadOrgProfile,
  MIN_SHARED,
  type Agreement,
  type SlipEntry,
  type StandApart,
} from "@policy/landkarte/data/organisations";
import type { Camp, Overview } from "@policy/landkarte/data";

import { plural, SlipRow } from "@/components/OrgSlip";
import { Row } from "@/components/rows";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "../styles.css";

const SHOW_APART = 8;

function AgreeList({ items, base }: { items: Agreement[]; base: string }) {
  return (
    <ul className="org-agree">
      {items.map((a) => (
        <li key={a.other.submissionId}>
          <a href={`${base}/organisationen/${a.other.submissionId}`}>{a.other.short}</a>
          {a.both > 0 ? (
            <>
              <span className="org-bar" aria-hidden>
                <i style={{ width: `${Math.round((a.same / a.both) * 1000) / 10}%` }} />
              </span>
              <span className="org-agree-n">
                in {a.same} von {a.both} gemeinsamen Streitfragen
                {a.both < MIN_SHARED ? <span className="muted"> (zu wenige für einen Vergleich)</span> : null}
              </span>
            </>
          ) : (
            <span className="org-agree-n muted">keine gemeinsame Streitfrage</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ApartRow({ x, short, base }: { x: StandApart; short: string; base: string }) {
  const mine = x.value === 1 ? "stimmt zu" : "lehnt ab";
  const against = x.value === 1 ? x.campDisagree : x.campAgree;
  const voted = x.campAgree.length + x.campDisagree.length;
  return (
    <Row
      margin={
        x.only ? (
          <div>
            {short} {mine}. Sonst hat sich keine Organisation dazu geäußert.
          </div>
        ) : (
          <>
            <div>
              {short} {mine}.
            </div>
            <div>
              Im eigenen Lager {x.value === 1 ? (against.length === 1 ? "lehnt" : "lehnen") : against.length === 1 ? "stimmt" : "stimmen"} {against.length} von {voted}{" "}
              {x.value === 1 ? "ab" : "zu"}
              <span className="muted">: {against.map(shortOrg).join(", ")}</span>
            </div>
          </>
        )
      }
    >
      <p className="muted small" style={{ margin: "0 0 0.2rem" }}>
        <DiagMark diag={x.mapPoint.diag} /> {displayScope(x.mapPoint.scope)}
      </p>
      <p className="row-title" style={{ fontSize: "1rem" }}>
        <a href={`${base}/punkt/${x.mapPoint.id}`}>{x.mapPoint.text}</a>
      </p>
    </Row>
  );
}

interface Group {
  key: string;
  title: string;
  href: string | null;
  items: SlipEntry[];
}

function slipGroups(o: Overview, slip: SlipEntry[]): Group[] {
  const order = new Map(o.measures.map((m, i) => [m.scope, i]));
  const released = slip.filter((e) => e.status === "released");
  const scopes = [...new Set(released.map((e) => e.measure ?? ""))].sort((a, b) => (order.get(a) ?? 500) - (order.get(b) ?? 500));
  const groups: Group[] = scopes.map((scope) => ({
    key: scope ? slugOf(scope) : "ohne-massnahme",
    title: scope ? displayScope(scope) : "Keiner Teilentscheidung zugeordnet",
    href: scope && order.has(scope) ? `/${o.ref}/massnahmen/${slugOf(scope)}` : null,
    items: released
      .filter((e) => (e.measure ?? "") === scope)
      // On the map first (grouped by Streitfrage), then Einzelforderungen, then open questions.
      .sort(
        (a, b) =>
          rank(a) - rank(b) || (a.mapPoint?.label ?? "").localeCompare(b.mapPoint?.label ?? "", "de") || a.label.localeCompare(b.label, "de"),
      ),
  }));
  const rest = slip.filter((e) => e.status !== "released");
  if (rest.length) {
    const merged = rest.some((e) => e.status === "merged");
    const rejected = rest.some((e) => e.status !== "merged");
    const title = merged && rejected ? "Zusammengelegt oder aussortiert" : merged ? "Zusammengelegt" : "Aussortiert";
    groups.push({ key: "aussortiert", title, href: null, items: rest });
  }
  return groups;
}

const rank = (e: SlipEntry) => (e.mapPoint ? 0 : e.kind === "gap" ? 2 : 1);

function campLine(camp: Camp | null) {
  return camp ? `Gehört zum Lager „${camp.name}“.` : "Keinem Lager zugeordnet.";
}

export default async function Organisation({ params }: { params: Promise<{ ref: string; id: string }> }) {
  const { ref, id } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const p = await loadOrgProfile(getDb(), o, id);
  if (!p) notFound();
  const { summary: s, slipCounts: k } = p;
  const short = s.org.short;

  const ownCamp = s.camp;
  const campGroups = [
    ...(ownCamp ? [{ title: `Im eigenen Lager „${ownCamp.name}“`, items: p.agreements.filter((a) => a.other.camp === ownCamp.group) }] : []),
    ...o.camps
      .filter((c) => c.group !== ownCamp?.group)
      .map((c) => ({ title: `${ownCamp ? "Im anderen Lager" : "Im Lager"} „${c.name}“`, items: p.agreements.filter((a) => a.other.camp === c.group) })),
    { title: "Keinem Lager zugeordnet", items: p.agreements.filter((a) => a.other.camp == null || !o.camps.some((c) => c.group === a.other.camp)) },
  ].filter((g) => g.items.length > 0);

  const groups = slipGroups(o, p.slip);
  const apartAgainst = p.apart.filter((x) => !x.only);
  const apartOnly = p.apart.filter((x) => x.only);

  const landed = [
    `${k.onMap === 1 ? "steht" : "stehen"} ${k.onMap} auf der Landkarte`,
    `${k.singles} ${k.singles === 1 ? "ist eine Einzelforderung" : "sind Einzelforderungen"}`,
    k.openQuestions ? `${k.openQuestions} ${k.openQuestions === 1 ? "ist eine offene Frage" : "sind offene Fragen"}` : null,
  ].filter((x): x is string => x !== null);
  const landedSentence = `Von ${plural(k.args, "Argument", "Argumenten")} ${landed.slice(0, -1).join(", ")} und ${landed[landed.length - 1]}.`;

  const editSentence = [
    k.rewritten ? `${plural(k.rewritten, "Argument", "Argumente")} hat die maschinelle Redaktion umformuliert` : null,
    k.splitPieces
      ? `${plural(k.splitPieces, "Argument ist", "Argumente sind")} entstanden, weil ${k.rewritten ? "sie" : "die maschinelle Redaktion"} ${plural(k.splitPassages, "längere Textstelle", "längere Textstellen")} geteilt hat`
      : null,
  ].filter(Boolean);

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / <a href={`${base}/organisationen`}>Organisationen</a> / {short}
        </p>
        <h1 className="org-h1">{s.org.name}</h1>
        <p className="lead">
          {s.typeLabel ? `${s.typeLabel}. ` : ""}
          {campLine(ownCamp)} {plural(s.counts.args, "Argument", "Argumente")} aus rund {plural(s.pages, "Seite", "Seiten")}.
        </p>
      </header>

      {ownCamp?.summary ? (
        <Row
          margin={
            <>
              <div>
                Das Lager umfasst {plural(ownCamp.size, "Organisation", "Organisationen")}. Die Maschine hat es aus den Haltungen zu den Streitfragen gerechnet,
                die aus den Stellungnahmen abgeleitet sind.
              </div>
            </>
          }
        >
          <p className="row-text" style={{ marginTop: 0 }}>
            <span className="org-k">Was das Lager verbindet: </span>
            {ownCamp.summary}
          </p>
        </Row>
      ) : null}

      <section>
        <h2>Mit wem {short} übereinstimmt</h2>
        <Row
          margin={
            <>
              <div>Haltung zu {plural(s.counts.votes, "Streitfrage", "Streitfragen")} aus dem Text abgeleitet (Jev), nicht abgestimmt.</div>
            </>
          }
        >
          <p className="prose" style={{ margin: 0 }}>
            Gezählt werden die Streitfragen der Landkarte, zu denen sich beide Organisationen geäußert haben. Übereinstimmung heißt: Beide stimmen zu oder
            beide lehnen ab.
          </p>
        </Row>
        {campGroups.map((g) => (
          <div key={g.title} className="org-agree-group">
            <h3>{g.title}</h3>
            <AgreeList items={g.items} base={base} />
          </div>
        ))}
      </section>

      <section>
        <h2>Wo {short} allein steht</h2>
        {p.apart.length === 0 ? (
          <p className="prose">Bei keiner Streitfrage urteilt {short} anders als die Mehrheit des eigenen Lagers.</p>
        ) : (
          <>
            <p className="prose">
              {[
                apartAgainst.length
                  ? `Bei ${plural(apartAgainst.length, "Streitfrage", "Streitfragen")} urteilt ${short} anders als die Mehrheit der Organisationen im eigenen Lager, die sich dazu geäußert haben. Hier kann eine Organisation Brücken bauen, oder ihr Lager ist weniger geschlossen, als es aussieht.`
                  : null,
                apartOnly.length ? `Zu ${plural(apartOnly.length, "Streitfrage", "Streitfragen")} hat sich keine andere Organisation geäußert.` : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
            {p.apart.slice(0, SHOW_APART).map((x) => (
              <ApartRow key={x.mapPoint.id} x={x} short={short} base={base} />
            ))}
            {p.apart.length > SHOW_APART ? (
              <details className="org-more">
                <summary className="btn">Weitere {p.apart.length - SHOW_APART} anzeigen</summary>
                {p.apart.slice(SHOW_APART).map((x) => (
                  <ApartRow key={x.mapPoint.id} x={x} short={short} base={base} />
                ))}
              </details>
            ) : null}
          </>
        )}
      </section>

      <section id="laufzettel">
        <h2>Laufzettel: was aus jedem Argument wurde</h2>
        <Row
          margin={
            <>
              <div>{plural(k.args, "Argument", "Argumente")}</div>
              <div>{k.onMap} auf der Landkarte</div>
              <div>{plural(k.singles, "Einzelforderung", "Einzelforderungen")}</div>
              {k.openQuestions ? <div>{plural(k.openQuestions, "offene Frage", "offene Fragen")}</div> : null}
              {k.shared ? <div>{k.shared} auch von anderen gesagt</div> : null}
              {k.rewritten ? <div>{k.rewritten} umformuliert</div> : null}
              {k.splitPieces ? <div>{k.splitPieces} aus geteilten Stellen</div> : null}
              {k.merged ? <div>{k.merged} zusammengelegt</div> : null}
              {k.rejected ? <div>{k.rejected} aussortiert</div> : null}
            </>
          }
        >
          <div className="prose org-explain">
            <p>Für jede Stellungnahme lässt sich nachvollziehen, was aus jedem einzelnen Argument geworden ist.</p>
            <p>
              <strong>{landedSentence}</strong>{" "}
              {editSentence.length ? `${editSentence.join(", ")}.` : "Die maschinelle Redaktion hat keines umformuliert oder geteilt."}
              {k.shared ? ` ${plural(k.shared, "Argument", "Argumente")} haben auch andere Organisationen vorgebracht.` : ""}
              {k.merged ? ` ${plural(k.merged, "gleichlautende Fassung", "gleichlautende Fassungen")} derselben Stellungnahme hat die Maschine zusammengelegt.` : ""}
              {k.rejected ? ` ${plural(k.rejected, "Stelle", "Stellen")} hat die automatische Prüfung aussortiert.` : ""}
            </p>
            <p className="small">
              Die maschinelle Redaktion prüft jedes Argument nach dem Zerlegen: Sie teilt Stellen, die mehrere Behauptungen enthalten, und formuliert wertende
              Wörter neutral um. <strong>Auf der Landkarte</strong> heißt: Das Argument ist in eine Streitfrage eingegangen.{" "}
              <strong>Einzelforderung</strong> heißt: Es gehört zu keiner Streitfrage, meist weil nur diese Organisation es vorbringt. Ein Klick auf die Zeile
              unter einem Argument zeigt die Originalstelle.
            </p>
          </div>
        </Row>

        <nav className="org-index" aria-label="Laufzettel nach Teilentscheidung">
          <ul>
            {groups.map((g) => (
              <li key={g.key}>
                <a href={`#m-${g.key}`}>{g.title}</a> <span className="muted">{g.items.length}</span>
              </li>
            ))}
          </ul>
        </nav>

        {groups.map((g) => {
          const onMap = g.items.filter((e) => e.mapPoint).length;
          return (
            <div key={g.key} id={`m-${g.key}`} className="org-group">
              <h3 className="org-group-head">
                {g.href ? <a href={g.href}>{g.title}</a> : g.title}
                <span className="muted small">
                  {" "}
                  {plural(g.items.length, "Argument", "Argumente")}
                  {g.key !== "aussortiert" ? `, ${onMap} davon auf der Landkarte` : ""}
                </span>
              </h3>
              {g.items.map((e) => (
                <SlipRow key={e.pointId} e={e} base={base} org={s.org.name} />
              ))}
            </div>
          );
        })}
      </section>
    </>
  );
}
