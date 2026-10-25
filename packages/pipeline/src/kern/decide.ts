/**
 * Z6/Z7/A2 — the editorial decisions, one function each. The editors' screens
 * and the machine in AI mode call the same functions; only the actor differs
 * ("user:<id>" or "ki:<model>"), and every call leaves an audit entry with
 * what the machine had proposed (I11, Q1). Nothing here merges on its own:
 * a merge is always somebody's explicit decision (I3).
 */

import { sql, type Db } from "@policy/db";

import type { QuestionKey, Richtung, StepKey, Typ } from "./prompts.ts";

type Exec = Pick<Db, "execute">;
type Row = Record<string, unknown>;

/** The editable fields of a node — what the editors may change before releasing. */
export interface NodeFields {
  text: string;
  label: string;
  typ: Typ;
  schritt: StepKey | null;
  frage: QuestionKey | null;
  richtung: Richtung | null;
  einwand: string | null;
}

export type RejectReason = "kein_argument" | "ausserhalb" | "persoenlich" | "doppelt" | "leer" | "ersetzt";

export class DecisionError extends Error {}

export async function audit(
  tx: Exec,
  e: { tenantId: string; actor: string; action: string; subjectKind: string; subjectId: string; reason?: string; payload?: unknown },
) {
  await tx.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, reason, payload)
    VALUES (${e.tenantId}, ${e.actor}, ${e.action}, ${e.subjectKind}, ${e.subjectId}, ${e.reason ?? null}, ${JSON.stringify(e.payload ?? null)})`);
}

/** The next display number of the campaign's map; serialised so the worker and editors never collide. */
async function nextOrd(tx: Exec, consultationId: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`map_points:${consultationId}`}))`);
  const r = await tx.execute(sql`SELECT COALESCE(max(ord), 0) + 1 AS ord FROM map_points WHERE consultation_id = ${consultationId} AND scope = 'verfahren'`);
  return Number((r.rows[0] as Row).ord);
}

/** A proposed node (status draft): only a release makes it part of the map (I1). */
export async function createNode(
  tx: Exec,
  n: NodeFields & { tenantId: string; consultationId: string; rolle: "schluss" | "praemisse" | "beitrag"; createdBy: string },
): Promise<string> {
  const ord = await nextOrd(tx, n.consultationId);
  const proposal = { text: n.text, label: n.label, typ: n.typ, schritt: n.schritt, frage: n.frage, richtung: n.richtung, einwand: n.einwand };
  const r = await tx.execute(sql`
    INSERT INTO map_points (tenant_id, consultation_id, scope, ord, typ, text, label, rolle, schritt, frage, richtung, einwand,
                            proposal, status, created_by)
    VALUES (${n.tenantId}, ${n.consultationId}, 'verfahren', ${ord}, ${n.typ}, ${n.text}, ${n.label.slice(0, 60)}, ${n.rolle},
            ${n.schritt}, ${n.frage}, ${n.richtung}, ${n.einwand}, ${JSON.stringify(proposal)}, 'draft', ${n.createdBy})
    RETURNING id`);
  return (r.rows[0] as Row).id as string;
}

async function lockNode(tx: Exec, tenantId: string, nodeId: string): Promise<Row> {
  const r = await tx.execute(sql`SELECT * FROM map_points WHERE id = ${nodeId} AND tenant_id = ${tenantId} FOR UPDATE`);
  const node = r.rows[0] as Row | undefined;
  if (!node) throw new DecisionError("Diesen Punkt gibt es nicht.");
  return node;
}

async function lockMove(tx: Exec, tenantId: string, moveId: string): Promise<Row> {
  const r = await tx.execute(sql`SELECT * FROM moves WHERE id = ${moveId} AND tenant_id = ${tenantId} FOR UPDATE`);
  const move = r.rows[0] as Row | undefined;
  if (!move) throw new DecisionError("Diesen Beitrag gibt es nicht.");
  return move;
}

const fieldsOf = (r: Row): NodeFields => ({
  text: r.text as string,
  label: r.label as string,
  typ: r.typ as Typ,
  schritt: (r.schritt as StepKey | null) ?? null,
  frage: (r.frage as QuestionKey | null) ?? null,
  richtung: (r.richtung as Richtung | null) ?? null,
  einwand: (r.einwand as string | null) ?? null,
});

/** A proposed contribution node left without moves is withdrawn — nobody argued it any more. */
async function dropIfEmpty(tx: Exec, tenantId: string, nodeId: string | null, actor: string) {
  if (!nodeId) return;
  const r = await tx.execute(sql`
    UPDATE map_points SET status = 'rejected'
    WHERE id = ${nodeId} AND status = 'draft' AND rolle = 'beitrag'
      AND NOT EXISTS (SELECT 1 FROM moves WHERE map_point_id = ${nodeId} AND state <> 'verworfen')
    RETURNING id`);
  if (r.rows.length) await audit(tx, { tenantId, actor, action: "kern.node.reject", subjectKind: "map_point", subjectId: nodeId, reason: "leer" });
}

/** Z7/A2: release a node (with the editors' wording); its waiting moves now belong to it. */
export async function releaseNode(db: Db, a: { tenantId: string; nodeId: string; actor: string; edits?: Partial<NodeFields> }) {
  await db.transaction(async (tx) => {
    const node = await lockNode(tx, a.tenantId, a.nodeId);
    if (node.status !== "draft") throw new DecisionError("Über diesen Punkt ist schon entschieden.");
    const f = { ...fieldsOf(node), ...(a.edits ?? {}) };
    if (f.text.trim().length < 8) throw new DecisionError("Die Aussage ist zu kurz.");
    await tx.execute(sql`
      UPDATE map_points SET text = ${f.text.trim()}, label = ${f.label.trim().slice(0, 60)}, typ = ${f.typ}, schritt = ${f.schritt},
        frage = ${f.frage}, richtung = ${f.richtung}, einwand = ${f.einwand},
        status = 'released', released_by = ${a.actor}, released_at = now()
      WHERE id = ${a.nodeId}`);
    await tx.execute(sql`
      UPDATE moves SET state = 'verknuepft', decided_by = ${a.actor}, decided_at = now(),
        decision = ${JSON.stringify({ action: "freigegeben" })}
      WHERE map_point_id = ${a.nodeId} AND state = 'vorgelegt'`);
    await audit(tx, {
      tenantId: a.tenantId,
      actor: a.actor,
      action: "kern.node.release",
      subjectKind: "map_point",
      subjectId: a.nodeId,
      payload: { proposal: node.proposal, released: f },
    });
  });
}

/** Change a released node's wording or fields while the procedure is in preparation (no votes yet). */
export async function editNode(db: Db, a: { tenantId: string; nodeId: string; actor: string; edits: Partial<NodeFields> }) {
  await db.transaction(async (tx) => {
    const node = await lockNode(tx, a.tenantId, a.nodeId);
    if (node.status !== "released") throw new DecisionError("Nur freigegebene Punkte lassen sich hier ändern.");
    const before = fieldsOf(node);
    const f = { ...before, ...a.edits };
    if (f.text.trim().length < 8) throw new DecisionError("Die Aussage ist zu kurz.");
    await tx.execute(sql`
      UPDATE map_points SET text = ${f.text.trim()}, label = ${f.label.trim().slice(0, 60)}, typ = ${f.typ}, schritt = ${f.schritt},
        frage = ${f.frage}, richtung = ${f.richtung}, einwand = ${f.einwand}
      WHERE id = ${a.nodeId}`);
    await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.node.edit", subjectKind: "map_point", subjectId: a.nodeId, payload: { before, after: f } });
  });
}

/** Reject a proposed node; its moves are no argument for the map. */
export async function rejectNode(db: Db, a: { tenantId: string; nodeId: string; actor: string; reason: RejectReason }) {
  await db.transaction(async (tx) => {
    const node = await lockNode(tx, a.tenantId, a.nodeId);
    if (node.status !== "draft") throw new DecisionError("Über diesen Punkt ist schon entschieden.");
    await tx.execute(sql`UPDATE map_points SET status = 'rejected' WHERE id = ${a.nodeId}`);
    await tx.execute(sql`
      UPDATE moves SET state = 'verworfen', decided_by = ${a.actor}, decided_at = now(),
        decision = ${JSON.stringify({ action: "verworfen", reason: a.reason })}
      WHERE map_point_id = ${a.nodeId} AND state = 'vorgelegt'`);
    await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.node.reject", subjectKind: "map_point", subjectId: a.nodeId, reason: a.reason });
  });
}

/**
 * A deliberate merge (Z6 "bewusst zusammenführen"): the proposed node folds
 * into another; stance -1 when it said the opposite ("Die Netze reichen
 * nicht" into "Die Netze reichen"), so its moves count as disagreement.
 */
export async function mergeNode(db: Db, a: { tenantId: string; nodeId: string; intoId: string; actor: string; stance: 1 | -1 }) {
  if (a.nodeId === a.intoId) throw new DecisionError("Ein Punkt lässt sich nicht mit sich selbst zusammenführen.");
  await db.transaction(async (tx) => {
    const node = await lockNode(tx, a.tenantId, a.nodeId);
    const into = await lockNode(tx, a.tenantId, a.intoId);
    if (node.status !== "draft") throw new DecisionError("Über diesen Punkt ist schon entschieden.");
    if (into.consultation_id !== node.consultation_id || !["draft", "released"].includes(into.status as string)) {
      throw new DecisionError("Mit diesem Punkt lässt sich nicht zusammenführen.");
    }
    if (node.rolle !== "beitrag") throw new DecisionError("Punkte des Startgerüsts werden freigegeben oder verworfen, nicht zusammengeführt.");
    await tx.execute(sql`UPDATE map_points SET status = 'merged', merged_into = ${a.intoId} WHERE id = ${a.nodeId}`);
    const linked = into.status === "released";
    await tx.execute(sql`
      UPDATE moves SET map_point_id = ${a.intoId}, stance = stance * ${a.stance},
        state = ${linked ? "verknuepft" : "vorgelegt"},
        decided_by = ${linked ? a.actor : null}, decided_at = ${linked ? new Date().toISOString() : null},
        decision = ${JSON.stringify({ action: "zusammengefuehrt", from: a.nodeId, stance: a.stance })}
      WHERE map_point_id = ${a.nodeId} AND state = 'vorgelegt'`);
    await audit(tx, {
      tenantId: a.tenantId,
      actor: a.actor,
      action: "kern.node.merge",
      subjectKind: "map_point",
      subjectId: a.nodeId,
      payload: { into: a.intoId, stance: a.stance },
    });
  });
}

/** Confirm the machine's assignment of a move (uncertain match, opposite, or a spot check). */
export async function confirmMove(db: Db, a: { tenantId: string; moveId: string; actor: string }) {
  await db.transaction(async (tx) => {
    const move = await lockMove(tx, a.tenantId, a.moveId);
    const decision = move.decision as Row | null;
    if (move.sample && move.state !== "vorgelegt") {
      // Z9: the spot check passed.
      await tx.execute(sql`
        UPDATE moves SET decision = ${JSON.stringify({ ...(decision ?? {}), geprueft: a.actor, geprueftAt: new Date().toISOString() })}
        WHERE id = ${a.moveId}`);
      await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.move.sample_ok", subjectKind: "move", subjectId: a.moveId });
      return;
    }
    if (move.state !== "vorgelegt" || !move.map_point_id) throw new DecisionError("Über diesen Beitrag ist schon entschieden.");
    const node = await lockNode(tx, a.tenantId, move.map_point_id as string);
    if (node.status !== "released") throw new DecisionError("Der Punkt ist noch nicht freigegeben; der Beitrag wird mit ihm entschieden.");
    await tx.execute(sql`
      UPDATE moves SET state = 'verknuepft', decided_by = ${a.actor}, decided_at = now(),
        decision = ${JSON.stringify({ action: "bestaetigt", route: move.route })}
      WHERE id = ${a.moveId}`);
    await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.move.confirm", subjectKind: "move", subjectId: a.moveId, payload: { node: move.map_point_id, stance: move.stance } });
  });
}

/** Z6 "umhängen" / "als neuen Knoten anlegen": move a move to another node, or open a new proposed node from it. */
export async function reassignMove(
  db: Db,
  a: { tenantId: string; moveId: string; actor: string; to: { node: string; stance: 1 | -1 } | "neu" },
): Promise<string> {
  return db.transaction(async (tx) => {
    const move = await lockMove(tx, a.tenantId, a.moveId);
    // A discarded move comes back only as the correction of a spot check (Z9).
    if (move.state === "verworfen" && !move.sample) throw new DecisionError("Dieser Beitrag ist verworfen.");
    const from = (move.map_point_id as string | null) ?? null;
    let target: string;
    let linked: boolean;
    if (a.to === "neu") {
      target = await createNode(tx, {
        tenantId: a.tenantId,
        consultationId: move.consultation_id as string,
        rolle: "beitrag",
        createdBy: a.actor,
        text: move.aussage as string,
        label: move.label as string,
        typ: move.typ as Typ,
        schritt: move.schritt as StepKey,
        frage: move.frage as QuestionKey,
        richtung: move.richtung as Richtung,
        einwand: (move.einwand as string | null) ?? null,
      });
      linked = false;
    } else {
      const node = await lockNode(tx, a.tenantId, a.to.node);
      if (node.consultation_id !== move.consultation_id || !["draft", "released"].includes(node.status as string)) {
        throw new DecisionError("Diesem Punkt lässt sich der Beitrag nicht zuordnen.");
      }
      target = a.to.node;
      linked = node.status === "released";
    }
    const stance = a.to === "neu" ? 1 : a.to.stance;
    await tx.execute(sql`
      UPDATE moves SET map_point_id = ${target}, stance = ${stance}, state = ${linked ? "verknuepft" : "vorgelegt"},
        decided_by = ${linked ? a.actor : null}, decided_at = ${linked ? new Date().toISOString() : null},
        decision = ${JSON.stringify({ action: a.to === "neu" ? "neuer_punkt" : "umgehaengt", from, stance, geprueft: move.sample ? a.actor : undefined })}
      WHERE id = ${a.moveId}`);
    await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.move.reassign", subjectKind: "move", subjectId: a.moveId, payload: { from, to: target, stance } });
    if (from && from !== target) await dropIfEmpty(tx, a.tenantId, from, a.actor);
    return target;
  });
}

/** Z6 "verwerfen": the move is no argument (greeting, insult without a claim, off the measure). */
export async function discardMove(db: Db, a: { tenantId: string; moveId: string; actor: string; reason: RejectReason }) {
  await db.transaction(async (tx) => {
    const move = await lockMove(tx, a.tenantId, a.moveId);
    if (move.state === "verworfen") return;
    await tx.execute(sql`
      UPDATE moves SET state = 'verworfen', decided_by = ${a.actor}, decided_at = now(),
        decision = ${JSON.stringify({ action: "verworfen", reason: a.reason, from: move.map_point_id })}
      WHERE id = ${a.moveId}`);
    await audit(tx, { tenantId: a.tenantId, actor: a.actor, action: "kern.move.discard", subjectKind: "move", subjectId: a.moveId, reason: a.reason });
    await dropIfEmpty(tx, a.tenantId, (move.map_point_id as string | null) ?? null, a.actor);
  });
}
