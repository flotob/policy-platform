/**
 * Two-phase decomposition (exp/jev) — replaces decompose.ts + the point
 * passes of jev-review / jev-classify (role, doors) / jev-grammar.
 *
 *   extract       LLM, all windows in parallel, cached in `extractions`
 *   canonicalize  Jev, windows in fixed order: known or new? + intake
 *                 judgment (release, role, door, fact/value, slot) + quote
 *   all           both (default)
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/extract.ts --consultation <ref>
 *     [--phase extract|canonicalize|all] [--submissions <id|source_ref>,...]
 *     [--concurrency 5] [--window 20000] [--quotes jev|llm] [--model claude-sonnet-5-5]
 *
 * Order: submissions by text length (shortest first, as decompose.ts), then
 * window index. Every phase is resumable; reruns cost nothing for cached
 * windows and canonicalized windows.
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider, JevJudge } from "@policy/llm";

import { canonicalize } from "../src/canonicalize.ts";
import { extractWindows, planWindows, type ExtractConfig, type PlannedWindow, type QuoteMode } from "../src/extract.ts";
import { resolveConsultation, USD_PER_JEV_TOKEN } from "../src/jev-stage.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const phase = arg("phase") ?? "all";
  if (!["extract", "canonicalize", "all"].includes(phase)) throw new Error("--phase extract|canonicalize|all");
  const quotes = (arg("quotes") ?? "jev") as QuoteMode;
  if (quotes !== "jev" && quotes !== "llm") throw new Error("--quotes jev|llm");
  const cfg: ExtractConfig = {
    model: arg("model") ?? process.env.LLM_MODEL ?? "claude-sonnet-5-5",
    window: Number(arg("window") ?? 20_000),
    quotes,
  };
  const concurrency = Number(arg("concurrency") ?? 5);
  const only = arg("submissions")?.split(",").map((s) => s.trim()).filter(Boolean);

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const subRes = await db.execute(sql`
    SELECT id, source_ref, author_org, text FROM submissions
    WHERE consultation_id = ${cons.id} AND text IS NOT NULL
    ORDER BY length(text) ASC, id
  `);
  let subs = subRes.rows as { id: string; source_ref: string | null; author_org: string | null; text: string }[];
  if (only) {
    subs = subs.filter((s) => only.includes(s.id) || (s.source_ref !== null && only.includes(s.source_ref)));
    const missing = only.filter((o) => !subs.some((s) => s.id === o || s.source_ref === o));
    if (missing.length) throw new Error(`unknown submission(s): ${missing.join(", ")}`);
  }
  const windows: PlannedWindow[] = subs.flatMap((s) =>
    planWindows({ id: s.id, tenantId: cons.tenantId, consultationId: cons.id, text: s.text }, cfg),
  );
  console.log(
    `${cons.title}: ${subs.length} submissions, ${windows.length} windows ` +
      `(window ${cfg.window}, quotes ${cfg.quotes}, model ${cfg.model})`,
  );

  if (phase !== "canonicalize") {
    const s = await extractWindows(db, new AgentSdkProvider(), windows, cfg, concurrency);
    const sorted = [...s.callMs].sort((a, b) => a - b);
    console.log(
      `extraction done in ${(s.wallMs / 60000).toFixed(1)} min: ${s.ok} called, ${s.cached} cached, ${s.failed} failed · ` +
        `${s.candidates} candidates · call p50 ${Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) / 1000)}s, ` +
        `max ${Math.round((sorted.at(-1) ?? 0) / 1000)}s, sum ${(s.callMs.reduce((a, b) => a + b, 0) / 60000).toFixed(1)} min`,
    );
    if (s.failed > 0) {
      console.log("some windows failed — rerun to retry them (cached windows are skipped)");
      process.exit(1);
    }
  }

  if (phase !== "extract") {
    const s = await canonicalize(db, new JevJudge(), cons, windows, cfg.quotes);
    console.log(
      `canonicalization done in ${(s.wallMs / 1000).toFixed(0)}s: ${s.candidates} candidates → ${s.created} new points ` +
        `(${s.released} released, ${s.review} for review, ${s.rejected} rejected), ${s.matched} matched, ` +
        `${s.possibleDuplicates} possible duplicates, ${s.noQuote} without quote · ${s.skipped} windows already done · ` +
        `Jev ${s.jevTokens.toLocaleString("en")} tokens ≈ $${(s.jevTokens * USD_PER_JEV_TOKEN).toFixed(3)}`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
