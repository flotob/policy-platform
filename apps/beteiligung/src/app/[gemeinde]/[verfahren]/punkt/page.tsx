import { notFound, redirect } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { getPublicCampaign } from "@/lib/campaigns";
import { getParticipant } from "@/lib/teilnahme";

import { ShortForm } from "../DoorForms";
import "../../public.css";
import "../tueren.css";

export const metadata = { title: "Eigener Punkt" };

/** Door 2 (Stephan's screen 3, first half): what is missing, in two sentences. */
export default async function EigenerPunkt({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  if (c.state !== "offen" || !c.params.doors.kurzaussage) redirect(`/${c.tenant.slug}/${c.slug}`);
  const me = await getParticipant(c);
  return (
    <PublicFrame town={c.tenant} campaign={c} back>
      <main className="wrap door">
        <p className="door-kicker">{c.question}</p>
        <h1 className="serif">Was fehlt in der Debatte?</h1>
        <p className="pub-lead">
          Zwei Sätze reichen. Die Maschine prüft sofort, ob es deinen Punkt schon gibt; dann zählt deine Stimme dort. Ist er neu, prüft ihn ein Mensch
          aus der Redaktion, und du kannst mitverfolgen, was daraus wird.
        </p>
        <ShortForm gemeinde={c.tenant.slug} verfahren={c.slug} needsCode={c.params.access === "einladung" && !me} />
      </main>
    </PublicFrame>
  );
}
