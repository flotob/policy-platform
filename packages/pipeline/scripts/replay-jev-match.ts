/**
 * Step 1 of the Jev experiment: replay the matcher ("known point or new?")
 * with Jev against the recorded LLM decisions of a fully-decomposed
 * consultation. Same map snapshots as replay-batch-match (shared module),
 * reads only, writes a JSON report for human review of disagreements.
 *
 * The recorded LLM decisions are a BASELINE, not ground truth: agreement is
 * the first signal; the disagreement list is what a person must look at.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/replay-jev-match.ts \
 *     --consultation <ref> [--k 15] [--concurrency 8] [--limit-submissions N]
 *     [--shortlist-only]   # recall check of the lexical shortlist, no API calls
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import { DEFAULT_SHORTLIST, jevMatch, shortlist, type JevMatchVerdict } from "../src/jev-match.ts";
import { replayGroups, type ReplayDecision, type ReplayPoint } from "../src/match-replay.ts";
import { runPool } from "../src/pool.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const USD_PER_TOKEN = 42 / 1e9;

interface Item {
  decision: ReplayDecision;
  existing: ReplayPoint[];
  shortlisted: ReplayPoint[];
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const k = Number(arg("k") ?? DEFAULT_SHORTLIST);
  const concurrency = Number(arg("concurrency") ?? 8);
  const limitSubs = Number(arg("limit-submissions") ?? Infinity);
  const shortlistOnly = flag("shortlist-only");

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, title FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, title } = cons.rows[0] as { id: string; title: string };

  // Build every replay item first (cheap, deterministic).
  const items: Item[] = [];
  for await (const group of replayGroups(db, consultationId, limitSubs)) {
    for (const decision of group.decisions) {
      const candidate = { label: decision.candidate_label, summary: decision.candidate_summary };
      items.push({ decision, existing: group.existing, shortlisted: shortlist(candidate, group.existing, k) });
    }
  }

  // Shortlist recall: for recorded merges, is the merged point in the shortlist?
  const storedMatches = items.filter((it) => it.decision.outcome === "matched" && it.decision.matched_point);
  const inShortlist = storedMatches.filter((it) =>
    it.shortlisted.some((p) => p.id === it.decision.matched_point),
  ).length;
  const avgMap = items.reduce((s, it) => s + it.existing.length, 0) / Math.max(1, items.length);
  console.log(`${items.length} recorded decisions (avg map size ${avgMap.toFixed(0)} points, shortlist k=${k})`);
  console.log(`shortlist recall on recorded merges: ${inShortlist}/${storedMatches.length} = ${pct(inShortlist, storedMatches.length)}`);
  if (shortlistOnly) process.exit(0);

  const judge = new JevJudge();
  const verdicts = new Map<string, JevMatchVerdict>();
  const started = Date.now();
  const { failed } = await runPool(
    items,
    async (it) => {
      const v = await jevMatch(
        judge,
        { consultationTitle: title },
        { label: it.decision.candidate_label, summary: it.decision.candidate_summary },
        it.shortlisted,
      );
      if (v) verdicts.set(it.decision.id, v);
      if (verdicts.size % 25 === 0) process.stdout.write(".");
    },
    concurrency,
  );
  const wallMs = Date.now() - started;

  // ——— Compare against the recorded LLM baseline.
  let agree = 0;
  let bothMatched = 0;
  let samePoint = 0;
  let choiceAgree = 0;
  const bands = { merge: 0, review: 0, new: 0 };
  const reviewByStored = { matched: 0, new: 0 };
  const latencies: number[] = [];
  let tokens = 0;
  const disagreements: unknown[] = [];
  /** Every judged item, compact — for threshold tuning without re-running. */
  const all: { llm: string; score: number; pSame: number; choice: string; samePoint: boolean | null }[] = [];
  const labelById = new Map<string, string>();
  for (const it of items) for (const p of it.existing) labelById.set(p.id, p.label);

  for (const it of items) {
    const v = verdicts.get(it.decision.id);
    if (!v) continue;
    latencies.push(v.provenance.durationMs);
    tokens += v.provenance.inputTokens;
    bands[v.band]++;
    if (v.band === "review") reviewByStored[it.decision.outcome]++;
    all.push({
      llm: it.decision.outcome,
      score: Number(v.bestScore.toFixed(3)),
      pSame: Number(v.bestSameProbability.toFixed(3)),
      choice: v.choicePick === "none" ? "none" : v.choicePick === it.decision.matched_point ? "llm_point" : "other",
      samePoint:
        it.decision.outcome === "matched"
          ? v.shortlistIds.includes(it.decision.matched_point!)
          : null,
    });
    const choiceOutcome = v.choicePick === "none" ? "new" : "matched";
    if (choiceOutcome === it.decision.outcome) choiceAgree++;
    if (v.outcome === it.decision.outcome) {
      agree++;
      if (v.outcome === "matched") {
        bothMatched++;
        if (v.matchedPointId === it.decision.matched_point) samePoint++;
      }
    } else {
      disagreements.push({
        candidate: it.decision.candidate_label,
        candidate_summary: it.decision.candidate_summary,
        llm: it.decision.outcome,
        llm_point: it.decision.matched_point ? labelById.get(it.decision.matched_point) : null,
        llm_point_in_shortlist: it.decision.matched_point
          ? v.shortlistIds.includes(it.decision.matched_point)
          : null,
        jev: v.outcome,
        jev_point: v.matchedPointId ? labelById.get(v.matchedPointId) : null,
        jev_best_score: Number(v.bestScore.toFixed(3)),
        jev_p_same: Number(v.bestSameProbability.toFixed(3)),
        jev_band: v.band,
        jev_choice: v.choicePick === "none" ? "none" : labelById.get(v.choicePick),
      });
    }
  }

  const judged = verdicts.size;
  console.log(`\n\njudged ${judged}/${items.length} (${failed} failed) in ${(wallMs / 1000).toFixed(1)}s wall, concurrency ${concurrency}`);
  console.log(`latency per request: p50 ${quantile(latencies, 0.5)}ms · p95 ${quantile(latencies, 0.95)}ms`);
  console.log(`tokens: ${tokens.toLocaleString("en")} input ≈ $${(tokens * USD_PER_TOKEN).toFixed(4)}`);
  console.log(`\nmatched/new agreement with LLM baseline (P(same) policy): ${agree}/${judged} = ${pct(agree, judged)}`);
  console.log(`matched/new agreement (choice question alone):         ${choiceAgree}/${judged} = ${pct(choiceAgree, judged)}`);
  console.log(`same point when both merged: ${samePoint}/${bothMatched} = ${pct(samePoint, bothMatched)}`);
  console.log(`bands: merge ${bands.merge} · review ${bands.review} (LLM said matched ${reviewByStored.matched}, new ${reviewByStored.new}) · new ${bands.new}`);

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/jev-match-${consultation}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        consultation,
        k,
        items: items.length,
        judged,
        shortlistRecall: { inShortlist, of: storedMatches.length },
        agreement: { score: agree, choice: choiceAgree, of: judged },
        samePoint: { same: samePoint, of: bothMatched },
        bands,
        reviewByStored,
        latencyMs: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) },
        tokens,
        disagreements,
        all,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport → ${outFile} (${disagreements.length} disagreements for review)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
