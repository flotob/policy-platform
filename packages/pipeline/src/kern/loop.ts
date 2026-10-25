/**
 * The core loop (Gesamtmodell §2): one pipeline, called from three places —
 * existing statements (E4), door 2 and door 3. Here: the start skeleton (E2)
 * and the decomposition of one uploaded statement (Z1–Z5, Z8); the editorial
 * part (Z6/Z7) is ./decide.ts, applied by people or, in AI mode, by
 * machineDecides below.
 *
 *   Z1 text → submission         (code)
 *   Z2/Z3 moves + fixed fields   (LLM, one call per window, cached in `extractions`)
 *   I4 quote located verbatim    (code; a move without its passage is dropped)
 *   rule checks on the fields    (code: question fits the step, label fits the question)
 *   Z4 known / opposite / new    (Jev, one call per move, against the campaign's nodes)
 *   Z5 routing                   (code, ./match.ts)
 *   new claim → proposed node    (draft; waits for release, I1) + Jev recommendation
 *
 * Moves are matched one after another, so the tenth "Das Handwerk schafft das
 * nicht" lands on the node the first one proposed: editors decide nodes, not
 * statements.
 */

import { createHash, randomUUID } from "node:crypto";

import { sql, type Db } from "@policy/db";
import type { JevJudge, LlmProvider } from "@policy/llm";

import { saveJudgment } from "../jev-stage.ts";
import { chunkText } from "../pipeline.ts";
import { locateQuote } from "../quote-span.ts";
import { audit, confirmMove, createNode, rejectNode, releaseNode, type NodeFields } from "./decide.ts";
import { KERN_MATCH_FAMILY, matchMove, route, shortlistNodes, type MatchNode, type MoveMatch, type Route } from "./match.ts";
import {
  movesJsonSchema,
  movesOutput,
  movesPrompt,
  movesSystem,
  skeletonJsonSchema,
  skeletonOutput,
  skeletonPrompt,
  SKELETON_SYSTEM,
  type KernContext,
  type MoveOutput,
  type QuestionKey,
  type StepKey,
} from "./prompts.ts";
import { KERN_REVIEW_FAMILY, reviewNode, type NodeReview } from "./review.ts";
import { KERN_SHORT_FAMILY, shortMovesJsonSchema, shortMovesOutput, shortPrompt } from "./short.ts";
import { extractFileText } from "./text.ts";

export type EditorialMode = "mensch" | "assistiert" | "ki";

export interface KernCampaign {
  id: string;
  tenantId: string;
  consultationId: string;
  context: KernContext;
  params: { matchThreshold: number; sampleRate: number; editorialMode: EditorialMode };
}

export interface KernDeps {
  db: Db;
  llm: LlmProvider;
  judge: JevJudge;
  log: (msg: string) => void;
  /** Spot-check draw (Z9); injectable for tests. */
  random?: () => number;
}

type Row = Record<string, unknown>;

/** The question a step's own supporting claims answer. */
const OWN_QUESTION: Record<StepKey, QuestionKey> = { lage: "lage", wirkung: "wirkung", weg: "weg", eingriff: "wert" };

/** What the town wrote, as a fingerprint: a changed justification makes the skeleton stale. */
export function justificationHash(c: KernContext): string {
  return createHash("sha256")
    .update(JSON.stringify({ q: c.question, m: c.measure, j: c.justification, s: c.steps.map((s) => [s.key, s.these]) }))
    .digest("hex")
    .slice(0, 16);
}

async function campaignNodes(db: Db, consultationId: string): Promise<MatchNode[]> {
  const r = await db.execute(sql`
    SELECT id, text, einwand, schritt FROM map_points
    WHERE consultation_id = ${consultationId} AND rolle IS NOT NULL AND status IN ('draft', 'released')`);
  return (r.rows as Row[]).map((x) => ({
    id: x.id as string,
    text: x.text as string,
    einwand: (x.einwand as string | null) ?? null,
    schritt: (x.schritt as string | null) ?? null,
  }));
}

async function saveReview(deps: KernDeps, c: KernCampaign, nodeId: string, text: string, quotes: string[]): Promise<NodeReview | null> {
  try {
    const { review, answers, provenance } = await reviewNode(deps.judge, { town: c.context.town, measure: c.context.measure }, { text, quotes });
    await deps.db.execute(sql`UPDATE map_points SET review = ${JSON.stringify(review)} WHERE id = ${nodeId}`);
    await saveJudgment(deps.db, {
      tenantId: c.tenantId,
      consultationId: c.consultationId,
      subjectKind: "map_point",
      subjectId: nodeId,
      family: KERN_REVIEW_FAMILY,
      provenance,
      answers,
      decided: review,
    });
    return review;
  } catch (e) {
    // A missing recommendation only means the editors decide without a hint.
    deps.log(`review failed for ${nodeId}: ${(e as Error).message}`);
    return null;
  }
}

// ——— E2: start skeleton ——————————————————————————————————————————————————

export async function proposeSkeleton(deps: KernDeps, c: KernCampaign): Promise<{ nodes: number; hash: string }> {
  const { db } = deps;
  const released = await db.execute(sql`
    SELECT 1 FROM map_points WHERE consultation_id = ${c.consultationId} AND rolle IN ('schluss', 'praemisse') AND status = 'released' LIMIT 1`);
  if (released.rows.length) throw new Error("Das Startgerüst ist schon (teilweise) freigegeben; es wird nicht mehr automatisch ersetzt.");

  const { output } = await deps.llm.generateStructured({ system: SKELETON_SYSTEM, prompt: skeletonPrompt(c.context), schema: skeletonJsonSchema });
  const sk = skeletonOutput.parse(output);
  const actor = "ki-skelett";

  const created: { id: string; text: string }[] = [];
  await db.transaction(async (tx) => {
    // A re-proposal replaces the earlier draft; moves already waiting on it keep their content as proposals of their own.
    const old = await tx.execute(sql`
      UPDATE map_points SET status = 'rejected'
      WHERE consultation_id = ${c.consultationId} AND rolle IN ('schluss', 'praemisse') AND status = 'draft' RETURNING id`);
    for (const o of old.rows as Row[]) {
      await audit(tx, { tenantId: c.tenantId, actor, action: "kern.node.reject", subjectKind: "map_point", subjectId: o.id as string, reason: "ersetzt" });
      const waiting = await tx.execute(sql`SELECT * FROM moves WHERE map_point_id = ${o.id as string} AND state = 'vorgelegt'`);
      for (const m of waiting.rows as Row[]) {
        const id = await createNode(tx, {
          tenantId: c.tenantId,
          consultationId: c.consultationId,
          rolle: "beitrag",
          createdBy: "ki",
          text: m.aussage as string,
          label: m.label as string,
          typ: m.typ as NodeFields["typ"],
          schritt: m.schritt as StepKey,
          frage: m.frage as QuestionKey,
          richtung: m.richtung as NodeFields["richtung"],
          einwand: (m.einwand as string | null) ?? null,
        });
        await tx.execute(sql`UPDATE moves SET map_point_id = ${id}, stance = 1, route = 'neu' WHERE id = ${m.id as string}`);
      }
    }
    const schluss = await createNode(tx, {
      tenantId: c.tenantId,
      consultationId: c.consultationId,
      rolle: "schluss",
      createdBy: actor,
      text: sk.schluss,
      label: "Die Maßnahme",
      typ: "W",
      schritt: null,
      frage: null,
      richtung: null,
      einwand: null,
    });
    created.push({ id: schluss, text: sk.schluss });
    for (const p of sk.praemissen) {
      const id = await createNode(tx, {
        tenantId: c.tenantId,
        consultationId: c.consultationId,
        rolle: "praemisse",
        createdBy: actor,
        text: p.aussage,
        label: p.label,
        typ: p.typ,
        schritt: p.schritt,
        frage: OWN_QUESTION[p.schritt],
        richtung: "stuetzt",
        einwand: null,
      });
      created.push({ id, text: p.aussage });
    }
    const hash = justificationHash(c.context);
    await audit(tx, { tenantId: c.tenantId, actor, action: "kern.skeleton", subjectKind: "campaign", subjectId: c.id, payload: { nodes: created.length, hash } });
  });
  for (const n of created) await saveReview(deps, c, n.id, n.text, []);
  deps.log(`skeleton: ${created.length} nodes`);
  return { nodes: created.length, hash: justificationHash(c.context) };
}

// ——— Z1–Z5: one uploaded statement ——————————————————————————————————————————

export interface DecomposeResult {
  windows: number;
  /** Moves the model proposed, and how many of them were kept. */
  proposed: number;
  moves: number;
  /** Proposed moves whose quote is not in the text (I4) — dropped. */
  quoteMissing: number;
  routes: Partial<Record<Route, number>>;
  newNodes: number;
}

const QUESTION_FITS = (c: KernContext, frage: QuestionKey, schritt: StepKey) => c.questions.find((q) => q.key === frage)?.steps.includes(schritt) ?? false;

/** Rule checks on the model's fields (Gesamtmodell Z3: the model proposes, the rule checks consistency). */
export function checkFields(c: KernContext, z: MoveOutput): { fields: MoveOutput; flags: string[] } {
  const flags: string[] = [];
  const f = { ...z };
  if (!QUESTION_FITS(c, f.frage, f.schritt)) {
    flags.push("frage_passt_nicht");
    f.frage = OWN_QUESTION[f.schritt];
  }
  // The label follows from the question: facts settle "Lage", "Wirkung", "Weg"; values settle "Wert".
  const expected = f.frage === "wert" ? "W" : f.frage === "nebenfolgen" ? (f.schritt === "eingriff" ? "W" : "T") : "T";
  if (f.typ !== "verfahren" && f.typ !== expected) flags.push("etikett_pruefen");
  if (f.richtung === "stuetzt") f.einwand = null;
  else if (!f.einwand) f.einwand = f.kern;
  return { fields: f, flags };
}

async function windowOutput(
  deps: KernDeps,
  c: KernCampaign,
  sub: { id: string; sender: string | null; senderType: string | null },
  w: { text: string; index: number; count: number; start: number },
): Promise<MoveOutput[]> {
  const system = movesSystem(c.context);
  const prompt = movesPrompt({ name: sub.sender, type: sub.senderType }, w);
  const model = process.env.LLM_MODEL ?? "claude-sonnet-5-5";
  const callHash = createHash("sha256").update(JSON.stringify({ system, prompt, schema: movesJsonSchema, model })).digest("hex");
  const cached = await deps.db.execute(sql`
    SELECT output FROM extractions WHERE submission_id = ${sub.id} AND window_index = ${w.index} AND call_hash = ${callHash}`);
  if (cached.rows[0]) return movesOutput.parse((cached.rows[0] as Row).output).zuege;
  const { output, provenance } = await deps.llm.generateStructured({ system, prompt, schema: movesJsonSchema, model });
  const parsed = movesOutput.parse(output);
  await deps.db.execute(sql`
    INSERT INTO extractions (tenant_id, consultation_id, submission_id, window_index, window_count, window_start, window_end,
                             call_hash, model, output, provenance)
    VALUES (${c.tenantId}, ${c.consultationId}, ${sub.id}, ${w.index}, ${w.count}, ${w.start}, ${w.start + w.text.length},
            ${callHash}, ${provenance.model}, ${JSON.stringify(parsed)}, ${JSON.stringify(provenance)})
    ON CONFLICT (submission_id, window_index, call_hash) DO NOTHING`);
  return parsed.zuege;
}

/**
 * The participant behind an uploaded statement: the one who uploaded it at
 * door 3, or — for the statements the town brought in (E4) — the sender as
 * a participant of its own (assumption 3: senders are participants).
 */
async function participantForFile(tx: Pick<Db, "execute">, c: KernCampaign, f: Row): Promise<string> {
  if (f.participant_id) return f.participant_id as string;
  const r = await tx.execute(sql`
    INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language, via)
    VALUES (${c.tenantId}, ${c.consultationId}, ${`datei:${f.id as string}`}, ${(f.sender as string | null) ?? null},
            ${(f.sender_type as string | null) ?? null}, 'de', 'datei')
    ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org RETURNING id`);
  return (r.rows[0] as Row).id as string;
}

/** Z1: the file's text as a submission (once; offsets point into it forever). */
async function submissionFor(deps: KernDeps, c: KernCampaign, fileId: string): Promise<Submission> {
  const { db } = deps;
  const r = await db.execute(sql`
    SELECT f.id, f.filename, f.mime, f.content, f.sender, f.sender_type, f.created_at, f.submission_id, f.participant_id, s.text,
      s.participant_id AS s_participant
    FROM campaign_files f LEFT JOIN submissions s ON s.id = f.submission_id
    WHERE f.id = ${fileId} AND f.campaign_id = ${c.id}`);
  const f = r.rows[0] as Row | undefined;
  if (!f) throw new Error("Die Datei gibt es nicht mehr.");
  const sender = (f.sender as string | null) ?? null;
  const senderType = (f.sender_type as string | null) ?? null;
  if (f.submission_id) {
    // Read before senders became participants: attach one now.
    if (!f.s_participant) {
      const pid = await participantForFile(db, c, f);
      await db.execute(sql`UPDATE submissions SET participant_id = ${pid} WHERE id = ${f.submission_id as string}`);
    }
    return { id: f.submission_id as string, text: f.text as string, sender, senderType };
  }
  const text = await extractFileText(new Uint8Array(f.content as Buffer), f.filename as string, (f.mime as string | null) ?? null);
  const id = await db.transaction(async (tx) => {
    const participant = await participantForFile(tx, c, f);
    const s = await tx.execute(sql`
      INSERT INTO submissions (tenant_id, consultation_id, door, author_org, author_type, language, source_system, source_ref, text,
                               submitted_at, participant_id)
      VALUES (${c.tenantId}, ${c.consultationId}, 'document', ${sender}, ${senderType}, 'de', 'beteiligung', ${fileId}, ${text},
              ${f.created_at as string}, ${participant})
      RETURNING id`);
    const sid = (s.rows[0] as Row).id as string;
    await tx.execute(sql`UPDATE campaign_files SET submission_id = ${sid} WHERE id = ${fileId}`);
    return sid;
  });
  return { id, text, sender, senderType };
}

interface Submission {
  id: string;
  text: string;
  sender: string | null;
  senderType: string | null;
}

/**
 * Z3–Z5 and Z8 for one proposed move: locate its quote, check its fields,
 * match it, route it, store it — and open a proposed node for a new claim.
 * `notNode`: a node the author already said is not what they mean (door 2,
 * "Nein, das ist etwas anderes") — the move never lands there on its own.
 */
async function processMove(
  deps: KernDeps,
  c: KernCampaign,
  sub: Submission,
  z: MoveOutput,
  ord: number,
  nodes: MatchNode[],
  result: DecomposeResult,
  opts: { notNode?: string | null } = {},
): Promise<void> {
  const { db } = deps;
  const random = deps.random ?? Math.random;
  const span = locateQuote(sub.text, z.zitat);
  if (!span) {
    result.quoteMissing++;
    return;
  }
  const { fields, flags } = checkFields(c.context, z);
  const moveId = randomUUID();
  let match: MoveMatch | null = null;
  const shortlisted = shortlistNodes(fields, nodes);
  const judged = await matchMove(deps.judge, { town: c.context.town, measure: c.context.measure }, fields, shortlisted);
  if (judged) {
    match = judged.match;
    await saveJudgment(db, {
      tenantId: c.tenantId,
      consultationId: c.consultationId,
      subjectKind: "move",
      subjectId: moveId,
      family: KERN_MATCH_FAMILY,
      provenance: judged.provenance,
      answers: judged.answers,
      decided: match,
    });
  }
  let r = route(match, c.params.matchThreshold);
  // The author rejected this node: the claim gets a proposal of its own, with the node as the comparison.
  if (opts.notNode && match?.node === opts.notNode && (r === "auto" || r === "unsicher" || r === "gegenteil")) r = "praezisierung";
  result.routes[r] = (result.routes[r] ?? 0) + 1;

  let newNode: string | null = null;
  await db.transaction(async (tx) => {
    let nodeId = match?.node ?? null;
    let state: "vorgelegt" | "verknuepft" = "vorgelegt";
    let sample = false;
    let decidedBy: string | null = null;
    let stance: 1 | -1 = 1;
    if (r === "auto") {
      const st = await tx.execute(sql`SELECT status FROM map_points WHERE id = ${nodeId}`);
      if ((st.rows[0] as Row | undefined)?.status === "released") {
        state = "verknuepft";
        decidedBy = "regel";
        sample = random() < c.params.sampleRate;
      }
    } else if (r === "gegenteil") {
      stance = -1;
    } else if (r === "praezisierung" || r === "neu") {
      nodeId = await createNode(tx, {
        tenantId: c.tenantId,
        consultationId: c.consultationId,
        rolle: "beitrag",
        createdBy: "ki",
        text: fields.aussage,
        label: fields.label,
        typ: fields.typ,
        schritt: fields.schritt,
        frage: fields.frage,
        richtung: fields.richtung,
        einwand: fields.einwand,
      });
      newNode = nodeId;
    }
    await tx.execute(sql`
      INSERT INTO moves (id, tenant_id, consultation_id, submission_id, ord, quote, span_start, span_end, kern, aussage, label,
                         typ, schritt, frage, richtung, einwand, beleg, flags, match, route, sample, state, map_point_id, stance,
                         decided_by, decided_at, decision)
      VALUES (${moveId}, ${c.tenantId}, ${c.consultationId}, ${sub.id}, ${ord}, ${sub.text.slice(span.start, span.end)},
              ${span.start}, ${span.end}, ${fields.kern}, ${fields.aussage}, ${fields.label}, ${fields.typ}, ${fields.schritt},
              ${fields.frage}, ${fields.richtung}, ${fields.einwand}, ${fields.beleg}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(flags)}::jsonb)),
              ${match ? JSON.stringify(match) : null}, ${r}, ${sample}, ${state}, ${nodeId}, ${stance},
              ${decidedBy}, ${decidedBy ? new Date().toISOString() : null}, ${decidedBy ? JSON.stringify({ action: "auto" }) : null})`);
  });
  result.moves++;
  if (newNode) {
    result.newNodes++;
    nodes.push({ id: newNode, text: fields.aussage, einwand: fields.einwand, schritt: fields.schritt });
    await saveReview(deps, c, newNode, fields.aussage, [sub.text.slice(span.start, span.end)]);
  }
}

export async function decomposeFile(deps: KernDeps, c: KernCampaign, fileId: string): Promise<DecomposeResult> {
  const { db } = deps;
  const sub = await submissionFor(deps, c, fileId);

  const chunks = chunkText(sub.text);
  const result: DecomposeResult = { windows: chunks.length, proposed: 0, moves: 0, quoteMissing: 0, routes: {}, newNodes: 0 };
  const nodes = await campaignNodes(db, c.consultationId);
  const done = new Set(
    ((await db.execute(sql`SELECT ord FROM moves WHERE submission_id = ${sub.id}`)).rows as Row[]).map((x) => Math.floor(Number(x.ord) / 1000)),
  );
  let cursor = 0;
  for (const [index, text] of chunks.entries()) {
    const start = Math.max(0, sub.text.indexOf(text, cursor));
    cursor = start + text.length;
    if (done.has(index)) continue; // resumed job: this window's moves are stored
    const zuege = await windowOutput(deps, c, sub, { text, index, count: chunks.length, start });
    result.proposed += zuege.length;
    deps.log(`window ${index + 1}/${chunks.length}: ${zuege.length} moves proposed`);
    for (const [i, z] of zuege.entries()) await processMove(deps, c, sub, z, index * 1000 + i, nodes, result);
  }
  await audit(db, {
    tenantId: c.tenantId,
    actor: "ki",
    action: "kern.decompose",
    subjectKind: "submission",
    subjectId: sub.id,
    payload: { file: fileId, ...result },
  });
  deps.log(`decomposed ${fileId}: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Door 2 after "Nein, das ist etwas anderes" (or nothing similar found): the
 * short statement through the same loop — one or two moves, a proposed node
 * for the editors. The node the author rejected is never its home.
 */
export async function decomposeShort(deps: KernDeps, c: KernCampaign, submissionId: string): Promise<DecomposeResult> {
  const { db } = deps;
  const r = await db.execute(sql`
    SELECT id, text, author_org, author_type, source_ref FROM submissions WHERE id = ${submissionId} AND consultation_id = ${c.consultationId}`);
  const s = r.rows[0] as Row | undefined;
  if (!s) throw new Error("Die Kurzaussage gibt es nicht mehr.");
  const sub: Submission = { id: s.id as string, text: s.text as string, sender: null, senderType: "privat" };
  const result: DecomposeResult = { windows: 1, proposed: 0, moves: 0, quoteMissing: 0, routes: {}, newNodes: 0 };
  const existing = await db.execute(sql`SELECT 1 FROM moves WHERE submission_id = ${sub.id} LIMIT 1`);
  if (existing.rows.length) return result; // resumed: already read
  const check = await db.execute(sql`
    SELECT decided FROM judgments WHERE subject_kind = 'submission' AND subject_id = ${sub.id} AND family = ${KERN_SHORT_FAMILY}`);
  const rejected = ((check.rows[0] as Row | undefined)?.decided as { node?: string | null; answer?: string } | undefined) ?? undefined;
  const notNode = rejected?.answer === "nein" ? (rejected.node ?? null) : null;

  const system = movesSystem(c.context);
  const prompt = shortPrompt(sub.text);
  const { output } = await deps.llm.generateStructured({ system, prompt, schema: shortMovesJsonSchema });
  const zuege = shortMovesOutput.parse(output).zuege;
  result.proposed = zuege.length;
  const nodes = await campaignNodes(db, c.consultationId);
  for (const [i, z] of zuege.entries()) {
    // A short text is quoted whole when the model's excerpt cannot be found in it.
    const zz = locateQuote(sub.text, z.zitat) ? z : { ...z, zitat: sub.text };
    await processMove(deps, c, sub, zz, i, nodes, result, { notNode });
  }
  await audit(db, { tenantId: c.tenantId, actor: "ki", action: "kern.decompose_short", subjectKind: "submission", subjectId: sub.id, payload: result });
  deps.log(`short statement ${sub.id}: ${JSON.stringify(result)}`);
  return result;
}

// ——— AI mode: the machine decides, people check samples ————————————————————————

/**
 * Mode "ki": the machine applies its own recommendations to contribution
 * nodes and uncertain assignments, named as the actor; a share (sampleRate)
 * of its decisions goes to the editors as spot checks. Personal data and
 * anything its review left unclear stay with a person; the start skeleton —
 * the town's own words — is always released by a person.
 */
export async function machineDecides(deps: KernDeps, c: KernCampaign): Promise<{ released: number; rejected: number; confirmed: number }> {
  if (c.params.editorialMode !== "ki") return { released: 0, rejected: 0, confirmed: 0 };
  const { db } = deps;
  const random = deps.random ?? Math.random;
  const actor = `ki:${process.env.TYPESAFE_DEFAULT_MODEL ?? "jev"}`;
  const out = { released: 0, rejected: 0, confirmed: 0 };

  const drafts = await db.execute(sql`
    SELECT id, review FROM map_points WHERE consultation_id = ${c.consultationId} AND rolle = 'beitrag' AND status = 'draft'`);
  for (const n of drafts.rows as Row[]) {
    const review = n.review as NodeReview | null;
    if (!review || review.flags.includes("personal_data")) continue;
    if (review.verdict === "release") {
      await releaseNode(db, { tenantId: c.tenantId, nodeId: n.id as string, actor });
      out.released++;
    } else if (review.verdict === "reject") {
      await rejectNode(db, { tenantId: c.tenantId, nodeId: n.id as string, actor, reason: "kein_argument" });
      out.rejected++;
    } else continue;
    if (random() < c.params.sampleRate) {
      await db.execute(sql`UPDATE moves SET sample = true WHERE id = (SELECT id FROM moves WHERE map_point_id = ${n.id as string} ORDER BY created_at LIMIT 1)`);
    }
  }
  const waiting = await db.execute(sql`
    SELECT m.id FROM moves m JOIN map_points p ON p.id = m.map_point_id
    WHERE m.consultation_id = ${c.consultationId} AND m.state = 'vorgelegt' AND p.status = 'released' AND p.rolle = 'beitrag'
      AND m.route IN ('unsicher', 'gegenteil')`);
  for (const m of waiting.rows as Row[]) {
    await confirmMove(db, { tenantId: c.tenantId, moveId: m.id as string, actor });
    out.confirmed++;
    if (random() < c.params.sampleRate) await db.execute(sql`UPDATE moves SET sample = true WHERE id = ${m.id as string}`);
  }
  deps.log(`machine decided: ${JSON.stringify(out)}`);
  return out;
}
