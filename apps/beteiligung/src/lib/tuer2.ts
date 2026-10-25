/**
 * Door 2 (Gesamtmodell B5–B7) without the web layer: check a short point,
 * store it, take the citizen's answer. The website's actions and the demo
 * script go through the same functions, so a scripted input lands exactly
 * where a typed one would.
 */

import { randomBytes } from "node:crypto";

import { sql } from "@policy/db";
import { checkShortStatement, KERN_SHORT_FAMILY, PERSONAL_FROM, syncDerivedVotes, type MatchNode, type ShortCheck } from "@policy/pipeline/kern";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { enqueue, kernCampaign, kernDeps, releasedNodes } from "./kern";

type Row = Record<string, unknown>;
type C = Campaign & { tenant: { name: string } };

/** The secret part of a tracking-slip link (B9): short, unambiguous to read aloud. */
export function trackingToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export interface ShortRun {
  check: ShortCheck;
  answers: Record<string, unknown>;
  model: string | null;
  requestId: string | null;
}

/** B6, Jev only, while the citizen waits. Without a check the point simply goes to the editors. */
export async function runShortCheck(c: C, text: string, nodes?: MatchNode[]): Promise<ShortRun> {
  const kc = kernCampaign(c, c.tenant.name);
  const deps = await kernDeps((m) => console.log(`[tuer2] ${m}`));
  try {
    const r = await checkShortStatement(deps.judge, kc.context, text, nodes ?? (await releasedNodes(c.consultationId)));
    return { check: r.check, answers: r.answers, model: r.provenance.at(-1)?.model ?? null, requestId: r.provenance.at(-1)?.requestId ?? null };
  } catch (e) {
    console.error("[tuer2] check failed", e);
    return { check: { outcome: "neu", node: null, stance: 1, aim: null, pArgument: 1, pPersonal: 0, match: null }, answers: {}, model: null, requestId: null };
  }
}

/** Store the point with its check; a new point goes straight to the machine and then the editors. */
export async function storeShort(
  c: C,
  participantId: string,
  text: string,
  run: ShortRun,
  opts: { sourceSystem?: string } = {},
): Promise<{ submissionId: string; token: string }> {
  const db = getDb();
  const token = trackingToken();
  const s = await db.execute(sql`
    INSERT INTO submissions (tenant_id, consultation_id, door, author_type, language, source_system, text, submitted_at, participant_id, tracking_token)
    VALUES (${c.tenantId}, ${c.consultationId}, 'statement', 'privat', 'de', ${opts.sourceSystem ?? "beteiligung"}, ${text}, now(), ${participantId}, ${token})
    RETURNING id`);
  const submissionId = (s.rows[0] as Row).id as string;
  if (run.model) {
    await db.execute(sql`
      INSERT INTO judgments (tenant_id, consultation_id, subject_kind, subject_id, family, model, request_id, answers, decided)
      VALUES (${c.tenantId}, ${c.consultationId}, 'submission', ${submissionId}, ${KERN_SHORT_FAMILY}, ${run.model}, ${run.requestId},
              ${JSON.stringify(run.answers)}, ${JSON.stringify({ ...run.check, answer: "offen" })})`);
  }
  if (run.check.outcome === "neu") await enqueue(c.tenantId, c.id, "kurzaussage", null, submissionId);
  return { submissionId, token };
}

export async function shortByToken(c: { consultationId: string }, token: string) {
  const r = await getDb().execute(sql`
    SELECT s.id, s.participant_id, s.text, j.decided FROM submissions s
    LEFT JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text AND j.family = ${KERN_SHORT_FAMILY}
    WHERE s.consultation_id = ${c.consultationId} AND s.tracking_token = ${token} AND s.door = 'statement'`);
  return (r.rows[0] as Row | undefined) ?? null;
}

const flip = (r: string | null) => (r === "stuetzt" ? "greift_an" : r === "greift_an" ? "stuetzt" : null);

/**
 * B7: "Ja" counts as the citizen's vote on that point (assumption 2) and their
 * words join its sources, with what they want for the measure (the check's
 * aim; else read off the point). "Nein" sends the point to the editors.
 */
export async function answerShort(c: C, s: Row, answer: "ja" | "nein"): Promise<void> {
  const decided = (s.decided ?? {}) as ShortCheck & { answer?: string };
  if (decided.answer && decided.answer !== "offen") return;
  const db = getDb();
  const text = s.text as string;
  if (answer === "ja" && decided.node) {
    await db.transaction(async (tx) => {
      const n = await tx.execute(sql`
        SELECT id, text, label, typ, schritt, frage, richtung, einwand FROM map_points
        WHERE id = ${decided.node} AND consultation_id = ${c.consultationId} AND status = 'released'`);
      const node = n.rows[0] as Row | undefined;
      if (!node) return;
      const own = (node.richtung as string | null) ?? null;
      const richtung = decided.aim ?? (decided.stance === -1 ? flip(own) : own);
      // Names a private person: the vote counts, the words are never shown in public.
      const flags = (decided.pPersonal ?? 0) >= PERSONAL_FROM ? ["personal_data"] : [];
      await tx.execute(sql`
        INSERT INTO moves (tenant_id, consultation_id, submission_id, ord, quote, span_start, span_end, kern, aussage, label, typ, schritt,
                           frage, richtung, einwand, beleg, flags, match, route, state, map_point_id, stance, decided_by, decided_at, decision)
        VALUES (${c.tenantId}, ${c.consultationId}, ${s.id as string}, 0, ${text}, 0, ${text.length}, ${text}, ${node.text as string},
                ${node.label as string}, ${node.typ === "W" || node.typ === "T" || node.typ === "verfahren" ? (node.typ as string) : "W"},
                ${(node.schritt as string | null) ?? null}, ${(node.frage as string | null) ?? null}, ${richtung},
                ${(node.einwand as string | null) ?? null}, 'keine', ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(flags)}::jsonb)),
                ${JSON.stringify(decided.match)}, ${decided.stance === -1 ? "gegenteil" : "auto"},
                'verknuepft', ${node.id as string},
                ${decided.stance}, 'teilnehmer', now(), ${JSON.stringify({ action: "vom_verfasser_bestaetigt" })})`);
      await tx.execute(sql`
        UPDATE judgments SET decided = decided || '{"answer":"ja"}'::jsonb
        WHERE subject_kind = 'submission' AND subject_id = ${s.id as string} AND family = ${KERN_SHORT_FAMILY}`);
    });
    await syncDerivedVotes(db, c.consultationId);
  } else {
    await db.execute(sql`
      UPDATE judgments SET decided = decided || ${JSON.stringify({ answer: "nein" })}::jsonb
      WHERE subject_kind = 'submission' AND subject_id = ${s.id as string} AND family = ${KERN_SHORT_FAMILY}`);
    await enqueue(c.tenantId, c.id, "kurzaussage", null, s.id as string);
  }
}
