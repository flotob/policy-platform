"use server";

import { sql } from "@policy/db";
import { revalidatePath } from "next/cache";

import { publishedBundle } from "@/lib/bericht";
import { OUTCOMES } from "@/lib/beschluss-words";
import { getCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { notifyFollowers } from "@/lib/folgen";
import { requireEditor } from "@/lib/session";

import type { ActionState } from "./actions";

const KEYS = new Set<string>(OUTCOMES.map((o) => o.key));
const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim().replace(/\s+/g, " ");

/**
 * The way back: the town notes what the council decided — about the measure, and for each
 * statement how it was handled. Saved as a draft by the editors; the initiator publishes it, and
 * from then on every tracking slip shows it and the people who asked for news get an e-mail.
 */
export async function saveDecision(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireEditor();
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) return { error: "Dieses Verfahren gibt es nicht." };
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const bundle = await publishedBundle(c);
  if (!bundle) return { error: "Den Beschluss tragen Sie ein, sobald der Bericht veröffentlicht ist.", values };
  const publish = form.get("publish") === "1";
  if (publish && staff.role !== "initiator") return { error: "Veröffentlichen darf nur, wer das Verfahren leitet.", values };

  const gremium = field(form, "gremium") || "Gemeinderat";
  const datum = field(form, "datum");
  const summary = field(form, "summary");
  if (gremium.length > 80) return { error: "Der Name des Gremiums ist zu lang.", values };
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { error: "Das Datum der Sitzung fehlt oder ist unlesbar.", values };
  if (summary.length > 800) return { error: "Der Beschluss ist länger als 800 Zeichen. Zwei, drei Sätze reichen; der Rest steht an den Aussagen.", values };

  const points = bundle.result.statements.filter((s) => s.rolle !== "schluss");
  const chosen: { id: string; outcome: string; reason: string | null }[] = [];
  for (const s of points) {
    const outcome = field(form, `o_${s.id}`);
    const reason = field(form, `r_${s.id}`);
    if (!outcome) continue;
    if (!KEYS.has(outcome)) return { error: `Unbekannte Behandlung bei Aussage ${s.nr}.`, values };
    if (reason.length > 300) return { error: `Die Begründung bei Aussage ${s.nr} ist länger als 300 Zeichen.`, values };
    chosen.push({ id: s.id, outcome, reason: reason || null });
  }
  if (publish && (!datum || summary.length < 10)) return { error: "Zum Veröffentlichen braucht es das Datum der Sitzung und einen Satz, was beschlossen wurde.", values };
  if (publish && !chosen.length) return { error: "Vermerken Sie wenigstens bei einer Aussage, wie sie behandelt wurde.", values };

  const actor = `user:${staff.user.id}`;
  const db = getDb();
  const before = await db.execute(sql`SELECT state FROM campaign_decisions WHERE campaign_id = ${c.id}`);
  const wasPublished = (before.rows[0] as { state?: string } | undefined)?.state === "veroeffentlicht";
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_decisions (campaign_id, tenant_id, gremium, datum, summary, updated_by)
      VALUES (${c.id}, ${c.tenantId}, ${gremium}, ${datum || null}, ${summary || null}, ${actor})
      ON CONFLICT (campaign_id) DO UPDATE SET gremium = EXCLUDED.gremium, datum = EXCLUDED.datum, summary = EXCLUDED.summary,
        updated_by = EXCLUDED.updated_by, updated_at = now()`);
    await tx.execute(sql`DELETE FROM point_decisions WHERE campaign_id = ${c.id}`);
    for (const p of chosen) {
      await tx.execute(sql`
        INSERT INTO point_decisions (campaign_id, map_point_id, tenant_id, outcome, reason, decided_by)
        VALUES (${c.id}, ${p.id}, ${c.tenantId}, ${p.outcome}, ${p.reason}, ${actor})`);
    }
    if (publish && !wasPublished) {
      await tx.execute(sql`UPDATE campaign_decisions SET state = 'veroeffentlicht', published_at = now(), published_by = ${actor} WHERE campaign_id = ${c.id}`);
    }
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${c.tenantId}, ${actor}, ${publish && !wasPublished ? "decision.published" : "decision.saved"}, 'campaign', ${c.id},
              ${JSON.stringify({ gremium, datum: datum || null, points: chosen.length, published: publish || wasPublished })})`);
  });

  revalidatePath(`/verwaltung/${id}`, "layout");
  revalidatePath(`/${staff.tenant.slug}/${c.slug}`, "layout");
  if (publish && !wasPublished) {
    const sent = await notifyFollowers(c, "beschluss");
    return {
      ok: `Veröffentlicht. Jeder Laufzettel zeigt jetzt, was aus dem Punkt geworden ist.${sent ? ` ${sent} ${sent === 1 ? "Person bekommt" : "Personen bekommen"} eine E-Mail.` : ""}`,
      values,
    };
  }
  return { ok: wasPublished ? "Gespeichert. Die Änderung ist sofort öffentlich." : "Als Entwurf gespeichert. Öffentlich wird er erst, wenn Sie veröffentlichen.", values };
}
