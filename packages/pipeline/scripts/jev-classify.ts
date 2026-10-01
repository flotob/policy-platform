/**
 * exp/jev step 3 — doors, measure, theme, and map point per point as
 * calibrated choices (one request per point, answers keyed by name).
 *
 * Replaces the index-keyed LLM batches of classify-cq (pass 2),
 * segment-measures (assign), cluster-themes (assign), condense-map (sweep).
 * The PROPOSE passes (which measures/themes/map points exist) stay LLM: they
 * generate names and canonical texts.
 *
 * Fill policy, per column: written only when that stage never ran on this
 * consultation (no point carries a value) — on a labelled consultation an
 * empty value is a DECISION (theme "none fits", gap points off the map), not
 * a gap to fill. --overwrite replaces every judged column (then re-run the
 * downstream stages). Default on a labelled consultation = comparison run.
 * Gap points get no map-point question (condense-map excludes them).
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/jev-classify.ts \
 *     --consultation <ref> [--concurrency 8] [--overwrite]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import {
  CLASSIFY_FAMILY,
  classifyQuestions,
  classifyState,
  decideClassify,
  existingRole,
  type ClassifyContext,
  type ClassifyDecision,
} from "../src/jev-classify.ts";
import { agreementReport, judgeAll, resolveConsultation, saveJudgment, statsLine } from "../src/jev-stage.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const GENERAL = "übergreifend";

interface Row {
  id: string;
  label: string;
  summary: string | null;
  kind: string;
  cq: string | null;
  answers_cq: string[] | null;
  measure: string | null;
  theme: string | null;
  map_point_id: string | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const concurrency = Number(arg("concurrency") ?? 8);
  const overwrite = process.argv.includes("--overwrite");

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const pRes = await db.execute(sql`
    SELECT id, label, summary, kind, cq, answers_cq, measure, theme, map_point_id
    FROM points
    WHERE consultation_id = ${cons.id}
      AND status IN ('draft', 'released')
      AND created_by <> 'import:questionnaire'
    ORDER BY created_at
  `);
  const pts = pRes.rows as unknown as Row[];
  const proposed = async (action: string, key: string): Promise<string[]> => {
    const r = await db.execute(sql`
      SELECT payload FROM audit_log WHERE action = ${action} AND subject_id = ${cons.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    return ((r.rows[0] as { payload: Record<string, string[]> } | undefined)?.payload?.[key] ?? []).filter(Boolean);
  };
  // Assigned values first; on a fresh consultation the audited proposals
  // (segment-measures / cluster-themes --propose-only) define the options.
  let measures = [...new Set(pts.map((p) => p.measure).filter((m): m is string => !!m && m !== GENERAL))].sort();
  if (measures.length === 0) measures = await proposed("consultation.propose_measures", "measures");
  let themes = [...new Set(pts.map((p) => p.theme).filter((t): t is string => !!t))].sort();
  if (themes.length === 0) themes = await proposed("consultation.propose_themes", "themes");
  const mpRes = await db.execute(sql`
    SELECT id, scope, label, text FROM map_points
    WHERE consultation_id = ${cons.id} AND typ <> 'luecke' ORDER BY scope, ord
  `);
  const mapPointsByScope = new Map<string, { id: string; label: string; text: string }[]>();
  for (const m of mpRes.rows as { id: string; scope: string; label: string; text: string }[]) {
    if (!mapPointsByScope.has(m.scope)) mapPointsByScope.set(m.scope, []);
    mapPointsByScope.get(m.scope)!.push({ id: m.id, label: m.label, text: m.text });
  }
  const doorsExist = pts.some((p) => p.cq !== null || (p.answers_cq?.length ?? 0) > 0);
  const measuresAssigned = pts.some((p) => p.measure !== null);
  const themesAssigned = pts.some((p) => p.theme !== null);
  const mapAssigned = pts.some((p) => p.map_point_id !== null);
  if (measures.length === 0) throw new Error("no measures yet — run segment-measures --propose-only first");
  console.log(
    `${pts.length} points · ${measures.length} measures · ${themes.length} themes · ` +
      `${mpRes.rows.length} map points · writes: ${overwrite ? "OVERWRITE" : `doors ${doorsExist ? "no" : "fill"}, measure ${measuresAssigned ? "no" : "fill"}, theme ${themesAssigned ? "no" : "fill"}, map ${mapAssigned ? "no" : "fill"}`}`,
  );

  const ctxFor = (p: Row): ClassifyContext => ({
    measures,
    themes,
    mapPoints: p.kind !== "gap" && p.measure ? (mapPointsByScope.get(p.measure) ?? []) : [],
  });
  const judge = new JevJudge();
  const decided = new Map<string, ClassifyDecision>();
  let writes = 0;

  const stats = await judgeAll(
    judge,
    pts,
    (p) => ({
      state: classifyState(cons.title, ctxFor(p), { label: p.label, summary: p.summary, kind: p.kind }),
      questions: classifyQuestions(ctxFor(p)),
    }),
    async (p, answers, provenance) => {
      const d = decideClassify(ctxFor(p), answers);
      decided.set(p.id, d);
      await saveJudgment(db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: "point",
        subjectId: p.id,
        family: CLASSIFY_FAMILY,
        provenance,
        answers,
        decided: d,
      });
      const setDoors = overwrite || !doorsExist;
      const setMeasure = overwrite || !measuresAssigned;
      const setTheme = overwrite || !themesAssigned;
      const setMap = d.mapPointId !== undefined && (overwrite || !mapAssigned);
      if (setDoors || setMeasure || setTheme || setMap) {
        await db.execute(sql`
          UPDATE points SET
            cq = CASE WHEN ${setDoors} THEN ${d.cq} ELSE cq END,
            answers_cq = CASE WHEN ${setDoors} THEN ${d.answersCq ? `{${d.answersCq.join(",")}}` : null}::text[] ELSE answers_cq END,
            measure = CASE WHEN ${setMeasure} THEN ${d.measure} ELSE measure END,
            theme = CASE WHEN ${setTheme} THEN ${d.theme} ELSE theme END,
            map_point_id = CASE WHEN ${setMap} THEN ${d.mapPointId ?? null}::uuid ELSE map_point_id END
          WHERE id = ${p.id}
        `);
        writes++;
      }
    },
    concurrency,
  );
  console.log(`\n${statsLine(stats)} · rows written ${writes}`);

  const judged = pts.filter((p) => decided.has(p.id));
  const D = (p: Row) => decided.get(p.id)!;
  console.log(agreementReport(judged.map((p) => ({ existing: existingRole(p), jev: D(p).role })), "role"));
  const bothObj = judged.filter((p) => p.cq && D(p).role === "objection");
  console.log(agreementReport(bothObj.map((p) => ({ existing: p.cq, jev: D(p).cq! })), "door (both objection)"));
  const bothIns = judged.filter((p) => (p.answers_cq?.length ?? 0) > 0 && D(p).role === "instrument");
  console.log(agreementReport(bothIns.map((p) => ({ existing: p.answers_cq![0]!, jev: D(p).answersCq![0]! })), "primary door (both instrument)"));
  console.log(agreementReport(judged.map((p) => ({ existing: p.measure, jev: D(p).measure })), "measure"));
  console.log(agreementReport(judged.map((p) => ({ existing: p.theme, jev: D(p).theme ?? "(none)" })), "theme"));
  const withMap = judged.filter((p) => D(p).mapPointId !== undefined);
  console.log(
    agreementReport(withMap.map((p) => ({ existing: p.map_point_id ?? "(none)", jev: D(p).mapPointId ?? "(none)" })), "map point"),
  );
  const lowConf = judged.filter((p) => D(p).confidence.measure < 0.5 || D(p).confidence.role < 0.5).length;
  console.log(`low-confidence (role or measure < 0.5): ${lowConf} → editorial review`);

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-classify-${ref}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        consultation: ref,
        overwrite,
        stats: { ...stats, latencies: undefined },
        items: judged.map((p) => ({
          label: p.label,
          existing: { role: existingRole(p), cq: p.cq, answers_cq: p.answers_cq, measure: p.measure, theme: p.theme },
          jev: D(p),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`report → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
