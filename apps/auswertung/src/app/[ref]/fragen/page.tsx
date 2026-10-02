import { nf } from "@policy/landkarte";

import { AskBox } from "@/components/AskBox";
import { overview } from "@/lib/load";

import "./styles.css";

export default async function Fragen({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const s = o.stats;
  // Example questions: the organisation examples only where that organisation took part.
  const has = (short: string) => o.orgs.some((x) => x.short === short);
  // The hearing on the bill has hand-picked examples; otherwise they come from the data:
  // the organisation with the most arguments and the most disputed field.
  const topOrg = o.orgs.filter((x) => x.type !== "PRIVATE").sort((a, b) => b.points - a.points)[0];
  const topMeasure = [...o.measures].filter((m) => m.slug && m.points > 0).sort((a, b) => b.extractionPoints - a.extractionPoints)[0];
  const examples = (
    o.draft.kind === "law"
      ? [
          has("BDEW") ? "Was sagt der BDEW zur Biomasse?" : null,
          "Wo sind sich alle Lager einig?",
          "Welche Tatsachenfragen sollte ein Gutachten klären?",
          has("Deutsche Umwelthilfe") ? "Was kritisiert die Deutsche Umwelthilfe?" : null,
        ]
      : [
          topMeasure ? `Worüber wird bei „${topMeasure.display}“ gestritten?` : null,
          "Wo sind sich alle Lager einig?",
          "Welche Tatsachenfragen sollte ein Gutachten klären?",
          topOrg ? `Was fordert ${topOrg.short}?` : null,
        ]
  ).filter((x): x is string => x !== null);

  return (
    <>
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Frag die Landkarte
        </p>
        <h1>Frag die Landkarte</h1>
        <p className="lead">
          Fragen Sie in eigenen Worten nach einem Thema, einer Organisation oder einer Streitfrage: Die Antwort stützt sich nur auf die Stellungnahmen
          dieser {o.procedure}; jeder Satz nennt seine Quelle.
        </p>
      </header>

      <AskBox
        base={base}
        examples={examples}
        placeholder={`Zum Beispiel: ${examples[0] ?? "Wo sind sich alle Lager einig?"}`}
        howItWorks={
          <>
            <strong>So entsteht die Antwort</strong>
            <p>
              Gesucht wird in {nf.format(s.mapPoints)} Streitfragen und {nf.format(s.points)} Argumenten aus {s.statements} Stellungnahmen. Diese
              Suche ist eine reine Textsuche, ohne KI.
            </p>
            <p>Ein Sprachmodell formuliert die Antwort nur aus den Fundstellen. Es darf nichts ergänzen.</p>
            <p>Hinter jedem Satz steht ein Verweis: zur Streitfrage auf der Landkarte oder zum wörtlichen Zitat.</p>
            <p className="muted">
              Ob eine Organisation zustimmt oder ablehnt, ist aus dem Text ihrer Stellungnahme abgeleitet, nicht abgestimmt. Was keine Stellungnahme
              sagt, kann die Antwort nicht wissen.
            </p>
          </>
        }
      />
    </>
  );
}
