"use server";

import {
  confirmMove,
  syncDerivedVotes,
  DecisionError,
  discardMove,
  editNode,
  mergeNode,
  reassignMove,
  rejectNode,
  releaseNode,
  type NodeFields,
} from "@policy/pipeline/kern";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { QUESTIONS, STEPS } from "@/lib/params";
import { getNode } from "@/lib/redaktion";
import { requireEditor } from "@/lib/session";
import { REJECT, type RejectKey } from "@/lib/vocab";

/** The editor's own campaign, or back to the list: never another municipality's. */
async function ctx(id: string) {
  const staff = await requireEditor();
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) redirect("/verwaltung");
  return { staff, campaign, actor: `user:${staff.user.id}`, db: getDb(), base: `/verwaltung/${id}/redaktion` };
}

type Ctx = Awaited<ReturnType<typeof ctx>>;

/** Run a decision; a refused one comes back as a message on the same item. Votes that follow from the moves are recounted. */
async function decide(x: Ctx, back: string, run: () => Promise<unknown>, next?: string): Promise<never> {
  try {
    await run();
  } catch (e) {
    if (e instanceof DecisionError) redirect(`${x.base}?${back}&fehler=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await syncDerivedVotes(x.db, x.campaign.consultationId);
  revalidatePath(x.base.replace(/\/redaktion$/, ""), "layout");
  redirect(next ?? x.base);
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** The fields of the release form, checked against the step model (a question must fit its step). */
function fieldsFrom(form: FormData, rolle: string): Partial<NodeFields> | string {
  const text = field(form, "text");
  const label = field(form, "label");
  if (text.length < 8) return "Die Aussage ist zu kurz.";
  if (!label) return "Bitte geben Sie ein Stichwort an.";
  if (rolle === "schluss") return { text, label };
  const typ = field(form, "typ");
  if (!["T", "W", "verfahren"].includes(typ)) return "Bitte wählen Sie: Tatsache, Wertung oder Ausgestaltung.";
  const schritt = field(form, "schritt") as NodeFields["schritt"];
  if (!STEPS.some((s) => s.key === schritt)) return "Bitte wählen Sie den Schritt der Begründung.";
  if (rolle === "praemisse") return { text, label, typ: typ as NodeFields["typ"], schritt };
  const richtung = field(form, "richtung") === "greift_an" ? "greift_an" : "stuetzt";
  const frage = field(form, "frage") as NodeFields["frage"];
  const q = QUESTIONS.find((x) => x.key === frage);
  if (!q) return "Bitte wählen Sie die Prüffrage.";
  if (!(q.steps as readonly string[]).includes(schritt!)) {
    return `Die Prüffrage „${q.label}“ passt nicht zu diesem Schritt.`;
  }
  const einwand = richtung === "greift_an" ? field(form, "einwand") || null : null;
  return { text, label, typ: typ as NodeFields["typ"], schritt, frage, richtung, einwand };
}

export async function releaseNodeAction(id: string, nodeId: string, form: FormData): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  const node = await getNode(campaign.consultationId, nodeId);
  if (!node) redirect(base);
  const edits = fieldsFrom(form, node.rolle);
  const back = `punkt=${nodeId}`;
  if (typeof edits === "string") redirect(`${base}?${back}&fehler=${encodeURIComponent(edits)}`);
  await decide(x, back, () => releaseNode(db, { tenantId: campaign.tenantId, nodeId, actor, edits }));
}

export async function editNodeAction(id: string, nodeId: string, form: FormData): Promise<void> {
  const { campaign, actor, db } = await ctx(id);
  const base = `/verwaltung/${id}/punkte`;
  const node = await getNode(campaign.consultationId, nodeId);
  if (!node) redirect(base);
  if (campaign.state !== "vorbereitung" && campaign.state !== "offen") redirect(`${base}?fehler=${encodeURIComponent("Nach der Beteiligung bleiben die Aussagen, wie sie abgestimmt wurden.")}`);
  const edits = fieldsFrom(form, node.rolle);
  if (typeof edits === "string") redirect(`${base}?bearbeiten=${nodeId}&fehler=${encodeURIComponent(edits)}#p-${nodeId}`);
  try {
    await editNode(db, { tenantId: campaign.tenantId, nodeId, actor, edits, newVersion: campaign.state === "offen" });
    await syncDerivedVotes(db, campaign.consultationId);
  } catch (e) {
    if (e instanceof DecisionError) redirect(`${base}?fehler=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/verwaltung/${id}`, "layout");
  redirect(`${base}#p-${nodeId}`);
}

export async function rejectNodeAction(id: string, nodeId: string, form: FormData): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  const reason = field(form, "reason") as RejectKey;
  await decide(x, `punkt=${nodeId}`, () =>
    rejectNode(db, { tenantId: campaign.tenantId, nodeId, actor, reason: reason in REJECT ? reason : "kein_argument" }),
  );
}

export async function mergeNodeAction(id: string, nodeId: string, intoId: string, stance: 1 | -1): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  await decide(x, `punkt=${nodeId}`, () => mergeNode(db, { tenantId: campaign.tenantId, nodeId, intoId, actor, stance }));
}

/** A move inside a node's card: open it as a proposal of its own, or drop it — the card stays open. */
export async function detachMoveAction(id: string, nodeId: string, moveId: string): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  await decide(x, `punkt=${nodeId}`, () => reassignMove(db, { tenantId: campaign.tenantId, moveId, actor, to: "neu" }), `${base}?punkt=${nodeId}`);
}

export async function discardMoveAction(id: string, back: string, moveId: string, form: FormData): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  const reason = field(form, "reason") as RejectKey;
  await decide(x,
    back,
    () => discardMove(db, { tenantId: campaign.tenantId, moveId, actor, reason: reason in REJECT ? reason : "kein_argument" }),
    back.startsWith("punkt=") ? `${base}?${back}` : base,
  );
}

export async function confirmMoveAction(id: string, moveId: string): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  await decide(x, `beitrag=${moveId}`, () => confirmMove(db, { tenantId: campaign.tenantId, moveId, actor }));
}

export async function newNodeFromMoveAction(id: string, moveId: string): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  let target: string;
  try {
    target = await reassignMove(db, { tenantId: campaign.tenantId, moveId, actor, to: "neu" });
  } catch (e) {
    if (e instanceof DecisionError) redirect(`${base}?beitrag=${moveId}&fehler=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await syncDerivedVotes(db, campaign.consultationId);
  revalidatePath(`/verwaltung/${id}`, "layout");
  // The new proposal opens next: it still needs a wording and a release.
  redirect(`${base}?punkt=${target}`);
}

/** Move a move to another point; `back` keeps the editor on the card it was moved from (a node's card or the move itself). */
export async function reassignMoveAction(id: string, back: string, moveId: string, form: FormData): Promise<void> {
  const x = await ctx(id);
  const { campaign, actor, db, base } = x;
  const node = field(form, "node");
  const stance = field(form, "stance") === "-1" ? -1 : 1;
  if (!/^[0-9a-f-]{36}$/.test(node)) redirect(`${base}?${back}&fehler=${encodeURIComponent("Bitte wählen Sie einen Punkt.")}`);
  await decide(x,
    back,
    () => reassignMove(db, { tenantId: campaign.tenantId, moveId, actor, to: { node, stance } }),
    back.startsWith("punkt=") ? `${base}?${back}` : base,
  );
}
