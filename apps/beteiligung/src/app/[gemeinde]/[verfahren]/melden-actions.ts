"use server";

import { redirect } from "next/navigation";
import { noticeQuery } from "@/lib/notice";

import { getPublicCampaign } from "@/lib/campaigns";
import { reportContent } from "@/lib/meldungen";

export interface ReportState {
  ok?: boolean;
  error?: string;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** From the results page (client form): the answer stays on the page. */
export async function reportFromPage(gemeinde: string, verfahren: string, kind: "node" | "move", id: string, _prev: ReportState, form: FormData): Promise<ReportState> {
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) return { error: "Dieses Verfahren gibt es nicht." };
  const r = await reportContent(c, kind, id, field(form, "grund"), field(form, "notiz"));
  return r.ok ? { ok: true } : { error: r.error };
}

/** From the voting card (plain form, no script needed): back to the card with a note. */
export async function reportFromDeck(gemeinde: string, verfahren: string, id: string, form: FormData): Promise<void> {
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) redirect("/");
  const r = await reportContent(c, "node", id, field(form, "grund"), field(form, "notiz"));
  const note = r.ok ? "Danke, die Redaktion sieht sich das an. Sie können weiter abstimmen oder die Aussage überspringen." : r.error;
  redirect(`/${c.tenant.slug}/${c.slug}/abstimmen?${noticeQuery(note)}`);
}
