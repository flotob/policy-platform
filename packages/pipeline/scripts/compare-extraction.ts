/**
 * Compare a new extraction (cached in `extractions`) with the OLD run's
 * candidates of the same submissions (match_decisions) — before anything is
 * canonicalized. Jev matches in both directions within each submission:
 *   old found in new  — what the new extraction still covers
 *   new found in old  — what it adds (unmatched = new points, or noise)
 * The old run is a reference, not truth: the unmatched lists are written to
 * .eval/ for reading by hand. Also reports quote stats for the variant.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/compare-extraction.ts \
 *     --consultation <ref> --submissions <id|source_ref>,... [--quotes jev|llm] [--window 20000]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import { planWindows, windowPlan, type ExtractConfig, type QuoteMode } from "../src/extract.ts";
import { jevMatch, MERGE_AT, shortlist } from "../src/jev-match.ts";
import { resolveConsultation } from "../src/jev-stage.ts";
import { runPool } from "../src/pool.ts";
import { locateQuote } from "../src/quote-span.ts";
import type { ExtractedPoint } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

type Item = { id: string; label: string; summary: string | null };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  const only = arg("submissions")?.split(",").map((s) => s.trim());
  if (!ref || !only) throw new Error("--consultation and --submissions required");
  const quotes = (arg("quotes") ?? "llm") as QuoteMode;
  const cfg: ExtractConfig = {
    model: arg("model") ?? process.env.LLM_MODEL ?? "claude-sonnet-5-5",
    window: Number(arg("window") ?? 15_000),
    quotes,
  };
  const db = createDb(url);
  const judge = new JevJudge();
  const cons = await resolveConsultation(db, ref);
  const subs = (
    await db.execute(sql`
      SELECT id, source_ref, author_org, text FROM submissions
      WHERE consultation_id = ${cons.id}
        AND (id::text IN (${sql.join(only.map((o) => sql`${o}`), sql`, `)})
          OR source_ref IN (${sql.join(only.map((o) => sql`${o}`), sql`, `)}))`)
  ).rows as { id: string; source_ref: string; author_org: string; text: string }[];

  const report: unknown[] = [];
  for (const s of subs) {
    const cuts = await windowPlan(db, judge, s, cfg.window);
    const windows = planWindows({ id: s.id, tenantId: cons.tenantId, consultationId: cons.id, text: s.text }, cfg, cuts);
    const fresh: (ExtractedPoint & { id: string })[] = [];
    for (const w of windows) {
      const r = await db.execute(sql`SELECT output, provenance FROM extractions WHERE submission_id = ${s.id} AND window_index = ${w.index} AND call_hash = ${w.hash}`);
      const row = r.rows[0] as { output: { points: ExtractedPoint[] } } | undefined;
      if (!row) throw new Error(`${s.author_org}: window ${w.index + 1} not extracted with this config`);
      row.output.points.forEach((p, i) => fresh.push({ ...p, id: `n${w.index}.${i}` }));
    }
    // Old candidates of this submission (deduped: some were decomposed twice).
    const oldRes = await db.execute(sql`
      SELECT DISTINCT ON (lower(candidate_label)) md5(candidate_label) AS id, candidate_label AS label, candidate_summary AS summary
      FROM match_decisions WHERE submission_id = ${s.id}`);
    const old = oldRes.rows as Item[];

    const coverage = async (from: Item[], into: Item[]) => {
      const found = new Map<string, { p: number; to: string | null }>();
      await runPool(
        from,
        async (it) => {
          const v = await jevMatch(judge, { consultationTitle: cons.title }, it, shortlist(it, into, 15));
          const to = v ? into.find((x) => x.id === v.matchedPointId)?.label ?? null : null;
          found.set(it.id, { p: v?.bestSameProbability ?? 0, to });
        },
        10,
      );
      return found;
    };
    const freshItems: Item[] = fresh.map((f) => ({ id: f.id, label: f.label, summary: f.summary }));
    const oldInNew = await coverage(old, freshItems);
    const newInOld = await coverage(freshItems, old);
    const oldFound = old.filter((o) => oldInNew.get(o.id)!.p >= MERGE_AT).length;
    const newFound = freshItems.filter((n) => newInOld.get(n.id)!.p >= MERGE_AT).length;

    let quoteNote = "";
    if (quotes === "llm") {
      const located = fresh.filter((f) => f.quote && locateQuote(s.text, f.quote)).length;
      quoteNote = ` · LLM quotes located ${located}/${fresh.length}`;
    }
    console.log(
      `${s.author_org.slice(0, 40).padEnd(40)} windows ${windows.length} · old ${old.length} → new ${fresh.length} · ` +
        `old covered by new ${oldFound}/${old.length} · new found in old ${newFound}/${fresh.length}${quoteNote}`,
    );
    report.push({
      submission: s.author_org,
      old: old.length,
      new: fresh.length,
      oldMissingInNew: old.filter((o) => oldInNew.get(o.id)!.p < MERGE_AT).map((o) => ({ label: o.label, summary: o.summary, pSame: Number(oldInNew.get(o.id)!.p.toFixed(2)), closest: oldInNew.get(o.id)!.to })),
      newNotInOld: freshItems.filter((n) => newInOld.get(n.id)!.p < MERGE_AT).map((n) => ({ label: n.label, summary: n.summary, pSame: Number(newInOld.get(n.id)!.p.toFixed(2)), closest: newInOld.get(n.id)!.to })),
      newPoints: fresh.map((f) => ({ label: f.label, summary: f.summary, quote: f.quote })),
    });
  }
  mkdirSync(resolve(".eval"), { recursive: true });
  const out = resolve(".eval", `compare-extraction-${ref}-${quotes}-w${cfg.window}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`report → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
