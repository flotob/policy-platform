import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { CampaignTabs } from "@/components/CampaignTabs";
import { MachineStatus } from "@/components/MachineStatus";
import { getCampaign } from "@/lib/campaigns";
import { STATES } from "@/lib/params";
import { countQueue, listJobs } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";

/** Every campaign page: what it is, where it stands, what the machine is doing. */
export default async function CampaignLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const campaign = await getCampaign(staff.tenant.id, (await params).id);
  if (!campaign) notFound();
  const [jobs, queue] = await Promise.all([listJobs(campaign.id), countQueue(campaign.consultationId)]);
  const showWork = campaign.state !== "entwurf" || jobs.length > 0;

  return (
    <div className="cp">
      <div className="cp-head">
        <p className="crumbs">
          <Link href="/verwaltung">Verfahren</Link>
        </p>
        <h1 className="ws-h1">{campaign.title}</h1>
        <p className="cp-q serif">{campaign.question}</p>
        <div className="cp-meta">
          <span className={`state state-${campaign.state}`}>{STATES[campaign.state].label}</span>
          {campaign.fictional ? <span className="tag">Beispiel mit erfundenen Inhalten</span> : null}
          <span className="muted small">{STATES[campaign.state].text}</span>
        </div>
      </div>
      <CampaignTabs id={campaign.id} queue={queue} showWork={showWork} live={!["entwurf", "vorbereitung"].includes(campaign.state)} />
      <MachineStatus campaignId={campaign.id} jobs={jobs} editable={staff.role === "initiator"} />
      {children}
    </div>
  );
}
