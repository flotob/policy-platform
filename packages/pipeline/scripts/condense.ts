/**
 * Condensation into Landkarten-Punkte (exp/jev) — replaces condense-map.ts
 * in the Jev chain.
 *
 * Per measure (all measures in parallel):
 *  1. PROPOSE (LLM): canonical map points — text, label, typ, district —
 *     without member lists (index lists were the fragile part).
 *  2. ASSIGN (Jev): every extraction point → one map point or "none"
 *     (one calibrated choice per point, answers keyed by name).
 *  3. TOP-UP (LLM, once): when more than 15 % of the points fit no map
 *     point, the LLM proposes additional map points for exactly those, and
 *     Jev assigns them again.
 * Map points nobody was assigned to are removed; districts are derived in
 * code from typ and the members' critical questions (deriveBezirk); order
 * follows district, then size.
 *
 * Idempotent: a measure that already has map points is only re-assigned
 * for points without one. Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/condense.ts --consultation <ref>
 *     [--scope <measure>] [--concurrency 4]
 */

import { createDb, sql, type Db } from "@policy/db";
import { AgentSdkProvider, JevJudge } from "@policy/llm";

import { deriveBezirk } from "../src/jev-grammar.ts";
import { MAP_ASSIGN_FAMILY, mapAssignQuestion } from "../src/jev-map.ts";
import { resolveConsultation, saveJudgment } from "../src/jev-stage.ts";
import { runPool } from "../src/pool.ts";
import { CONDENSE_PROPOSE_SYSTEM, condensePrompt, condenseTopUpPrompt } from "../src/prompts.ts";
import { condenseProposeJsonSchema, condenseProposeOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Above this share of uncovered points, the LLM gets one top-up round. */
const TOP_UP_ABOVE = 0.15;
const BEZIRK_ORDER = ["wirkung", "machbarkeit", "kosten", "alternativen", "wert", "ausgestaltung"];

interface Pt {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  cq: string | null;
  map_point_id: string | null;
}
interface Mp {
  id: string;
  label: string;
  text: string;
  typ: "T" | "W" | "verfahren";
  bezirk: string;
}

async function assign(
  db: Db,
  judge: JevJudge,
  cons: { id: string; tenantId: string },
  scope: string,
  pts: Pt[],
  mps: Mp[],
): Promise<Pt[]> {
  const options: Record<string, { label: string; text: string }> = {};
  mps.forEach((m, i) => (options[`k${i + 1}`] = { label: m.label, text: m.text }));
  const uncovered: Pt[] = [];
  const res = await runPool(
    pts,
    async (p) => {
      const { answers, provenance } = await judge.judge(
        { measure: scope, point: { label: p.label, summary: p.summary }, map_points: options },
        mapAssignQuestion(mps),
      );
      const a = answers.map_point as { choice: string; confidence: number };
      const mp = a.choice === "none" ? null : mps[Number(a.choice.slice(1)) - 1]!;
      // Assignment and its judgment commit together — a half-written result
      // would look done on resume.
      await db.transaction(async (tx) => {
        if (mp) await tx.execute(sql`UPDATE points SET map_point_id = ${mp.id} WHERE id = ${p.id}`);
        await saveJudgment(tx as unknown as Db, {
          tenantId: cons.tenantId,
          consultationId: cons.id,
          subjectKind: "point",
          subjectId: p.id,
          family: MAP_ASSIGN_FAMILY,
          provenance,
          answers,
          decided: { mapPoint: mp?.id ?? null, confidence: a.confidence },
        });
      });
      if (!mp) uncovered.push(p);
    },
    8,
    { label: (p) => `${scope}: assignment of "${p.label}"` },
  );
  // A failed judgment is neither assigned nor "none": the scope is incomplete
  // (its points stay unassigned and are picked up by the next run).
  if (res.failed > 0) throw new Error(`${scope}: ${res.failed} assignments failed — rerun to finish`);
  return uncovered;
}

async function insertMapPoints(
  db: Db,
  cons: { id: string; tenantId: string },
  scope: string,
  proposals: { text: string; label: string; typ: "T" | "W" | "verfahren"; bezirk: string }[],
  model: string,
  firstOrd: number,
): Promise<Mp[]> {
  // All or nothing: a half-saved proposal would later look complete.
  const out: Mp[] = [];
  let ord = firstOrd;
  await db.transaction(async (tx) => {
    for (const p of proposals) {
      const r = await tx.execute(sql`
        INSERT INTO map_points (tenant_id, consultation_id, scope, ord, typ, bezirk, text, label, created_by)
        VALUES (${cons.tenantId}, ${cons.id}, ${scope}, ${ord++}, ${p.typ}, ${p.bezirk}, ${p.text}, ${p.label}, ${`ai-condense:${model}`})
        RETURNING id
      `);
      out.push({ id: (r.rows[0] as { id: string }).id, ...p });
    }
  });
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const provider = new AgentSdkProvider();
  const judge = new JevJudge();

  const scopeRes = await db.execute(sql`
    SELECT DISTINCT measure FROM points
    WHERE consultation_id = ${cons.id} AND measure IS NOT NULL AND status = 'released'
    ORDER BY measure
  `);
  let scopes = (scopeRes.rows as { measure: string }[]).map((r) => r.measure);
  if (arg("scope")) scopes = scopes.filter((s) => s === arg("scope"));
  const started = Date.now();

  const summary: string[] = [];
  const { failed } = await runPool(
    scopes,
    async (scope) => {
      const t0 = Date.now();
      const ptRes = await db.execute(sql`
        SELECT id, label, summary, kind, cq, map_point_id FROM points
        WHERE consultation_id = ${cons.id} AND measure = ${scope} AND status = 'released'
          AND kind <> 'gap' AND created_by <> 'import:questionnaire'
        ORDER BY created_at
      `);
      const pts = ptRes.rows as unknown as Pt[];
      const exRes = await db.execute(sql`
        SELECT id, label, text, typ, bezirk FROM map_points
        WHERE consultation_id = ${cons.id} AND scope = ${scope} AND typ <> 'luecke' ORDER BY ord
      `);
      let mps = exRes.rows as unknown as Mp[];
      let proposedNow = 0;
      if (mps.length === 0) {
        const r = await provider.generateStructured({
          system: CONDENSE_PROPOSE_SYSTEM,
          prompt: condensePrompt(pts, scope),
          schema: condenseProposeJsonSchema,
        });
        mps = await insertMapPoints(db, cons, scope, condenseProposeOutput.parse(r.output).map_points, r.provenance.model, 1);
        proposedNow = mps.length;
      }
      let uncovered = await assign(db, judge, cons, scope, pts.filter((p) => !p.map_point_id), mps);
      let topUp = 0;
      if (uncovered.length >= 3 && uncovered.length > pts.length * TOP_UP_ABOVE) {
        const r = await provider.generateStructured({
          system: CONDENSE_PROPOSE_SYSTEM,
          prompt: condenseTopUpPrompt(scope, mps, uncovered),
          schema: condenseProposeJsonSchema,
        });
        const extra = condenseProposeOutput.parse(r.output).map_points;
        if (extra.length) {
          mps = [...mps, ...(await insertMapPoints(db, cons, scope, extra, r.provenance.model, mps.length + 1))];
          topUp = extra.length;
          uncovered = await assign(db, judge, cons, scope, uncovered, mps);
        }
      }

      // Districts from typ + member doors; empty map points go; order by district and size.
      const memRes = await db.execute(sql`
        SELECT map_point_id, cq, count(*) OVER (PARTITION BY map_point_id)::int AS n FROM points
        WHERE consultation_id = ${cons.id} AND measure = ${scope} AND map_point_id IS NOT NULL
          AND status = 'released'
      `);
      const doors = new Map<string, (string | null)[]>();
      for (const m of memRes.rows as { map_point_id: string; cq: string | null }[]) {
        doors.set(m.map_point_id, [...(doors.get(m.map_point_id) ?? []), m.cq]);
      }
      const kept = mps.filter((m) => doors.has(m.id));
      const empty = mps.filter((m) => !doors.has(m.id));
      const ordered = kept
        .map((m) => ({ ...m, bezirk: deriveBezirk(m.typ, doors.get(m.id)!, m.bezirk), n: doors.get(m.id)!.length }))
        .sort((a, b) => BEZIRK_ORDER.indexOf(a.bezirk) - BEZIRK_ORDER.indexOf(b.bezirk) || b.n - a.n);
      await db.transaction(async (tx) => {
        for (const m of empty) await tx.execute(sql`DELETE FROM map_points WHERE id = ${m.id}`);
        // (consultation, scope, ord) is unique: move to temporary numbers first.
        await tx.execute(sql`UPDATE map_points SET ord = ord + 10000 WHERE consultation_id = ${cons.id} AND scope = ${scope}`);
        for (const [i, m] of ordered.entries()) {
          await tx.execute(sql`UPDATE map_points SET ord = ${i + 1}, bezirk = ${m.bezirk} WHERE id = ${m.id}`);
        }
        await tx.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
          VALUES (${cons.tenantId}, 'pipeline:condense', 'consultation.condense_map', 'consultation', ${cons.id},
                  ${JSON.stringify({ scope, proposed: proposedNow, topUp, kept: kept.length, removedEmpty: empty.length, points: pts.length, uncovered: uncovered.length })})
        `);
      });
      const line =
        `${scope}: ${pts.length} points → ${kept.length} map points` +
        `${proposedNow ? ` (proposed ${proposedNow}${topUp ? ` + top-up ${topUp}` : ""}, ${empty.length} empty removed)` : ""} · ` +
        `uncovered ${uncovered.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`;
      summary.push(line);
      console.log(`  ${line}`);
    },
    Number(arg("concurrency") ?? 4),
    { label: (sc) => `measure "${sc}"`, progress: "condense" },
  );
  console.log(`condensation done in ${((Date.now() - started) / 1000).toFixed(0)}s · ${scopes.length} measures, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
