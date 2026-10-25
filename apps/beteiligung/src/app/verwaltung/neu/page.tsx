import Link from "next/link";

import { requireInitiator } from "@/lib/session";

import { NewCampaignForm } from "../forms";

export const metadata = { title: "Neues Verfahren" };

export default async function Neu() {
  await requireInitiator();
  return (
    <div className="ws-narrow">
      <p className="crumbs">
        <Link href="/verwaltung">Verfahren</Link>
      </p>
      <h1 className="ws-h1">Neues Verfahren</h1>
      <p className="muted ws-intro">
        Ein Verfahren stellt genau eine Maßnahme zur Diskussion. Begründung, Unterlagen und den Ablauf ergänzen Sie im nächsten Schritt. Öffentlich
        wird nichts, bevor Sie es freischalten.
      </p>
      <NewCampaignForm />
    </div>
  );
}
