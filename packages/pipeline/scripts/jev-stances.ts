/**
 * exp/jev step 4 — stance inference with calibrated choices.
 *
 * Every (submission, released statement) pair is judged in every text
 * window of the submission; code merges windows (src/jev-stance.ts). Raw
 * per-window probabilities + the merged decision land in `judgments`
 * (family stance.v1, subject `stance` = submission:statement).
 *
 * Votes: submissions never stance-inferred get Jev votes (method
 * 'inferred', confidence = P of the stance). With --overwrite the existing
 * INFERRED votes of each judged submission are replaced; real votes are
 * never touched. Default on an inferred consultation = comparison run.
 * After --overwrite: re-run analyze → name-camps → diagnose-map.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/jev-stances.ts \
 *     --consultation <ref> [--limit N] [--concurrency 8] [--overwrite]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import { chunkText } from "../src/pipeline.ts";
import {
  STANCE_BATCH,
  STANCE_FAMILY,
  decideStance,
  stanceQuestion,
  type StanceDecision,
  type StanceProbs,
} from "../src/jev-stance.ts";
import { judgeAll, resolveConsultation, sinceReset, saveJudgment, statsLine } from "../src/jev-stage.ts";
import type { JudgeProvenance } from "@policy/llm";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

interface Sub {
  id: string;
  source_ref: string | null;
  author_org: string | null;
  author_type: string | null;
  language: string | null;
  text: string;
  inferred_before: boolean;
}

interface Req {
  sub: Sub;
  window: number;
  text: string;
  statements: { id: string; text: string }[];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const limit = Number(arg("limit") ?? 100_000);
  const concurrency = Number(arg("concurrency") ?? 8);
  const overwrite = process.argv.includes("--overwrite");

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const stRes = await db.execute(sql`
    SELECT DISTINCT ON (st.point_id) st.id, st.text
    FROM statements st JOIN points p ON p.id = st.point_id
    WHERE p.consultation_id = ${cons.id} AND st.status = 'released' AND p.kind <> 'gap'
    ORDER BY st.point_id, st.locale
  `);
  const statements = stRes.rows as { id: string; text: string }[];
  const subRes = await db.execute(sql`
    SELECT s.id, s.source_ref, s.author_org, s.author_type, s.language, s.text,
      EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'participant.infer_stances'
              AND a.subject_kind = 'submission' AND a.subject_id = s.id::text
              AND a.created_at > ${sinceReset(cons.id)}) AS inferred_before
    FROM submissions s
    WHERE s.consultation_id = ${cons.id} AND s.text IS NOT NULL
    ORDER BY length(s.text) DESC
    LIMIT ${limit}
  `);
  const subs = subRes.rows as unknown as Sub[];

  const reqs: Req[] = [];
  for (const sub of subs) {
    chunkText(sub.text, 20_000).forEach((text, window) => {
      for (let o = 0; o < statements.length; o += STANCE_BATCH) {
        reqs.push({ sub, window, text, statements: statements.slice(o, o + STANCE_BATCH) });
      }
    });
  }
  console.log(`${subs.length} submissions × ${statements.length} statements → ${reqs.length} requests`);

  // probs[sub:statement][window]
  const probs = new Map<string, StanceProbs[]>();
  const provenances = new Map<string, JudgeProvenance>();
  const judge = new JevJudge();
  const stats = await judgeAll(
    judge,
    reqs,
    (r) => {
      const questions: Record<string, ReturnType<typeof stanceQuestion>> = {};
      r.statements.forEach((st, i) => (questions[`s${i}`] = stanceQuestion(st.text)));
      return { state: { submission: r.text }, questions };
    },
    async (r, answers, provenance) => {
      r.statements.forEach((st, i) => {
        const a = answers[`s${i}`] as { probabilities: StanceProbs };
        const key = `${r.sub.id}:${st.id}`;
        if (!probs.has(key)) probs.set(key, []);
        probs.get(key)![r.window] = a.probabilities;
        provenances.set(key, provenance);
      });
    },
    concurrency,
  );
  console.log(`\n${statsLine(stats)}`);

  // ——— Existing votes, per submission's participant.
  const partRes = await db.execute(sql`
    SELECT id, source_ref FROM participants WHERE consultation_id = ${cons.id}
  `);
  const partBySource = new Map((partRes.rows as { id: string; source_ref: string }[]).map((p) => [p.source_ref, p.id]));
  const participantOf = (s: Sub) =>
    (s.source_ref ? partBySource.get(s.source_ref) : undefined) ?? partBySource.get(`inferred:${s.id}`) ?? null;
  const voteRes = await db.execute(sql`
    SELECT v.participant_id, v.statement_id, v.value, v.method FROM votes v
    JOIN participants pa ON pa.id = v.participant_id WHERE pa.consultation_id = ${cons.id}
  `);
  const existing = new Map<string, { value: number; method: string }>();
  for (const v of voteRes.rows as { participant_id: string; statement_id: string; value: number; method: string }[]) {
    existing.set(`${v.participant_id}:${v.statement_id}`, { value: v.value, method: v.method });
  }

  // ——— Decide, persist, compare.
  const confusion: Record<string, number> = {};
  const decisions = new Map<string, StanceDecision>();
  let samples: unknown[] = [];
  for (const sub of subs) {
    const pid = participantOf(sub);
    for (const st of statements) {
      const key = `${sub.id}:${st.id}`;
      const windows = probs.get(key);
      if (!windows || windows.some((w) => w === undefined)) continue;
      const d = decideStance(windows);
      decisions.set(key, d);
      await saveJudgment(db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: "stance",
        subjectId: key,
        family: STANCE_FAMILY,
        provenance: provenances.get(key)!,
        answers: { windows },
        decided: d,
      });
      const ex = pid ? existing.get(`${pid}:${st.id}`) : undefined;
      const exLabel = ex ? (ex.value === 1 ? "agree" : ex.value === -1 ? "disagree" : "pass") : "none";
      const jevLabel = d.value === 1 ? "agree" : d.value === -1 ? "disagree" : "none";
      confusion[`${exLabel} → ${jevLabel}`] = (confusion[`${exLabel} → ${jevLabel}`] ?? 0) + 1;
      if (exLabel !== jevLabel && (exLabel !== "none" || jevLabel !== "none") && samples.length < 400) {
        samples.push({
          author: sub.author_org,
          statement: st.text,
          llm: exLabel,
          jev: jevLabel,
          reason: d.reason,
          confidence: Number(d.confidence.toFixed(3)),
          addressed: Number(d.addressed.toFixed(3)),
        });
      }
    }
  }

  const votedBefore = Object.entries(confusion).filter(([k]) => !k.startsWith("none")).reduce((s, [, v]) => s + v, 0);
  const sameVote = (confusion["agree → agree"] ?? 0) + (confusion["disagree → disagree"] ?? 0);
  const jevVotes = Object.entries(confusion).filter(([k]) => !k.endsWith("none")).reduce((s, [, v]) => s + v, 0);
  console.log(`existing votes: ${votedBefore} · Jev votes: ${jevVotes} · same vote: ${sameVote}`);
  console.log(
    `confusion (existing → jev): ` +
      Object.entries(confusion)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
  );
  const conf = [...decisions.values()].filter((d) => d.value !== null).map((d) => d.confidence);
  const contradictions = [...decisions.values()].filter((d) => d.reason === "contradiction").length;
  console.log(
    `Jev vote confidence: mean ${(conf.reduce((s, x) => s + x, 0) / Math.max(1, conf.length)).toFixed(3)} · ` +
      `≥0.8: ${conf.filter((c) => c >= 0.8).length}/${conf.length} · contradictions (no vote): ${contradictions}`,
  );

  // ——— Votes.
  let written = 0;
  for (const sub of subs) {
    if (sub.inferred_before && !overwrite) continue;
    let pid = participantOf(sub);
    if (!pid) {
      const pRes = await db.execute(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language)
        VALUES (${cons.tenantId}, ${cons.id}, ${`inferred:${sub.id}`}, ${sub.author_org}, ${sub.author_type}, ${sub.language})
        ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org
        RETURNING id
      `);
      pid = (pRes.rows[0] as { id: string }).id;
    }
    if (overwrite) {
      await db.execute(sql`DELETE FROM votes WHERE participant_id = ${pid} AND method = 'inferred'`);
    }
    for (const st of statements) {
      const d = decisions.get(`${sub.id}:${st.id}`);
      if (!d || d.value === null) continue;
      await db.execute(sql`
        INSERT INTO votes (tenant_id, participant_id, statement_id, value, method, confidence)
        VALUES (${cons.tenantId}, ${pid}, ${st.id}, ${d.value}, 'inferred', ${d.confidence})
        ON CONFLICT (participant_id, statement_id) DO NOTHING
      `);
      written++;
    }
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${cons.tenantId}, 'jev:stance', 'participant.infer_stances', 'submission', ${sub.id},
              ${JSON.stringify({ family: STANCE_FAMILY, overwrite })})
    `);
  }
  console.log(`votes written: ${written}${written && overwrite ? " — re-run analyze → name-camps → diagnose-map" : ""}`);

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-stances-${ref}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify({ consultation: ref, overwrite, stats: { ...stats, latencies: undefined }, confusion, disagreements: samples }, null, 2));
  console.log(`report → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
