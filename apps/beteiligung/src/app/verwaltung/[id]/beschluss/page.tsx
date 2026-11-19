import Link from "next/link";
import { notFound } from "next/navigation";

import { publishedBundle } from "@/lib/bericht";
import { getDecision } from "@/lib/beschluss";
import { decisionDate } from "@/lib/beschluss-words";
import { getCampaign } from "@/lib/campaigns";
import { countFollowers } from "@/lib/folgen";
import { requireStaff } from "@/lib/session";

import { DecisionForm, type DecisionItem } from "../../beschluss-form";

import "../auswertung/auswertung.css";
import "./beschluss.css";

export const metadata = { title: "Beschluss" };

const LABEL: Record<string, string> = {
  streit: "trennt die Lager",
  klaerbar: "mit Gutachten klärbar",
  offen: "offen geblieben",
  warnung: "Scheinkonsens",
  bruecke: "Brücke",
};

/**
 * The way back (Stephan, paper v10): for the administration the chain ends with the report; for
 * the citizen it does not. The town notes how the council handled every statement — every value
 * question and every open fact question at least — and the tracking slips show it.
 */
export default async function Beschluss({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) notFound();
  const bundle = await publishedBundle(c);
  if (!bundle) {
    return (
      <div className="au">
        <p className="notice">Den Beschluss tragen Sie ein, sobald Ergebnis und Bericht veröffentlicht sind.</p>
      </div>
    );
  }
  const [d, followers] = await Promise.all([getDecision(c.id), countFollowers(c.id)]);
  const r = bundle.result;
  const items = r.statements
    .filter((s) => s.rolle !== "schluss")
    .map((s) => ({
      s,
      item: {
        id: s.id,
        nr: s.nr,
        text: s.text,
        label: r.ready ? `${s.typ === "W" ? "Wertungsfrage" : s.typ === "T" ? "Tatsachenfrage" : "Ausgestaltung"}, ${LABEL[s.category] ?? s.category}` : s.typ === "W" ? "Wertungsfrage" : s.typ === "T" ? "Tatsachenfrage" : "Ausgestaltung",
        outcome: d?.points[s.id]?.outcome ?? "",
        reason: d?.points[s.id]?.reason ?? "",
      } satisfies DecisionItem,
    }));
  const must = (s: (typeof items)[number]["s"]) => s.category === "streit" || s.category === "warnung" || s.category === "klaerbar" || (s.category === "offen" && s.typ === "T");
  const groups = r.ready
    ? [
        {
          title: "Was der Rat entscheiden musste",
          hint: "Die Wertungsfragen, über die die Lager streiten, und die Tatsachenfragen, die offen oder strittig blieben. Hier erwarten die Teilnehmenden eine Antwort.",
          items: items.filter((x) => must(x.s)).map((x) => x.item),
        },
        {
          title: "Worüber Einigkeit bestand",
          hint: "Brücken und alles, was beide Lager tragen. Ein Vermerk ist auch hier gut: Viele haben dafür gestimmt.",
          items: items.filter((x) => !must(x.s)).map((x) => x.item),
        },
      ].filter((g) => g.items.length)
    : [{ title: "Die Aussagen", hint: "Jede Aussage, über die abgestimmt wurde.", items: items.map((x) => x.item) }];
  const published = d?.state === "veroeffentlicht";
  const noted = d ? Object.keys(d.points).length : 0;
  const base = `/${staff.tenant.slug}/${c.slug}`;

  return (
    <div className="au">
      <section className="au-panel">
        <h2>Was der Gemeinderat daraus gemacht hat</h2>
        <p className="au-lead">
          Für die Verwaltung endet das Verfahren mit dem Bericht, für die Teilnehmenden nicht: Sie wollen wissen, was aus ihrem Punkt geworden ist.
          Vermerken Sie nach der Sitzung bei jeder Aussage, wie der Rat sie behandelt hat, mit einem Satz dazu. Danach steht es auf jedem Laufzettel
          und auf der Ergebnisseite.
        </p>
        <ul className="checklist">
          <li className={published ? "done" : undefined}>
            <span className="tick" aria-hidden>
              {published ? "✓" : ""}
            </span>
            {published
              ? `Veröffentlicht${d?.datum ? ` (Sitzung am ${decisionDate(d.datum)})` : ""}. Änderungen sind sofort öffentlich.`
              : d
                ? "Entwurf, noch nicht öffentlich."
                : "Noch nichts eingetragen."}
          </li>
          <li className={noted ? "done" : undefined}>
            <span className="tick" aria-hidden>
              {noted ? "✓" : ""}
            </span>
            {noted} von {items.length} Aussagen vermerkt.
          </li>
          <li>
            <span className="tick" aria-hidden />
            {followers
              ? `${followers} ${followers === 1 ? "Person hat" : "Personen haben"} um eine Nachricht gebeten${published ? "." : " und bekommt sie beim Veröffentlichen."}`
              : "Bisher hat niemand um eine Nachricht per E-Mail gebeten."}
          </li>
        </ul>
        {published ? (
          <p className="small" style={{ marginTop: 10 }}>
            <Link href={`${base}/ergebnis`}>Ergebnisseite ansehen</Link> · <Link href={base}>Seite der Beteiligung</Link>
          </p>
        ) : null}
      </section>
      <DecisionForm
        id={c.id}
        head={{ gremium: d?.gremium ?? "Gemeinderat", datum: d?.datum ?? "", summary: d?.summary ?? "" }}
        groups={groups}
        canPublish={staff.role === "initiator"}
        canEdit={staff.role !== "betrachter"}
        published={published}
      />
    </div>
  );
}
