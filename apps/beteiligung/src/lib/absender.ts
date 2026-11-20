/**
 * Several files per sender. A statement often comes with attachments, and an organisation may write twice:
 * all of it is one sender, so one participant in the result (its votes count once). Organisations are
 * matched by name (packages/pipeline/src/kern/absender.ts, applied when the machine reads a file); a
 * private person has no name we keep, so only the files uploaded together share one participant.
 *
 * Citizens' uploads (door 3) are the files with a participant and no staff member behind them; every
 * other file is one the town brought in.
 */
import { randomUUID } from "node:crypto";

import { sql, type Db } from "@policy/db";
import { senderKey } from "@policy/pipeline/kern/absender";

import { getDb } from "./db";

/** One upload: a statement and its attachments. Next's limit for the whole request is set just above (next.config.ts). */
export const UPLOAD = { maxFiles: 10, maxFile: 20 * 1024 * 1024, maxTotal: 40 * 1024 * 1024 } as const;

/** The files of a form field, without the empty entry a browser sends when nothing was chosen. */
export const filesOf = (form: FormData, name: string): File[] => form.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);

/** Why a set of files cannot be taken, in the form's words (Sie or du), or null. */
export function uploadProblem(files: File[], du: boolean): string | null {
  if (!files.length) return du ? "Bitte wähle eine Datei aus." : "Bitte wählen Sie eine Datei aus.";
  if (files.length > UPLOAD.maxFiles) return `Höchstens ${UPLOAD.maxFiles} Dateien auf einmal.`;
  const big = files.find((f) => f.size > UPLOAD.maxFile);
  if (big) return `„${big.name}“ ist größer als 20 MB.${du ? "" : " Bitte teilen Sie die Datei auf."}`;
  if (files.reduce((n, f) => n + f.size, 0) > UPLOAD.maxTotal)
    return du ? "Zusammen sind die Dateien größer als 40 MB. Lade sie bitte in zwei Schritten hoch." : "Zusammen sind die Dateien größer als 40 MB. Bitte laden Sie sie in zwei Schritten hoch.";
  return null;
}

/**
 * Which sender a statement file belongs to — files with the same value are one participant in the
 * result: a citizen's upload (door 3) by its participant, an organisation by its name, a private person
 * by the participant its files share (set at upload, or made when its single file was read).
 */
export function senderGroup(f: {
  id: string;
  sender: string | null;
  sender_type: string | null;
  participant_id: string | null;
  uploaded_by: string | null;
  /** The participant of the file's text, once the machine has read it. */
  read_by?: string | null;
}): string {
  const door3 = !!f.participant_id && !f.uploaded_by;
  if (!door3 && f.sender?.trim() && f.sender_type !== "privat") return `n:${senderKey(f.sender)}`;
  const who = f.participant_id ?? f.read_by ?? null;
  return who ? `p:${who}` : `f:${f.id}`;
}

/** How many senders the town brought statements from (not the files: a statement with attachments is one). */
export async function townSenders(campaignId: string): Promise<number> {
  const r = await getDb().execute(sql`
    SELECT f.id, f.sender, f.sender_type, f.participant_id, f.uploaded_by, s.participant_id AS read_by
    FROM campaign_files f LEFT JOIN submissions s ON s.id = f.submission_id
    WHERE f.campaign_id = ${campaignId} AND f.role = 'stellungnahme' AND NOT (f.participant_id IS NOT NULL AND f.uploaded_by IS NULL)`);
  return new Set((r.rows as Parameters<typeof senderGroup>[0][]).map(senderGroup)).size;
}

export interface KnownSender {
  name: string;
  files: number;
}

/** The organisations the town has brought in statements from, first spelling first, with how many files each. */
export async function knownSenders(campaignId: string): Promise<KnownSender[]> {
  const r = await getDb().execute(sql`
    SELECT sender, count(*)::int AS files FROM campaign_files
    WHERE campaign_id = ${campaignId} AND role = 'stellungnahme' AND sender IS NOT NULL AND btrim(sender) <> ''
      AND COALESCE(sender_type, '') <> 'privat' AND NOT (participant_id IS NOT NULL AND uploaded_by IS NULL)
    GROUP BY sender ORDER BY min(created_at), sender`);
  const out = new Map<string, KnownSender>();
  for (const x of r.rows as { sender: string; files: number }[]) {
    const key = senderKey(x.sender);
    const had = out.get(key);
    if (had) had.files += Number(x.files);
    else out.set(key, { name: x.sender.trim(), files: Number(x.files) });
  }
  return [...out.values()];
}

/** A private person's files uploaded together: one participant for all of them, made before they are read. */
export async function privateSender(tx: Pick<Db, "execute">, c: { tenantId: string; consultationId: string }): Promise<string> {
  const r = await tx.execute(sql`
    INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language, via)
    VALUES (${c.tenantId}, ${c.consultationId}, ${`absender-privat:${randomUUID()}`}, NULL, 'privat', 'de', 'datei') RETURNING id`);
  return (r.rows[0] as { id: string }).id;
}

/**
 * The tracking slips of one citizen's upload: its files share the slip number (TOKEN, TOKEN-2, …).
 * Returns every token of the upload the given one belongs to, with its file name, in upload order.
 */
export async function batchTokens(consultationId: string, token: string): Promise<{ token: string; filename: string | null }[]> {
  const base = token.split("-")[0]!;
  const r = await getDb().execute(sql`
    SELECT s.tracking_token, f.filename FROM submissions s LEFT JOIN campaign_files f ON f.submission_id = s.id
    WHERE s.consultation_id = ${consultationId} AND s.door = 'document' AND (s.tracking_token = ${base} OR s.tracking_token LIKE ${`${base}-%`})`);
  const n = (t: string) => Number(t.split("-")[1] ?? 1);
  return (r.rows as { tracking_token: string; filename: string | null }[])
    .map((x) => ({ token: x.tracking_token, filename: x.filename }))
    .sort((a, b) => n(a.token) - n(b.token));
}

/** After a file is removed before reading: its private sender goes too, if nothing else is left of it. */
export async function dropEmptySender(participantId: string | null): Promise<void> {
  if (!participantId) return;
  await getDb().execute(sql`
    DELETE FROM participants p WHERE p.id = ${participantId} AND p.via = 'datei' AND p.source_ref LIKE 'absender-privat:%'
      AND NOT EXISTS (SELECT 1 FROM campaign_files f WHERE f.participant_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.participant_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM map_point_votes v WHERE v.participant_id = p.id)`);
}
