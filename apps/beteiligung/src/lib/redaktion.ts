/**
 * What the editors and the workspace read about the machine's work: the
 * nodes (Punkte), the moves (Beiträge) behind them, the editorial queue and
 * the background jobs. Read-only; every write goes through
 * @policy/pipeline/kern's decision functions.
 */

import { sql } from "@policy/db";
import type { NodeReview, QuestionKey, Richtung, StepKey } from "@policy/pipeline/kern";

import { getDb } from "./db";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

export type Typ = "T" | "W" | "verfahren";
export type NodeStatus = "draft" | "released" | "rejected" | "merged";
export type Rolle = "schluss" | "praemisse" | "beitrag";

export interface Node {
  id: string;
  ord: number;
  rolle: Rolle;
  status: NodeStatus;
  typ: Typ;
  text: string;
  label: string;
  schritt: StepKey | null;
  frage: QuestionKey | null;
  richtung: Richtung | null;
  einwand: string | null;
  review: NodeReview | null;
  releasedBy: string | null;
  createdAt: string;
  /** Moves that belong to the node (linked or waiting with it), by stance. */
  agree: number;
  disagree: number;
  /** Distinct senders behind the node. */
  senders: string[];
}

export interface Move {
  id: string;
  nodeId: string | null;
  state: "vorgelegt" | "verknuepft" | "verworfen";
  route: "auto" | "unsicher" | "gegenteil" | "praezisierung" | "neu" | null;
  stance: 1 | -1;
  sample: boolean;
  quote: string;
  /** The paragraph around the quote, for "im Zusammenhang lesen" (the quote is `hit`). */
  context: { before: string; hit: string; after: string };
  kern: string;
  typ: Typ;
  schritt: StepKey;
  frage: QuestionKey;
  richtung: Richtung;
  beleg: string;
  flags: string[];
  sender: string;
  senderType: string | null;
  filename: string | null;
  match: {
    outcome: string;
    node: string | null;
    pSame: number;
    pOpposite: number;
    pRelated: number;
    candidates?: { node: string; pSame: number; pOpposite: number; pRelated: number }[];
  } | null;
  decidedBy: string | null;
  decision: Record<string, unknown> | null;
}

function toNode(r: Row): Node {
  return {
    id: r.id as string,
    ord: Number(r.ord),
    rolle: r.rolle as Rolle,
    status: r.status as NodeStatus,
    typ: r.typ as Typ,
    text: r.text as string,
    label: r.label as string,
    schritt: (r.schritt as StepKey | null) ?? null,
    frage: (r.frage as QuestionKey | null) ?? null,
    richtung: (r.richtung as Richtung | null) ?? null,
    einwand: (r.einwand as string | null) ?? null,
    review: (r.review as NodeReview | null) ?? null,
    releasedBy: (r.released_by as string | null) ?? null,
    createdAt: String(r.created_at),
    agree: Number(r.agree ?? 0),
    disagree: Number(r.disagree ?? 0),
    senders: (r.senders as string[] | null) ?? [],
  };
}

const NODE_SELECT = sql`
  SELECT p.*,
    (SELECT count(*) FROM moves m WHERE m.map_point_id = p.id AND m.state <> 'verworfen' AND m.stance = 1)::int AS agree,
    (SELECT count(*) FROM moves m WHERE m.map_point_id = p.id AND m.state <> 'verworfen' AND m.stance = -1)::int AS disagree,
    (SELECT array_agg(DISTINCT CASE WHEN s.author_org IS NOT NULL THEN s.author_org WHEN s.door = 'statement' THEN 'Eigener Punkt aus der Beteiligung' WHEN s.author_type = 'privat' THEN 'Privatperson' ELSE 'Ohne Absender' END) FROM moves m JOIN submissions s ON s.id = m.submission_id
      WHERE m.map_point_id = p.id AND m.state <> 'verworfen') AS senders
  FROM map_points p`;

/** All live nodes of a campaign (proposed and released), in map order. */
export async function listNodes(consultationId: string): Promise<Node[]> {
  const r = await rows(sql`${NODE_SELECT}
    WHERE p.consultation_id = ${consultationId} AND p.rolle IS NOT NULL AND p.status IN ('draft', 'released')
    ORDER BY CASE p.rolle WHEN 'schluss' THEN 0 WHEN 'praemisse' THEN 1 ELSE 2 END, p.ord`);
  return r.map(toNode);
}

export async function getNode(consultationId: string, id: string): Promise<Node | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await rows(sql`${NODE_SELECT} WHERE p.consultation_id = ${consultationId} AND p.id = ${id}`);
  return r[0] ? toNode(r[0]) : null;
}

const MOVE_SELECT = sql`
  SELECT m.*, CASE WHEN s.author_org IS NOT NULL THEN s.author_org WHEN s.door = 'statement' THEN 'Eigener Punkt aus der Beteiligung' WHEN s.author_type = 'privat' THEN 'Privatperson' ELSE 'Ohne Absender' END AS sender_name, s.author_type, s.text AS source_text, f.filename
  FROM moves m JOIN submissions s ON s.id = m.submission_id
  LEFT JOIN campaign_files f ON f.submission_id = s.id`;

/** The paragraph(s) holding a quote, at most ~600 characters on each side. */
export function paragraphAround(text: string, start: number, end: number): Move["context"] {
  const MAX = 600;
  let from = text.lastIndexOf("\n\n", start);
  from = from < 0 ? 0 : from + 2;
  let to = text.indexOf("\n\n", end);
  if (to < 0) to = text.length;
  from = Math.max(from, start - MAX);
  to = Math.min(to, end + MAX);
  const clip = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (from > 0 && text[from - 1] !== "\n" ? "… " : "") + clip(text.slice(from, start)),
    hit: clip(text.slice(start, end)),
    after: clip(text.slice(end, to)) + (to < text.length && text[to] !== "\n" ? " …" : ""),
  };
}

function toMove(r: Row): Move {
  const text = (r.source_text as string | null) ?? "";
  const start = Number(r.span_start);
  const end = Number(r.span_end);
  return {
    id: r.id as string,
    nodeId: (r.map_point_id as string | null) ?? null,
    state: r.state as Move["state"],
    route: (r.route as Move["route"]) ?? null,
    stance: Number(r.stance) === -1 ? -1 : 1,
    sample: r.sample as boolean,
    quote: r.quote as string,
    context: paragraphAround(text, start, end),
    kern: r.kern as string,
    typ: r.typ as Typ,
    schritt: r.schritt as StepKey,
    frage: r.frage as QuestionKey,
    richtung: r.richtung as Richtung,
    beleg: r.beleg as string,
    flags: (r.flags as string[] | null) ?? [],
    sender: r.sender_name as string,
    senderType: (r.author_type as string | null) ?? null,
    filename: (r.filename as string | null) ?? null,
    match: (r.match as Move["match"]) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decision: (r.decision as Record<string, unknown> | null) ?? null,
  };
}

export async function movesOfNode(nodeId: string): Promise<Move[]> {
  const r = await rows(sql`${MOVE_SELECT} WHERE m.map_point_id = ${nodeId} AND m.state <> 'verworfen' ORDER BY m.stance DESC, m.created_at`);
  return r.map(toMove);
}

export async function getMove(consultationId: string, id: string): Promise<Move | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await rows(sql`${MOVE_SELECT} WHERE m.consultation_id = ${consultationId} AND m.id = ${id}`);
  return r[0] ? toMove(r[0]) : null;
}

/**
 * The editorial queue (Z6/Z7, Z9), oldest first within each kind:
 *  - proposed nodes (the start skeleton first, then contributions);
 *  - moves the machine attached to a released point but was not sure about;
 *  - spot checks on what the rule or the machine decided alone.
 */
export interface Queue {
  skeleton: Node[];
  proposals: Node[];
  uncertain: Move[];
  samples: Move[];
}

export async function loadQueue(consultationId: string): Promise<Queue> {
  const nodes = await rows(sql`${NODE_SELECT}
    WHERE p.consultation_id = ${consultationId} AND p.rolle IS NOT NULL AND p.status = 'draft'
    ORDER BY CASE p.rolle WHEN 'schluss' THEN 0 WHEN 'praemisse' THEN 1 ELSE 2 END, p.created_at, p.ord`);
  const all = nodes.map(toNode);
  const uncertain = await rows(sql`${MOVE_SELECT} JOIN map_points p ON p.id = m.map_point_id
    WHERE m.consultation_id = ${consultationId} AND m.state = 'vorgelegt' AND p.status = 'released' ORDER BY m.created_at`);
  const samples = await rows(sql`${MOVE_SELECT}
    WHERE m.consultation_id = ${consultationId} AND m.sample AND m.state <> 'vorgelegt' AND (m.decision->>'geprueft') IS NULL
    ORDER BY m.decided_at`);
  return {
    skeleton: all.filter((n) => n.rolle !== "beitrag"),
    proposals: all.filter((n) => n.rolle === "beitrag"),
    uncertain: uncertain.map(toMove),
    samples: samples.map(toMove),
  };
}

export const queueSize = (q: Queue) => q.skeleton.length + q.proposals.length + q.uncertain.length + q.samples.length;

export async function countQueue(consultationId: string): Promise<number> {
  const r = await rows(sql`
    SELECT
      (SELECT count(*) FROM map_points WHERE consultation_id = ${consultationId} AND rolle IS NOT NULL AND status = 'draft')
    + (SELECT count(*) FROM moves m JOIN map_points p ON p.id = m.map_point_id
        WHERE m.consultation_id = ${consultationId} AND m.state = 'vorgelegt' AND p.status = 'released')
    + (SELECT count(*) FROM moves WHERE consultation_id = ${consultationId} AND sample AND state <> 'vorgelegt' AND (decision->>'geprueft') IS NULL)
    AS n`);
  return Number(r[0]!.n);
}

// ——— The machine's background work ————————————————————————————————————————

export interface Job {
  id: string;
  kind: "skelett" | "zerlegen" | "kurzaussage" | "lagernamen" | "bericht";
  state: "wartet" | "laeuft" | "fertig" | "fehler";
  filename: string | null;
  sender: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
}

export async function listJobs(campaignId: string): Promise<Job[]> {
  const r = await rows(sql`
    SELECT j.*, f.filename, f.sender FROM campaign_jobs j LEFT JOIN campaign_files f ON f.id = j.file_id
    WHERE j.campaign_id = ${campaignId} ORDER BY j.created_at, j.kind <> 'skelett'`);
  return r.map((x) => ({
    id: x.id as string,
    kind: x.kind as Job["kind"],
    state: x.state as Job["state"],
    filename: (x.filename as string | null) ?? null,
    sender: (x.sender as string | null) ?? null,
    error: (x.error as string | null) ?? null,
    result: (x.result as Record<string, unknown> | null) ?? null,
    createdAt: String(x.created_at),
    finishedAt: x.finished_at ? String(x.finished_at) : null,
  }));
}

/** Readiness to open the participation (E6): the skeleton is decided and every step has a released claim. */
export async function openingCheck(consultationId: string) {
  const r = await rows(sql`
    SELECT rolle, schritt, status, count(*)::int AS n FROM map_points
    WHERE consultation_id = ${consultationId} AND rolle IS NOT NULL GROUP BY 1, 2, 3`);
  const count = (f: (x: Row) => boolean) => r.filter(f).reduce((s, x) => s + Number(x.n), 0);
  const skeletonOpen = count((x) => x.rolle !== "beitrag" && x.status === "draft");
  const skeletonReleased = count((x) => x.rolle === "praemisse" && x.status === "released");
  const rootReleased = count((x) => x.rolle === "schluss" && x.status === "released") > 0;
  const stepsCovered = (["lage", "wirkung", "weg", "eingriff"] as const).filter((s) =>
    r.some((x) => x.schritt === s && x.status === "released" && x.rolle === "praemisse"),
  ).length;
  const released = count((x) => x.status === "released");
  const waiting = count((x) => x.rolle === "beitrag" && x.status === "draft");
  const hasSkeleton = count((x) => x.rolle === "schluss" && (x.status === "draft" || x.status === "released")) > 0;
  return { hasSkeleton, skeletonOpen, skeletonReleased, rootReleased, stepsCovered, released, waiting };
}

/** Start-skeleton claims still open that the machine recommends releasing and that carry no personal data. */
export async function skeletonRecommended(consultationId: string): Promise<string[]> {
  const x = await rows(sql`
    SELECT id FROM map_points
    WHERE consultation_id = ${consultationId} AND rolle IN ('schluss', 'praemisse') AND status = 'draft'
      AND review->>'verdict' = 'release' AND NOT COALESCE(review->'flags', '[]'::jsonb) ? 'personal_data'
    ORDER BY CASE rolle WHEN 'schluss' THEN 0 ELSE 1 END, ord`);
  return x.map((n) => n.id as string);
}
