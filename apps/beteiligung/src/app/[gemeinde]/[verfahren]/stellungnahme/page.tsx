import { notFound, redirect } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { getPublicCampaign } from "@/lib/campaigns";
import { getParticipant } from "@/lib/teilnahme";

import { UploadForm } from "../DoorForms";
import "../../public.css";
import "../tueren.css";

export const metadata = { title: "Stellungnahme einreichen" };

/** Door 3 (B10): a full statement; every argument in it is matched like a short point, its sender becomes a participant. */
export default async function Stellungnahme({ params }: { params: Promise<{ gemeinde: string; verfahren: string }> }) {
  const { gemeinde, verfahren } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  if (c.state !== "offen" || !c.params.doors.stellungnahme) redirect(`/${c.tenant.slug}/${c.slug}`);
  const me = await getParticipant(c);
  return (
    <PublicFrame town={c.tenant} campaign={c} fictional={c.fictional} back>
      <main className="wrap door">
        <p className="door-kicker">{c.question}</p>
        <h1 className="serif">Stellungnahme einreichen</h1>
        <p className="pub-lead">
          Für längere Schreiben, etwa von Vereinen, Betrieben oder Fachleuten. Die Maschine zerlegt sie in einzelne Argumente; jedes kommt dorthin,
          wo es hingehört, und zählt als deine Stimme. Ein Mensch aus der Redaktion prüft alles Neue. Über einen Link verfolgst du, was aus jedem
          Argument geworden ist.
        </p>
        <UploadForm gemeinde={c.tenant.slug} verfahren={c.slug} needsCode={c.params.access === "einladung" && !me} />
      </main>
    </PublicFrame>
  );
}
