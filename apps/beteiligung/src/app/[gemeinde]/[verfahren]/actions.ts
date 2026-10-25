"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { checkShortStatement, extractFileText, KERN_SHORT_FAMILY, syncDerivedVotes, UnreadableFile, type ShortCheck } from "@policy/pipeline/kern";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { castVote } from "@/lib/abstimmung";
import { getPublicCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue, kernCampaign, kernDeps, releasedNodes } from "@/lib/kern";
import { ensureParticipant, LIMITS, ParticipationError, trackingToken, within } from "@/lib/teilnahme";

type Row = Record<string, unknown>;

export interface DoorState {
  error?: string;
  values?: Record<string, string>;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const MAX_FILE = 20 * 1024 * 1024;

async function open(gemeinde: string, verfahren: string) {
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) redirect("/");
  const base = `/${c.tenant.slug}/${c.slug}`;
  if (c.state !== "offen") redirect(base);
  return { c, base };
}

/** The entry with an invitation code (access "einladung"): the code opens a pseudonym for this browser. */
export async function startWithCode(gemeinde: string, verfahren: string, _prev: DoorState, form: FormData): Promise<DoorState> {
  const { c, base } = await open(gemeinde, verfahren);
  try {
    await ensureParticipant(c, field(form, "code"));
  } catch (e) {
    if (e instanceof ParticipationError) return { error: e.message, values: { code: field(form, "code") } };
    throw e;
  }
  redirect(`${base}/abstimmen`);
}

/** Door 1: one click, one vote; the deck moves on. */
export async function vote(gemeinde: string, verfahren: string, statementId: string, value: -1 | 0 | 1): Promise<void> {
  const { c, base } = await open(gemeinde, verfahren);
  let p;
  try {
    p = await ensureParticipant(c);
  } catch (e) {
    if (e instanceof ParticipationError) redirect(`${base}?hinweis=${encodeURIComponent(e.message)}`);
    throw e;
  }
  if (!(await within("vote", p.id))) redirect(`${base}/abstimmen?hinweis=${encodeURIComponent("Langsam: so schnell kann niemand lesen. Warte einen Moment.")}`);
  await castVote(c, p.id, statementId, value === 1 || value === -1 ? value : 0);
  redirect(`${base}/abstimmen`);
}

/**
 * Door 2 (B5/B6): the citizen's point, checked while they wait — Jev only:
 * an argument at all? A point that is already there, or its opposite?
 */
export async function submitShort(gemeinde: string, verfahren: string, _prev: DoorState, form: FormData): Promise<DoorState> {
  const { c, base } = await open(gemeinde, verfahren);
  if (!c.params.doors.kurzaussage) redirect(base);
  const text = field(form, "text").replace(/\s+/g, " ");
  const values = { text };
  if (text.length < 12) return { error: "Schreib bitte einen ganzen Satz: was fehlt, und warum.", values };
  if (text.length > LIMITS.shortMaxChars) return { error: `Höchstens ${LIMITS.shortMaxChars} Zeichen. Zwei Sätze reichen.`, values };
  let p;
  try {
    p = await ensureParticipant(c, field(form, "code") || undefined);
  } catch (e) {
    if (e instanceof ParticipationError) return { error: e.message, values };
    throw e;
  }
  if (!(await within("short", p.id))) return { error: "Du hast in der letzten Stunde schon mehrere Punkte geschickt. Bitte später wieder.", values };

  const db = getDb();
  const token = trackingToken();
  const s = await db.execute(sql`
    INSERT INTO submissions (tenant_id, consultation_id, door, author_type, language, source_system, text, submitted_at, participant_id, tracking_token)
    VALUES (${c.tenantId}, ${c.consultationId}, 'statement', 'privat', 'de', 'beteiligung', ${text}, now(), ${p.id}, ${token}) RETURNING id`);
  const submissionId = (s.rows[0] as Row).id as string;

  const kc = kernCampaign(c, c.tenant.name);
  const deps = await kernDeps((m) => console.log(`[tuer2] ${m}`));
  let check: ShortCheck;
  try {
    const r = await checkShortStatement(deps.judge, kc.context, text, await releasedNodes(c.consultationId));
    check = r.check;
    await db.execute(sql`
      INSERT INTO judgments (tenant_id, consultation_id, subject_kind, subject_id, family, model, request_id, answers, decided)
      VALUES (${c.tenantId}, ${c.consultationId}, 'submission', ${submissionId}, ${KERN_SHORT_FAMILY}, ${r.provenance.at(-1)?.model ?? "jev"},
              ${r.provenance.at(-1)?.requestId ?? null}, ${JSON.stringify(r.answers)}, ${JSON.stringify({ ...check, answer: "offen" })})`);
  } catch (e) {
    // The quick check is a convenience: without it, the point goes to the editors as it is.
    console.error("[tuer2] check failed", e);
    check = { outcome: "neu", node: null, stance: 1, pArgument: 1, pPersonal: 0, match: null };
  }
  if (check.outcome === "neu") {
    await enqueue(c.tenantId, c.id, "kurzaussage", null, submissionId);
    redirect(`${base}/laufzettel/${token}`);
  }
  redirect(`${base}/punkt/${token}`);
}

async function shortByToken(c: { consultationId: string }, token: string) {
  const r = await getDb().execute(sql`
    SELECT s.id, s.participant_id, s.text, j.decided FROM submissions s
    LEFT JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text AND j.family = ${KERN_SHORT_FAMILY}
    WHERE s.consultation_id = ${c.consultationId} AND s.tracking_token = ${token} AND s.door = 'statement'`);
  return (r.rows[0] as Row | undefined) ?? null;
}

/**
 * B7: the citizen's answer to "Das könnte ein Punkt sein, den es schon gibt".
 * "Ja" counts as their vote on that point (assumption 2) and their words join
 * its sources; "Nein" (or "trotzdem schicken") sends the point to the editors.
 */
export async function answerShort(gemeinde: string, verfahren: string, token: string, answer: "ja" | "nein"): Promise<void> {
  const { c, base } = await open(gemeinde, verfahren);
  // The tracking-slip token is the key: whoever holds the link answers for the point.
  const s = await shortByToken(c, token);
  if (!s) redirect(base);
  const decided = (s.decided ?? {}) as ShortCheck & { answer?: string };
  if (decided.answer && decided.answer !== "offen") redirect(`${base}/laufzettel/${token}`);
  const db = getDb();
  const text = s.text as string;
  if (answer === "ja" && decided.node) {
    await db.transaction(async (tx) => {
      const n = await tx.execute(sql`
        SELECT id, text, label, typ, schritt, frage, richtung, einwand FROM map_points
        WHERE id = ${decided.node} AND consultation_id = ${c.consultationId} AND status = 'released'`);
      const node = n.rows[0] as Row | undefined;
      if (!node) return;
      await tx.execute(sql`
        INSERT INTO moves (tenant_id, consultation_id, submission_id, ord, quote, span_start, span_end, kern, aussage, label, typ, schritt,
                           frage, richtung, einwand, beleg, match, route, state, map_point_id, stance, decided_by, decided_at, decision)
        VALUES (${c.tenantId}, ${c.consultationId}, ${s.id as string}, 0, ${text}, 0, ${text.length}, ${text}, ${node.text as string},
                ${node.label as string}, ${node.typ === "W" || node.typ === "T" || node.typ === "verfahren" ? (node.typ as string) : "W"},
                ${(node.schritt as string | null) ?? null}, ${(node.frage as string | null) ?? null}, ${(node.richtung as string | null) ?? null},
                ${(node.einwand as string | null) ?? null}, 'keine', ${JSON.stringify(decided.match)}, ${decided.stance === -1 ? "gegenteil" : "auto"},
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
  redirect(`${base}/laufzettel/${token}`);
}

/** Door 3 (B10): a full statement, read at once (Z1) so an unreadable file is said right away. */
export async function uploadStatement(gemeinde: string, verfahren: string, _prev: DoorState, form: FormData): Promise<DoorState> {
  const { c, base } = await open(gemeinde, verfahren);
  if (!c.params.doors.stellungnahme) redirect(base);
  const as = field(form, "als") === "organisation" ? "organisation" : "privat";
  const org = field(form, "org");
  const orgType = field(form, "orgType") || "verband";
  const values = { als: as, org, orgType };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Bitte wähle eine Datei aus.", values };
  if (file.size > MAX_FILE) return { error: "Die Datei ist größer als 20 MB.", values };
  if (as === "organisation" && org.length < 3) return { error: "Für wen schreibst du? Der Name erscheint bei jedem Zitat.", values };
  let p;
  try {
    p = await ensureParticipant(c, field(form, "code") || undefined);
  } catch (e) {
    if (e instanceof ParticipationError) return { error: e.message, values };
    throw e;
  }
  if (!(await within("upload", p.id))) return { error: "Du hast heute schon mehrere Stellungnahmen hochgeladen. Bitte morgen wieder.", values };

  const bytes = Buffer.from(await file.arrayBuffer());
  let text: string;
  try {
    text = await extractFileText(new Uint8Array(bytes), file.name, file.type || null);
  } catch (e) {
    if (e instanceof UnreadableFile) return { error: e.message, values };
    throw e;
  }
  const db = getDb();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const token = trackingToken();
  const fileId = await db.transaction(async (tx) => {
    // An organisation is a participant of its own (assumption 3); a private person speaks as themselves.
    let participant = p.id;
    if (as === "organisation") {
      const r = await tx.execute(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language, via)
        VALUES (${c.tenantId}, ${c.consultationId}, ${`org:${org.toLowerCase().replace(/\s+/g, " ")}`}, ${org}, ${orgType}, 'de', 'stellungnahme')
        ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org RETURNING id`);
      participant = (r.rows[0] as Row).id as string;
    }
    const f = await tx.execute(sql`
      INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, participant_id)
      VALUES (${c.tenantId}, ${c.id}, 'stellungnahme', ${file.name}, ${file.type || null}, ${file.size}, ${sha}, ${bytes},
              ${as === "organisation" ? org : null}, ${as === "organisation" ? orgType : "privat"}, ${participant})
      ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
    const fid = (f.rows[0] as Row | undefined)?.id as string | undefined;
    if (!fid) return null;
    const s = await tx.execute(sql`
      INSERT INTO submissions (tenant_id, consultation_id, door, author_org, author_type, language, source_system, source_ref, text,
                               submitted_at, participant_id, tracking_token)
      VALUES (${c.tenantId}, ${c.consultationId}, 'document', ${as === "organisation" ? org : null}, ${as === "organisation" ? orgType : "privat"},
              'de', 'beteiligung', ${fid}, ${text}, now(), ${participant}, ${token}) RETURNING id`);
    await tx.execute(sql`UPDATE campaign_files SET submission_id = ${(s.rows[0] as Row).id as string} WHERE id = ${fid}`);
    return fid;
  });
  if (!fileId) return { error: "Diese Datei liegt schon vor.", values };
  await enqueue(c.tenantId, c.id, "zerlegen", fileId);
  revalidatePath(`/verwaltung/${c.id}`, "layout");
  redirect(`${base}/laufzettel/${token}`);
}

/** B9 "Das meint mein Punkt nicht": the author's objection sends the assignment back to the editors. */
export async function objectToAssignment(gemeinde: string, verfahren: string, token: string, moveId: string): Promise<void> {
  const { c, base } = await open(gemeinde, verfahren);
  const db = getDb();
  const r = await db.execute(sql`
    UPDATE moves m SET state = 'vorgelegt', decision = COALESCE(m.decision, '{}'::jsonb) || '{"einspruch": true}'::jsonb
    FROM submissions s WHERE m.id = ${moveId} AND m.submission_id = s.id AND s.tracking_token = ${token}
      AND s.consultation_id = ${c.consultationId} AND m.state = 'verknuepft'
    RETURNING m.id`);
  if (r.rows.length) {
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id) VALUES (${c.tenantId}, 'teilnehmer', 'kern.move.einspruch', 'move', ${moveId})`);
    await syncDerivedVotes(db, c.consultationId);
  }
  redirect(`${base}/laufzettel/${token}?einspruch=1`);
}
