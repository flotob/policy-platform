/**
 * exp/jev step 5 — editorial review as criterion judgments.
 *
 * DRAFT items get a verdict: release / reject are applied, "review" stays
 * draft and is logged for a person (audit action *.needs_review, with the
 * failing criteria). Already decided items are judged for comparison only —
 * editorial decisions are never overwritten by the machine.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/jev-review.ts \
 *     --consultation <ref> [--what points|statements] [--concurrency 8]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge, type EntryType } from "@policy/llm";

import {
  REVIEW_POINT_FAMILY,
  REVIEW_STATEMENT_FAMILY,
  decidePointReview,
  decideStatementReview,
  pointReviewQuestions,
  statementReviewQuestions,
  type ReviewDecision,
} from "../src/jev-review.ts";
import { judgeAll, resolveConsultation, saveJudgment, statsLine } from "../src/jev-stage.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

interface Item {
  id: string;
  status: string;
  state: EntryType;
  label: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const what = (arg("what") ?? "points") as "points" | "statements";
  const concurrency = Number(arg("concurrency") ?? 8);

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  let items: Item[];
  if (what === "points") {
    const res = await db.execute(sql`
      SELECT id, status, label, summary FROM points
      WHERE consultation_id = ${cons.id} AND status IN ('draft', 'released', 'rejected')
        AND created_by <> 'import:questionnaire'
    `);
    items = (res.rows as { id: string; status: string; label: string; summary: string | null }[]).map((p) => ({
      id: p.id,
      status: p.status,
      label: p.label,
      state: { consultation: cons.title, point: { label: p.label, summary: p.summary } },
    }));
  } else {
    const res = await db.execute(sql`
      SELECT p.id, p.label, p.summary,
        (SELECT st.status FROM statements st WHERE st.point_id = p.id AND st.locale = 'de'
           ORDER BY st.version DESC LIMIT 1) AS status,
        (SELECT st.text FROM statements st WHERE st.point_id = p.id AND st.locale = 'de'
           ORDER BY st.version DESC LIMIT 1) AS de,
        (SELECT st.text FROM statements st WHERE st.point_id = p.id AND st.locale = 'en'
           ORDER BY st.version DESC LIMIT 1) AS en
      FROM points p
      WHERE p.consultation_id = ${cons.id} AND p.created_by <> 'import:questionnaire'
        AND EXISTS (SELECT 1 FROM statements st WHERE st.point_id = p.id)
    `);
    items = (res.rows as { id: string; label: string; summary: string | null; status: string; de: string | null; en: string | null }[])
      .filter((r) => r.de && r.en)
      .map((r) => ({
        id: r.id,
        status: r.status,
        label: r.de!,
        state: { point: { label: r.label, summary: r.summary }, statement: { de: r.de, en: r.en } },
      }));
  }
  console.log(`${items.length} ${what} (${items.filter((i) => i.status === "draft").length} draft)`);

  const judge = new JevJudge();
  const decided = new Map<string, ReviewDecision>();
  let applied = 0;
  const stats = await judgeAll(
    judge,
    items,
    (it) => ({
      state: it.state,
      questions: what === "points" ? pointReviewQuestions() : statementReviewQuestions(),
    }),
    async (it, answers, provenance) => {
      const a = answers as Record<string, { noul: number }>;
      const d = what === "points" ? decidePointReview(a) : decideStatementReview(a);
      decided.set(it.id, d);
      await saveJudgment(db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: what === "points" ? "point" : "statement",
        subjectId: it.id,
        family: what === "points" ? REVIEW_POINT_FAMILY : REVIEW_STATEMENT_FAMILY,
        provenance,
        answers,
        decided: d,
      });
      if (it.status !== "draft") return;
      const noun = what === "points" ? "point" : "statement";
      if (d.verdict !== "review") {
        const status = d.verdict === "release" ? "released" : "rejected";
        if (what === "points") {
          await db.execute(sql`UPDATE points SET status = ${status} WHERE id = ${it.id} AND status = 'draft'`);
        } else {
          await db.execute(sql`UPDATE statements SET status = ${status} WHERE point_id = ${it.id} AND status = 'draft'`);
        }
        applied++;
      }
      await db.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, reason)
        VALUES (${cons.tenantId}, ${`jev:${provenance.model}`},
                ${`${noun}.${d.verdict === "review" ? "needs_review" : d.verdict}`},
                'point', ${it.id}, ${d.flags.join(", ") || null})
      `);
    },
    concurrency,
  );
  console.log(`\n${statsLine(stats)} · applied to drafts: ${applied}`);

  const decidedItems = items.filter((i) => decided.has(i.id) && i.status !== "draft");
  const cell = (s: string, v: string) => decidedItems.filter((i) => i.status === s && decided.get(i.id)!.verdict === v).length;
  for (const s of ["released", "rejected"]) {
    const n = decidedItems.filter((i) => i.status === s).length;
    if (n === 0) continue;
    console.log(`existing ${s} (${n}) → jev release ${cell(s, "release")} · review ${cell(s, "review")} · reject ${cell(s, "reject")}`);
  }
  const flagCounts = new Map<string, number>();
  for (const d of decided.values()) for (const f of d.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  console.log(`flags: ${[...flagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(" · ")}`);

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-review-${what}-${ref}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(
    out,
    JSON.stringify(
      {
        consultation: ref,
        what,
        stats: { ...stats, latencies: undefined },
        items: items.filter((i) => decided.has(i.id)).map((i) => ({ label: i.label, existing: i.status, jev: decided.get(i.id) })),
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
