"use server";

import { createHash } from "node:crypto";

import { sql } from "@policy/db";
import { extractFileText, readScan, syncDerivedVotes, UnreadableFile } from "@policy/pipeline/kern";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { castVote } from "@/lib/abstimmung";
import { batchTokens, filesOf, uploadProblem } from "@/lib/absender";
import { getPublicCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { enqueue, kernDeps } from "@/lib/kern";
import { follow } from "@/lib/folgen";
import { noticeQuery } from "@/lib/notice";
import { ensureParticipant, getParticipant, LIMITS, originHash, ParticipationError, redeemCode, trackingToken, within } from "@/lib/teilnahme";
import { answerShort as answerShortCore, runShortCheck, shortByToken, storeShort } from "@/lib/tuer2";

type Row = Record<string, unknown>;

export interface DoorState {
  error?: string;
  ok?: string;
  values?: Record<string, string>;
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function open(gemeinde: string, verfahren: string) {
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) redirect("/");
  const base = `/${c.tenant.slug}/${c.slug}`;
  if (c.state !== "offen") redirect(base);
  return { c, base };
}

/**
 * The entry with a code from a letter. Access "einladung": the code opens a pseudonym for this
 * browser. An open procedure: the code marks the pseudonym as invited by letter (the cross-check
 * by lot); taking part never needed it.
 */
export async function startWithCode(gemeinde: string, verfahren: string, _prev: DoorState, form: FormData): Promise<DoorState> {
  const { c, base } = await open(gemeinde, verfahren);
  const code = field(form, "code");
  try {
    if (c.params.access === "einladung") await ensureParticipant(c, code);
    else {
      const p = await ensureParticipant(c);
      const r = await redeemCode(c, p.id, code);
      if (r === "unbekannt") return { error: "Diesen Code kennen wir nicht, oder er wurde schon benutzt. Mitmachen kannst du trotzdem.", values: { code } };
      if (r === "schon") redirect(`${base}/abstimmen?${noticeQuery("Du nimmst in diesem Browser schon mit einem Code teil.")}`);
    }
  } catch (e) {
    if (e instanceof ParticipationError) return { error: e.message, values: { code } };
    throw e;
  }
  redirect(`${base}/abstimmen`);
}

/** Door 1: one click, one vote; the deck moves on. */
export async function vote(gemeinde: string, verfahren: string, statementId: string, version: number, value: -1 | 0 | 1): Promise<void> {
  const { c, base } = await open(gemeinde, verfahren);
  let p;
  try {
    p = await ensureParticipant(c);
  } catch (e) {
    if (e instanceof ParticipationError) redirect(`${base}?${noticeQuery(e.message)}`);
    throw e;
  }
  if (!(await within("vote", p.id))) redirect(`${base}/abstimmen?${noticeQuery("Langsam: so schnell kann niemand lesen. Warte einen Moment.")}`);
  const counted = await castVote(c, p.id, statementId, value === 1 || value === -1 ? value : 0, Number(version) || undefined);
  if (!counted) redirect(`${base}/abstimmen?${noticeQuery("Diese Aussage wurde gerade geändert oder zurückgezogen. Deine Stimme ist nicht gezählt; sieh dir die Karte bitte noch einmal an.")}`);
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

  const run = await runShortCheck(c, text);
  const { token } = await storeShort(c, p.id, text, run);
  if (run.check.outcome === "neu") redirect(`${base}/laufzettel/${token}`);
  redirect(`${base}/punkt/${token}`);
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
  await answerShortCore(c, s, answer);
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
  // One upload may hold a statement and its attachments: all of it is this one sender.
  const files = filesOf(form, "file");
  const problem = uploadProblem(files, true);
  if (problem) return { error: problem, values };
  if (as === "organisation" && org.length < 3) return { error: "Für wen schreibst du? Der Name erscheint bei jedem Zitat.", values };
  let p;
  try {
    p = await ensureParticipant(c, field(form, "code") || undefined);
  } catch (e) {
    if (e instanceof ParticipationError) return { error: e.message, values };
    throw e;
  }
  // Every file costs the machine a reading: the daily limit counts files.
  if (!(await within("upload", p.id, files.length)))
    return {
      error: `Am Tag gehen bis zu ${LIMITS.uploadsPerDay} Dateien. ${files.length > 1 ? "Lade heute weniger hoch oder den Rest morgen." : "Bitte morgen wieder."}`,
      values,
    };

  const parts = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      return { file, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
    }),
  );
  // A file that is already there costs nothing: checked before anything is read.
  const db = getDb();
  const dup = await db.execute(sql`
    SELECT sha256 FROM campaign_files WHERE campaign_id = ${c.id} AND sha256 IN (SELECT jsonb_array_elements_text(${JSON.stringify(parts.map((x) => x.sha))}::jsonb))`);
  const there = new Set((dup.rows as Row[]).map((r) => r.sha256 as string));
  const fresh = parts.filter((x, i) => !there.has(x.sha) && parts.findIndex((y) => y.sha === x.sha) === i);
  if (!fresh.length) return { error: parts.length === 1 ? "Diese Datei liegt schon vor." : "Diese Dateien liegen schon vor.", values };
  let texts: string[];
  try {
    // A scan or a photo of a letter is read by the machine while the person waits (all files side by side);
    // typed files need no machine.
    const { llm } = await kernDeps((m) => console.log(`[kern] ${m}`));
    texts = await Promise.all(
      fresh.map((x) =>
        extractFileText(new Uint8Array(x.bytes), x.file.name, x.file.type || null, readScan(llm)).catch((e) => {
          if (e instanceof UnreadableFile && fresh.length > 1) throw new UnreadableFile(`„${x.file.name}“: ${e.message}`);
          throw e;
        }),
      ),
    );
  } catch (e) {
    if (e instanceof UnreadableFile) return { error: e.message, values };
    console.error("[tuer3] reading an upload failed:", e);
    return { error: "Die Datei ließ sich gerade nicht lesen. Bitte versuch es gleich noch einmal.", values };
  }
  // One tracking slip per file; the files of one upload share the slip number (TOKEN, TOKEN-2, …) and link to each other.
  const token = trackingToken();
  const tokenOf = (i: number) => (i === 0 ? token : `${token}-${i + 1}`);
  const fileIds = await db.transaction(async (tx) => {
    // An organisation is a participant of its own (assumption 3); a private person speaks as themselves.
    // The name is self-declared, so it is tied to this browser: typing another group's name opens a new
    // participant, it never speaks with (or cancels) the votes of the one who uploaded first.
    let participant = p.id;
    if (as === "organisation") {
      const r = await tx.execute(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language, via)
        VALUES (${c.tenantId}, ${c.consultationId}, ${`org:${org.toLowerCase().replace(/\s+/g, " ")}|${p.id}`}, ${org}, ${orgType}, 'de', 'stellungnahme')
        ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org RETURNING id`);
      participant = (r.rows[0] as Row).id as string;
    }
    const ids: string[] = [];
    for (const [i, x] of fresh.entries()) {
      const f = await tx.execute(sql`
        INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, participant_id)
        VALUES (${c.tenantId}, ${c.id}, 'stellungnahme', ${x.file.name}, ${x.file.type || null}, ${x.file.size}, ${x.sha}, ${x.bytes},
                ${as === "organisation" ? org : null}, ${as === "organisation" ? orgType : "privat"}, ${participant})
        ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`);
      const fid = (f.rows[0] as Row | undefined)?.id as string | undefined;
      if (!fid) continue;
      const s = await tx.execute(sql`
        INSERT INTO submissions (tenant_id, consultation_id, door, author_org, author_type, language, source_system, source_ref, text,
                                 submitted_at, participant_id, tracking_token)
        VALUES (${c.tenantId}, ${c.consultationId}, 'document', ${as === "organisation" ? org : null}, ${as === "organisation" ? orgType : "privat"},
                'de', 'beteiligung', ${fid}, ${texts[i]!}, now(), ${participant}, ${tokenOf(ids.length)}) RETURNING id`);
      await tx.execute(sql`UPDATE campaign_files SET submission_id = ${(s.rows[0] as Row).id as string} WHERE id = ${fid}`);
      ids.push(fid);
    }
    return ids;
  });
  if (!fileIds.length) return { error: "Diese Datei liegt schon vor.", values };
  for (const fid of fileIds) await enqueue(c.tenantId, c.id, "zerlegen", fid);
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

/**
 * Voluntary news by e-mail: when the result is out and when the council has decided. The links to
 * this browser's tracking slips go with the address, so the message can say what became of them.
 */
export async function followCampaign(gemeinde: string, verfahren: string, token: string | null, _prev: DoorState, form: FormData): Promise<DoorState> {
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) return { error: "Dieses Verfahren gibt es nicht." };
  const email = field(form, "email");
  const db = getDb();
  const me = await getParticipant(c);
  const tokens = new Set<string>();
  if (me) {
    const r = await db.execute(sql`SELECT tracking_token FROM submissions WHERE participant_id = ${me.id} AND tracking_token IS NOT NULL`);
    for (const x of r.rows as Row[]) tokens.add(x.tracking_token as string);
  }
  if (token) {
    // The slip and the other files uploaded with it (they share its number).
    const batch = await batchTokens(c.consultationId, token);
    if (batch.some((b) => b.token === token)) for (const b of batch) tokens.add(b.token);
    else {
      const r = await db.execute(sql`SELECT 1 FROM submissions WHERE consultation_id = ${c.consultationId} AND tracking_token = ${token}`);
      if (r.rows.length) tokens.add(token);
    }
  }
  const res = await follow(c, email, [...tokens], await originHash(c, "folgen"));
  if (!res.ok) return { error: res.error, values: { email } };
  return {
    ok: res.already
      ? "Diese Adresse bekommt die Nachrichten schon."
      : "Fast geschafft: Wir haben dir eine E-Mail geschickt. Bitte bestätige den Link darin, sonst schreiben wir dir nicht.",
  };
}
