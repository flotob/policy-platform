/**
 * The evaluation of a campaign (Gesamtmodell W1–W9): the data from the
 * database, the rules from @policy/pipeline/kern (befund.ts). While the
 * participation runs, the result is computed live for the municipality's
 * preview; when it closes (B13) it is computed once more and stored,
 * unchangeable (W9) — the published page and the report read only that.
 */

import { sql } from "@policy/db";
import { evaluate, type BelegKey, type Ergebnis, type EvaluateInput, type MoveIn, type NodeIn, type SourceIn } from "@policy/pipeline/kern";

import type { CampNaming } from "./bericht";
import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { QUESTIONS, STEPS } from "./params";
import { paragraphAround } from "./redaktion";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

/**
 * Z10/B11: inputs in the order they came (door 2, door 3, the town's own
 * uploads) and whether each brought a point that was not there before (a
 * released node opened from one of its moves). Saturation = the latest run
 * of inputs without a new point, against the campaign's window.
 */
export async function saturation(c: Campaign) {
  const r = await rows(sql`
    SELECT s.id, s.created_at,
      EXISTS (SELECT 1 FROM moves m JOIN map_points p ON p.id = m.map_point_id
              WHERE m.submission_id = s.id AND m.route IN ('neu', 'praezisierung') AND p.status = 'released'
                AND p.proposal->>'text' = m.aussage) AS brought_new,
      EXISTS (SELECT 1 FROM moves m WHERE m.submission_id = s.id AND m.state = 'vorgelegt') AS open
    FROM submissions s WHERE s.consultation_id = ${c.consultationId} AND s.door IN ('statement', 'document')
    ORDER BY s.created_at`);
  const inputs = r.map((x) => ({ new: x.brought_new as boolean, open: x.open as boolean }));
  let streak = 0;
  for (let i = inputs.length - 1; i >= 0 && !inputs[i]!.new; i--) streak++;
  const lastN = inputs.slice(-Math.max(1, c.params.saturationWindow));
  return {
    inputs: inputs.length,
    newPoints: inputs.filter((x) => x.new).length,
    streak,
    window: c.params.saturationWindow,
    recentNew: lastN.filter((x) => x.new).length,
    open: inputs.filter((x) => x.open).length,
    series: inputs.map((x) => x.new),
    saturated: streak >= c.params.saturationWindow,
  };
}

const dateDe = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "");

async function loadInput(c: Campaign): Promise<EvaluateInput> {
  const [nodes, moves, votes, participants, sat, counts] = await Promise.all([
    rows(sql`
      SELECT id, ord, text, typ, rolle, schritt, frage, richtung, version FROM map_points
      WHERE consultation_id = ${c.consultationId} AND rolle IS NOT NULL AND status = 'released'`),
    rows(sql`
      SELECT m.id, m.map_point_id, m.stance, m.richtung, m.schritt, m.frage, m.beleg, m.aussage, m.quote, m.span_start, m.span_end, m.flags, m.decided_by,
             s.participant_id, s.door, s.author_org, s.author_type, s.text AS source_text, COALESCE(s.submitted_at, s.created_at) AS at, f.filename
      FROM moves m JOIN map_points p ON p.id = m.map_point_id AND p.status = 'released'
      JOIN submissions s ON s.id = m.submission_id LEFT JOIN campaign_files f ON f.submission_id = s.id
      WHERE m.consultation_id = ${c.consultationId} AND m.state = 'verknuepft' ORDER BY m.created_at`),
    rows(sql`
      SELECT v.participant_id, v.map_point_id, v.value FROM map_point_votes v
      JOIN map_points p ON p.id = v.map_point_id AND p.version = v.version
      WHERE p.consultation_id = ${c.consultationId} AND p.status = 'released' AND p.rolle IS NOT NULL`),
    rows(sql`SELECT id, via FROM participants WHERE consultation_id = ${c.consultationId}`),
    saturation(c),
    rows(sql`
      SELECT (SELECT count(*) FROM submissions WHERE consultation_id = ${c.consultationId} AND door = 'statement')::int AS short_points,
             (SELECT count(*) FROM campaign_files WHERE campaign_id = ${c.id} AND participant_id IS NOT NULL)::int AS uploads,
             (SELECT count(*) FROM campaign_files WHERE campaign_id = ${c.id} AND role = 'stellungnahme' AND participant_id IS NULL)::int AS files`),
  ]);

  const source = (m: Row): SourceIn => {
    if (m.door === "statement") return { kind: "kurzaussage", title: "Eigener Punkt aus der Beteiligung", date: dateDe(m.at), before: "", after: "" };
    // Private persons: only the quoted words, never the paragraph around them (it may name them or their neighbours).
    if (!m.author_org) return { kind: "privat", title: "Stellungnahme einer Privatperson", date: dateDe(m.at), before: "", after: "" };
    const ctx = paragraphAround((m.source_text as string | null) ?? "", Number(m.span_start), Number(m.span_end));
    return { kind: "organisation", title: `Stellungnahme: ${m.author_org as string}`, date: dateDe(m.at), before: ctx.before, after: ctx.after };
  };
  const sender = (m: Row) => (m.author_org ? (m.author_org as string) : m.door === "statement" ? "Eigener Punkt aus der Beteiligung" : "Privatperson");

  const x = counts[0]!;
  return {
    nodes: nodes.map(
      (n): NodeIn => ({
        id: n.id as string,
        ord: Number(n.ord),
        text: n.text as string,
        typ: n.typ as NodeIn["typ"],
        rolle: n.rolle as NodeIn["rolle"],
        schritt: (n.schritt as NodeIn["schritt"]) ?? null,
        frage: (n.frage as string | null) ?? null,
        richtung: (n.richtung as NodeIn["richtung"]) ?? null,
        version: Number(n.version),
      }),
    ),
    moves: moves.map(
      (m): MoveIn => ({
        id: m.id as string,
        node: m.map_point_id as string,
        stance: Number(m.stance) === -1 ? -1 : 1,
        richtung: (m.richtung as MoveIn["richtung"]) ?? null,
        schritt: (m.schritt as MoveIn["schritt"]) ?? null,
        frage: (m.frage as string | null) ?? null,
        beleg: (m.beleg as BelegKey | null) ?? null,
        aussage: (m.aussage as string | null) ?? "",
        quote: (m.quote as string | null) ?? "",
        participant: (m.participant_id as string | null) ?? null,
        sender: sender(m),
        source: source(m),
        personal: ((m.flags as string[] | null) ?? []).includes("personal_data"),
        decidedBy: (m.decided_by as string | null) ?? null,
      }),
    ),
    votes: votes.map((v) => ({ participant: v.participant_id as string, node: v.map_point_id as string, value: Number(v.value) as -1 | 0 | 1 })),
    participants: participants.map((p) => ({ id: p.id as string, via: (p.via as string | null) ?? null })),
    context: {
      steps: STEPS.map((s) => ({ key: s.key, label: s.label, these: c.steps[s.key] ?? "" })),
      questions: QUESTIONS.map((q) => ({ key: q.key, label: q.label, steps: q.steps })),
    },
    params: { bridgeThreshold: c.params.bridgeThreshold, minParticipants: c.params.minParticipants },
    saturation: { inputs: sat.inputs, newPoints: sat.newPoints, streak: sat.streak, window: sat.window, saturated: sat.saturated, series: sat.series },
    inputs: { shortPoints: Number(x.short_points), uploads: Number(x.uploads), files: Number(x.files) },
  };
}

const live = new Map<string, { key: string; value: Ergebnis }>();

/** The result as it stands now — the municipality's preview while citizens take part. */
export async function liveResult(c: Campaign): Promise<Ergebnis> {
  const input = await loadInput(c);
  const key = `${input.votes.length}:${input.votes.reduce((s, v) => s + v.value + 2, 0)}:${input.nodes.map((n) => `${n.id}${n.version}`).join()}:${input.moves.length}`;
  const hit = live.get(c.id);
  if (hit && hit.key === key) return hit.value;
  const value = evaluate(input);
  live.set(c.id, { key, value });
  return value;
}

export interface SavedResult {
  id: string;
  version: number;
  result: Ergebnis;
  /** The stored camp naming (see bericht.ts, namingOf). */
  campNames: unknown;
  createdAt: string;
}

const toSaved = (r: Row): SavedResult => ({
  id: r.id as string,
  version: Number(r.version),
  result: r.result as Ergebnis,
  campNames: r.camp_names ?? null,
  createdAt: String(r.created_at),
});

/** W9: compute once more on the frozen matrix and store it. Returns the new version. */
export async function saveResult(c: Campaign, actor: string): Promise<SavedResult> {
  const result = evaluate(await loadInput(c));
  const r = await rows(sql`
    INSERT INTO campaign_results (tenant_id, campaign_id, version, matrix_hash, graph_hash, result, created_by)
    SELECT ${c.tenantId}, ${c.id}, COALESCE(max(version), 0) + 1, ${result.matrixHash}, ${result.graphHash}, ${JSON.stringify(result)}, ${actor}
    FROM campaign_results WHERE campaign_id = ${c.id}
    RETURNING *`);
  return toSaved(r[0]!);
}

export async function latestResult(campaignId: string): Promise<SavedResult | null> {
  const r = await rows(sql`SELECT * FROM campaign_results WHERE campaign_id = ${campaignId} ORDER BY version DESC LIMIT 1`);
  return r[0] ? toSaved(r[0]) : null;
}

export async function getResult(campaignId: string, id: string): Promise<SavedResult | null> {
  const r = await rows(sql`SELECT * FROM campaign_results WHERE campaign_id = ${campaignId} AND id = ${id}`);
  return r[0] ? toSaved(r[0]) : null;
}

/** Camp names stay editable until a report on this result is released. */
export async function namesLocked(resultId: string): Promise<boolean> {
  const r = await rows(sql`SELECT 1 FROM campaign_reports WHERE result_id = ${resultId} AND state IN ('freigegeben', 'veroeffentlicht') LIMIT 1`);
  return r.length > 0;
}

export async function setCampNames(resultId: string, naming: CampNaming): Promise<void> {
  await getDb().execute(sql`UPDATE campaign_results SET camp_names = ${JSON.stringify(naming)} WHERE id = ${resultId}`);
}
