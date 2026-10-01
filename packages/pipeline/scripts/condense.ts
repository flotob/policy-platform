/**
 * Condensation into Landkarten-Punkte (exp/jev, v2) — replaces
 * condense-map.ts in the Jev chain.
 *
 * Per measure (all measures in parallel):
 *  0. WEIGH (Jev): which organisations agree / disagree with each point,
 *     inferred from every statement (point-stance.v1).
 *  1. PROPOSE (LLM): the disputed QUESTIONS of the measure, one votable
 *     statement each (question, text, label, typ, district), at most
 *     MAP_POINTS_MAX. The LLM sees who said each point and who agrees or
 *     disagrees, so weight decides what gets on the map; positions on the
 *     same question (raise / lower / delete) are one Landkarten-Punkt.
 *  2. DEDUPE (Jev): every pair of proposals of the same typ — "do these two
 *     ask the same question?" — merges into the earlier one.
 *  3. ASSIGN (Jev): every extraction point → the question it takes a
 *     position on, or "none". Points no question takes stay unassigned: the
 *     Landkarte lists them as Einzelforderungen (no top-up round any more —
 *     it doubled the big maps with single demands).
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
import { AgentSdkProvider, JevJudge, type JudgeProvenance } from "@policy/llm";

import { deriveBezirk } from "../src/jev-grammar.ts";
import { MAP_ASSIGN_FAMILY, MAP_DEDUPE_FAMILY, mapAssignQuestion, mergeGroups, sameQuestion } from "../src/jev-map.ts";
import { judgeAll, resolveConsultation, saveJudgment, sinceReset, statsLine, type StageStats } from "../src/jev-stage.ts";
import { STANCE_BATCH, decideStance, stanceQuestion, type StanceProbs } from "../src/jev-stance.ts";
import type { BillMeasure } from "../src/measures.ts";
import { chunkText } from "../src/pipeline.ts";
import { runPool } from "../src/pool.ts";
import { CONDENSE_PROPOSE_SYSTEM, MAP_POINTS_MAX, condenseQuestionsPrompt } from "../src/prompts.ts";
import { condenseProposeJsonSchema, condenseProposeOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

export const POINT_STANCE_FAMILY = "point-stance.v1";
const BEZIRK_ORDER = ["wirkung", "machbarkeit", "kosten", "alternativen", "wert", "ausgestaltung"];
/** Same-question pairs per Jev request (all proposals ride in the state). */
const DEDUPE_BATCH = 60;

interface Pt {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  cq: string | null;
  map_point_id: string | null;
  orgs: string[];
}
type Typ = "T" | "W" | "verfahren";
interface Proposal {
  question: string;
  text: string;
  label: string;
  typ: Typ;
  bezirk: string;
}
interface Mp extends Proposal {
  id: string;
}

async function assign(
  db: Db,
  judge: JevJudge,
  cons: { id: string; tenantId: string },
  scope: string,
  pts: Pt[],
  mps: Mp[],
): Promise<Pt[]> {
  const options: Record<string, { label: string; question: string; text: string }> = {};
  mps.forEach((m, i) => (options[`k${i + 1}`] = { label: m.label, question: m.question, text: m.text }));
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

interface Sub {
  id: string;
  org: string;
  text: string;
}
export type Weight = { agree: string[]; disagree: string[] };

/**
 * Jev: which organisations agree or disagree with each point — inferred from
 * every statement, like the votes. Weight for the proposal: a point one
 * organisation SAID can still be contested by others (WPG: "Holz ist
 * vollwertig erneuerbar" — said by one, the core conflict of its measure).
 */
async function weigh(
  db: Db,
  judge: JevJudge,
  cons: { id: string; tenantId: string },
  scope: string,
  pts: Pt[],
  subs: Sub[],
): Promise<{ weights: Map<string, Weight>; stats: StageStats }> {
  const reqs: { sub: Sub; window: number; text: string; pts: Pt[] }[] = [];
  for (const sub of subs) {
    chunkText(sub.text, 20_000).forEach((text, window) => {
      for (let o = 0; o < pts.length; o += STANCE_BATCH) reqs.push({ sub, window, text, pts: pts.slice(o, o + STANCE_BATCH) });
    });
  }
  const probs = new Map<string, Map<string, StanceProbs[]>>(); // point → sub → windows
  const models = new Map<string, JudgeProvenance>();
  const stats = await judgeAll(
    judge,
    reqs,
    (r) => ({
      state: { submission: r.text },
      questions: Object.fromEntries(r.pts.map((p, i) => [`s${i}`, stanceQuestion(p.summary ?? p.label)])),
    }),
    async (r, answers, provenance) => {
      r.pts.forEach((p, i) => {
        if (!probs.has(p.id)) probs.set(p.id, new Map());
        const bySub = probs.get(p.id)!;
        if (!bySub.has(r.sub.id)) bySub.set(r.sub.id, []);
        bySub.get(r.sub.id)![r.window] = (answers[`s${i}`] as { probabilities: StanceProbs }).probabilities;
        models.set(p.id, provenance);
      });
    },
    8,
    { label: (r) => `${scope}: weight from ${r.sub.org} window ${r.window + 1}` },
  );
  if (stats.failed > 0) throw new Error(`${scope}: ${stats.failed} weight requests failed — rerun`);
  const weights = new Map<string, Weight>();
  await db.transaction(async (tx) => {
    for (const p of pts) {
      const w: Weight = { agree: [], disagree: [] };
      for (const sub of subs) {
        const d = decideStance(probs.get(p.id)!.get(sub.id)!);
        if (d.value === 1) w.agree.push(sub.org);
        else if (d.value === -1) w.disagree.push(sub.org);
      }
      weights.set(p.id, w);
      await saveJudgment(tx as unknown as Db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: "point",
        subjectId: p.id,
        family: POINT_STANCE_FAMILY,
        provenance: models.get(p.id)!,
        answers: Object.fromEntries(probs.get(p.id)!),
        decided: w,
      });
    }
  });
  return { weights, stats };
}

/** Jev: which proposals ask the same question (pairs of the same typ only — facts, values, design stay apart). */
async function dedupe(
  judge: JevJudge,
  scope: string,
  proposals: Proposal[],
): Promise<{ keep: number[]; groups: number[]; records: { provenance: JudgeProvenance; answers: unknown; pairs: { i: number; j: number; p: number }[] }[] }> {
  const key = (i: number) => `k${i + 1}`;
  const pairs: { i: number; j: number }[] = [];
  for (let i = 0; i < proposals.length; i++)
    for (let j = i + 1; j < proposals.length; j++) if (proposals[i]!.typ === proposals[j]!.typ) pairs.push({ i, j });
  const state = {
    measure: scope,
    points: Object.fromEntries(proposals.map((p, i) => [key(i), { question: p.question, text: p.text }])),
  };
  const batches: { i: number; j: number }[][] = [];
  for (let o = 0; o < pairs.length; o += DEDUPE_BATCH) batches.push(pairs.slice(o, o + DEDUPE_BATCH));
  const records: { provenance: JudgeProvenance; answers: unknown; pairs: { i: number; j: number; p: number }[] }[] = [];
  const res = await runPool(
    batches,
    async (batch) => {
      const questions: Record<string, ReturnType<typeof sameQuestion>> = {};
      batch.forEach(({ i, j }) => (questions[`${key(i)}_${key(j)}`] = sameQuestion(key(i), key(j))));
      const { answers, provenance } = await judge.judge(state, questions);
      records.push({
        provenance,
        answers,
        pairs: batch.map(({ i, j }) => ({ i, j, p: (answers[`${key(i)}_${key(j)}`] as { noul: number }).noul })),
      });
    },
    4,
    { label: (b) => `${scope}: same-question check (${b.length} pairs)` },
  );
  if (res.failed > 0) throw new Error(`${scope}: ${res.failed} same-question requests failed — rerun`);
  const groups = mergeGroups(proposals.length, records.flatMap((r) => r.pairs));
  return { keep: groups.flatMap((g, i) => (g === i ? [i] : [])), groups, records };
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

  // What the bill says about each measure (propose-measures-bill.ts) — context for the questions.
  const billRes = await db.execute(sql`
    SELECT payload FROM audit_log a WHERE action = 'consultation.propose_measures' AND subject_id = ${cons.id}
      AND payload ? 'details' AND a.created_at > ${sinceReset(cons.id)}
    ORDER BY created_at DESC LIMIT 1
  `);
  const bill = new Map(
    ((billRes.rows[0] as { payload: { details: BillMeasure[] } } | undefined)?.payload.details ?? []).map((m) => [m.name, m.description]),
  );

  const subRes = await db.execute(sql`
    SELECT id, COALESCE(author_org, 'Stellungnahme') AS org, text FROM submissions
    WHERE consultation_id = ${cons.id} AND text IS NOT NULL ORDER BY length(text) DESC
  `);
  const subs = subRes.rows as unknown as Sub[];

  const scopeRes = await db.execute(sql`
    SELECT DISTINCT measure FROM points
    WHERE consultation_id = ${cons.id} AND measure IS NOT NULL AND status = 'released'
    ORDER BY measure
  `);
  let scopes = (scopeRes.rows as { measure: string }[]).map((r) => r.measure);
  if (arg("scope")) scopes = scopes.filter((s) => s === arg("scope"));
  const started = Date.now();

  const { failed } = await runPool(
    scopes,
    async (scope) => {
      const t0 = Date.now();
      const ptRes = await db.execute(sql`
        SELECT p.id, p.label, p.summary, p.kind, p.cq, p.map_point_id,
          COALESCE((SELECT array_agg(DISTINCT COALESCE(s.author_org, 'Stellungnahme') ORDER BY COALESCE(s.author_org, 'Stellungnahme'))
                    FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
                    WHERE ps.point_id = p.id), '{}') AS orgs
        FROM points p
        WHERE p.consultation_id = ${cons.id} AND p.measure = ${scope} AND p.status = 'released'
          AND p.kind <> 'gap' AND p.created_by <> 'import:questionnaire'
        ORDER BY p.created_at
      `);
      const pts = ptRes.rows as unknown as Pt[];
      const exRes = await db.execute(sql`
        SELECT id, question, label, text, typ, bezirk FROM map_points
        WHERE consultation_id = ${cons.id} AND scope = ${scope} AND typ <> 'luecke' ORDER BY ord
      `);
      let mps = exRes.rows as unknown as Mp[];
      let proposedNow = 0;
      let mergedNow = 0;
      if (mps.length === 0) {
        const { weights, stats } = await weigh(db, judge, cons, scope, pts, subs);
        console.log(`    ${scope}: weight ${statsLine(stats)}`);
        const r = await provider.generateStructured({
          system: CONDENSE_PROPOSE_SYSTEM,
          prompt: condenseQuestionsPrompt(scope, bill.get(scope) ?? null, pts.map((p) => ({ ...p, ...weights.get(p.id)! }))),
          schema: condenseProposeJsonSchema,
        });
        const proposals = condenseProposeOutput.parse(r.output).map_points;
        const d = await dedupe(judge, scope, proposals);
        proposedNow = proposals.length;
        mergedNow = proposals.length - d.keep.length;
        // Proposals and the same-question record commit together: on resume
        // existing map points mean "proposed and deduplicated".
        mps = [];
        await db.transaction(async (tx) => {
          for (const [ord, i] of d.keep.entries()) {
            const p = proposals[i]!;
            const ins = await tx.execute(sql`
              INSERT INTO map_points (tenant_id, consultation_id, scope, ord, typ, bezirk, question, text, label, created_by)
              VALUES (${cons.tenantId}, ${cons.id}, ${scope}, ${ord + 1}, ${p.typ}, ${p.bezirk}, ${p.question}, ${p.text}, ${p.label},
                      ${`ai-condense:${r.provenance.model}`})
              RETURNING id
            `);
            mps.push({ id: (ins.rows[0] as { id: string }).id, ...p });
          }
          for (const [b, rec] of d.records.entries()) {
            await saveJudgment(tx as unknown as Db, {
              tenantId: cons.tenantId,
              consultationId: cons.id,
              subjectKind: "map_scope",
              subjectId: `${cons.id}:${scope}:${b}`,
              family: MAP_DEDUPE_FAMILY,
              provenance: rec.provenance,
              answers: rec.answers,
              decided: {
                pairs: rec.pairs.map(({ i, j, p }) => ({ a: proposals[i]!.label, b: proposals[j]!.label, p })),
                mergedInto: d.groups.flatMap((g, i) => (g !== i ? [{ label: proposals[i]!.label, into: proposals[g]!.label }] : [])),
              },
            });
          }
        });
        for (const [i, g] of d.groups.entries()) {
          if (g !== i) console.log(`    same question: "${proposals[i]!.label}" → "${proposals[g]!.label}"`);
        }
      }
      const uncovered = await assign(db, judge, cons, scope, pts.filter((p) => !p.map_point_id), mps);

      // Districts from typ + member doors; empty map points go; order by district and size.
      const memRes = await db.execute(sql`
        SELECT map_point_id, cq FROM points
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
      // Every point without a map point was just judged: "none" = Einzelforderung.
      const single = uncovered.length;
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
                  ${JSON.stringify({ scope, version: 2, proposed: proposedNow, sameQuestionMerged: mergedNow, kept: kept.length, removedEmpty: empty.length, points: pts.length, einzelforderungen: single })})
        `);
      });
      const line =
        `${scope}: ${pts.length} points → ${kept.length} Landkarten-Punkte` +
        `${proposedNow ? ` (proposed ${proposedNow}, ${mergedNow} same question merged, ${empty.length} empty removed)` : ""} · ` +
        `Einzelforderungen ${single} · ${((Date.now() - t0) / 1000).toFixed(0)}s`;
      console.log(`  ${line}`);
      if (kept.length > MAP_POINTS_MAX) throw new Error(`${scope}: ${kept.length} Landkarten-Punkte > ${MAP_POINTS_MAX}`);
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
