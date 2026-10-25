import { notFound } from "next/navigation";

import { ResultView } from "@/components/ergebnis/ResultView";
import { PublicFrame } from "@/components/PublicFrame";
import { publishedBundle } from "@/lib/bericht";
import { getPublicCampaign } from "@/lib/campaigns";
import { methodParagraphs, periodOf, questionLabels, townShort } from "@/lib/ergebnis-seite";

import "../../public.css";
import "../../../ergebnis.css";

export async function generateMetadata({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  return c ? { title: `Ergebnis: ${c.title}, ${c.tenant.name}`, description: `Worüber ${townShort(c.tenant.name)} streitet: die Auswertung der Beteiligung.` } : {};
}

/** R5/R6: the published results page — only from the stored result the released report was written on. */
export default async function Ergebnis({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const bundle = await publishedBundle(c);
  if (!bundle) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  const period = await periodOf(c);
  return (
    <PublicFrame town={c.tenant} campaign={{ slug: c.slug, title: c.title }} back>
      <main className="pub-erg">
        <ResultView
          r={bundle.result}
          names={bundle.naming?.names ?? null}
          title={c.title}
          town={townShort(c.tenant.name)}
          measure={c.measure}
          eyebrow={`Online-Anhang zum Bericht · ${c.tenant.name}${c.fictional ? " · Beispiel mit erfundenen Inhalten" : ""}`}
          period={period}
          questions={questionLabels}
          method={methodParagraphs(c, bundle.result)}
          report={{ href: `${base}/bericht`, label: "Den Bericht lesen" }}
          files={[
            { href: `${base}/daten/abstimmungsmatrix.csv`, label: "Abstimmungsmatrix (CSV)" },
            { href: `${base}/daten/aussagen.json`, label: "Aussagen (JSON)" },
            { href: `${base}/daten/beitraege.json`, label: "Beiträge und Zitate (JSON)" },
            { href: `${base}/daten/protokoll.json`, label: "Protokoll (JSON)" },
            { href: `${base}/daten/ergebnis.json`, label: "Ergebnis (JSON)" },
          ]}
        />
      </main>
    </PublicFrame>
  );
}
