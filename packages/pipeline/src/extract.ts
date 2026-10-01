/**
 * Phase 1 of the two-phase decomposition (exp/jev): EXTRACTION + REFINE.
 *
 * The old decomposition was sequential because matching needed every earlier
 * point; with Jev matching that coupling is gone. Here every text window of
 * every submission is an independent LLM call — all windows run in parallel
 * (longest first, so the pool drains evenly) and their raw output lands in
 * `extractions`, keyed by the exact call. Each window is refined right after
 * its extraction (refine.ts: Jev intake + automatic LLM repair).
 * Canonicalization (canonicalize.ts) then consumes refined windows in a fixed
 * order. A rerun with unchanged prompt, schema, window and model costs nothing.
 *
 * Windows: long submissions are cut where Jev judges that a new topic starts
 * (not at a fixed character count), and every window's LLM call sees the
 * WHOLE submission with its own section marked — nothing is read out of
 * context. Cut points are stored in `window_plans` so the windows (and the
 * cache keys) stay stable across runs.
 */

import { createHash } from "node:crypto";

import { sql, type Db } from "@policy/db";
import { noul, type JevJudge, type LlmProvider } from "@policy/llm";

import { runPool, Semaphore } from "./pool.ts";
import { extractPrompt, extractSystem } from "./prompts.ts";
import { refineWindow, type RefineStats } from "./refine.ts";
import {
  extractionJsonSchema,
  extractionOutput,
  extractionOutputWithQuote,
  extractionWithQuoteJsonSchema,
  type ExtractedPoint,
} from "./schemas.ts";

export type QuoteMode = "llm" | "jev";

export interface ExtractConfig {
  model: string;
  /** Max characters per window. */
  window: number;
  /** "llm": the LLM writes a verbatim quote; "jev": Jev picks a sentence of the window. */
  quotes: QuoteMode;
}

// ——— Where to cut ——————————————————————————————————————————————————————————

/** A cut is only considered in the last part of a window (from this fraction of max). */
export const CUT_FROM = 0.55;
/** A remainder up to this multiple of max stays one window (no tiny trailing window). */
export const TAIL_SLACK = 1.25;
/** Candidate breaks offered to Jev per cut. */
export const CUT_CANDIDATES = 12;
const CUT_CONTEXT = 450;

/**
 * Candidate break positions (start of the next line): after a sentence-final
 * line ending, at blank lines, and before heading-like lines (§, Artikel,
 * numbered headings) — PDF text rarely has real paragraph breaks.
 */
export function breakCandidates(text: string): number[] {
  const out: number[] = [];
  const re = /\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const next = m.index + 1;
    if (next >= text.length) break;
    const before = text.slice(Math.max(0, m.index - 3), m.index).trimEnd();
    const lineAfter = text.slice(next, next + 40);
    const blank = /^\s*\n/.test(lineAfter);
    const sentenceEnd = /[.!?:;)"“”]$/.test(before);
    const heading = /^\s*(§|Artikel\b|Art\.|zu\s+§|\d{1,2}(\.\d{1,2})*\.?\s+[A-ZÄÖÜ]|[IVX]{1,4}\.\s+[A-ZÄÖÜ]|[A-H]\.\s+[A-ZÄÖÜ])/.test(lineAfter);
    if (blank || sentenceEnd || heading) out.push(next);
  }
  return out;
}

const CUT_QUESTION = (key: string) =>
  noul(
    `Does a new topic, section, or argument begin with \`cuts.${key}.after\`, rather than \`cuts.${key}.after\` continuing the argument of \`cuts.${key}.before\`?`,
    {
      true: "The text after the break turns to another provision, topic, or argument — a reader could start reading there.",
      false: "The text after the break continues the sentence, list, example, or line of reasoning before it.",
    },
  );

/** Window ends (exclusive offsets) for one text; one Jev request per cut. */
export async function planCuts(
  judge: JevJudge,
  text: string,
  maxChars: number,
): Promise<{ cuts: number[]; answers: unknown[] }> {
  if (text.length <= maxChars * TAIL_SLACK) return { cuts: [text.length], answers: [] };
  const breaks = breakCandidates(text);
  const cuts: number[] = [];
  const answers: unknown[] = [];
  let start = 0;
  while (text.length - start > maxChars * TAIL_SLACK) {
    const lo = start + Math.floor(maxChars * CUT_FROM);
    const hi = start + maxChars;
    let inRange = breaks.filter((b) => b > lo && b <= hi);
    if (inRange.length > CUT_CANDIDATES) {
      // Evenly spread, always including the latest break.
      const step = inRange.length / CUT_CANDIDATES;
      inRange = Array.from({ length: CUT_CANDIDATES }, (_, i) => inRange[Math.floor(inRange.length - 1 - i * step)]!).reverse();
    }
    let cut: number;
    if (inRange.length === 0) {
      const ws = text.lastIndexOf(" ", hi);
      cut = ws > lo ? ws + 1 : hi;
      answers.push({ fallback: "whitespace", cut });
    } else {
      const state: Record<string, { before: string; after: string }> = {};
      const questions: Record<string, ReturnType<typeof noul>> = {};
      inRange.forEach((b, i) => {
        const key = `c${i + 1}`;
        state[key] = { before: text.slice(Math.max(0, b - CUT_CONTEXT), b), after: text.slice(b, b + CUT_CONTEXT) };
        questions[key] = CUT_QUESTION(key);
      });
      const { answers: a } = await judge.judge({ cuts: state }, questions);
      let best = inRange.length - 1;
      let bestP = -1;
      inRange.forEach((_, i) => {
        const p = (a as Record<string, { noul: number }>)[`c${i + 1}`]!.noul;
        // Ties go to the later break (bigger window).
        if (p >= bestP) {
          bestP = p;
          best = i;
        }
      });
      cut = inRange[best]!;
      answers.push({ candidates: inRange, p: inRange.map((_, i) => (a as Record<string, { noul: number }>)[`c${i + 1}`]!.noul), cut });
    }
    cuts.push(cut);
    start = cut;
  }
  cuts.push(text.length);
  return { cuts, answers };
}

/** Stored cut points for a submission, computed with Jev on first use. */
export async function windowPlan(
  db: Db,
  judge: JevJudge,
  sub: { id: string; text: string },
  maxChars: number,
): Promise<number[]> {
  const r = await db.execute(sql`SELECT cuts FROM window_plans WHERE submission_id = ${sub.id} AND max_chars = ${maxChars}`);
  const row = r.rows[0] as { cuts: number[] } | undefined;
  if (row) return row.cuts;
  const plan = await planCuts(judge, sub.text, maxChars);
  await db.execute(sql`
    INSERT INTO window_plans (submission_id, max_chars, cuts, answers)
    VALUES (${sub.id}, ${maxChars}, ${sql.raw(`ARRAY[${plan.cuts.join(",")}]::integer[]`)}, ${JSON.stringify(plan.answers)})
    ON CONFLICT (submission_id, max_chars) DO NOTHING
  `);
  return plan.cuts;
}

// ——— Windows and their LLM calls ——————————————————————————————————————————

export interface PlannedWindow {
  submissionId: string;
  tenantId: string;
  consultationId: string;
  index: number;
  count: number;
  start: number;
  end: number;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  hash: string;
}

export function planWindows(
  sub: { id: string; tenantId: string; consultationId: string; text: string },
  cfg: ExtractConfig,
  cuts: number[],
): PlannedWindow[] {
  const system = extractSystem(cfg.quotes === "llm");
  const schema = cfg.quotes === "llm" ? extractionWithQuoteJsonSchema : extractionJsonSchema;
  const spans = cuts.map((end, i) => ({ start: i === 0 ? 0 : cuts[i - 1]!, end }));
  return spans.map((w, index) => {
    const prompt = extractPrompt(sub.text, { index, count: spans.length, start: w.start, end: w.end });
    const hash = createHash("sha256")
      .update(JSON.stringify({ system, prompt, schema, model: cfg.model }))
      .digest("hex");
    return {
      submissionId: sub.id,
      tenantId: sub.tenantId,
      consultationId: sub.consultationId,
      index,
      count: spans.length,
      start: w.start,
      end: w.end,
      system,
      prompt,
      schema,
      hash,
    };
  });
}

export interface ExtractStats {
  windows: number;
  cached: number;
  extracted: number;
  refinedOnly: number;
  failed: number;
  candidates: number;
  wallMs: number;
  callMs: number[];
  refine: RefineStats;
}

/**
 * Extract every not-yet-cached window (LLM, `concurrency` at a time) and
 * refine every not-yet-refined window (Jev + LLM editor, editor calls capped
 * by `editorConcurrency`). Cached and refined windows are skipped.
 */
export async function extractWindows(
  db: Db,
  provider: LlmProvider,
  judge: JevJudge,
  consultationTitle: string,
  texts: Map<string, string>,
  windows: PlannedWindow[],
  cfg: ExtractConfig,
  concurrency: number,
  editorConcurrency: number,
  log: (line: string) => void = console.log,
): Promise<ExtractStats> {
  const started = Date.now();
  const res = windows.length
    ? await db.execute(sql`
        SELECT call_hash, refined IS NOT NULL AS refined FROM extractions
        WHERE call_hash IN (${sql.join(windows.map((w) => sql`${w.hash}`), sql`, `)})`)
    : { rows: [] };
  const state = new Map((res.rows as { call_hash: string; refined: boolean }[]).map((r) => [r.call_hash, r.refined]));
  const todo = windows
    .filter((w) => state.get(w.hash) !== true)
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  const stats: ExtractStats = {
    windows: windows.length,
    cached: windows.filter((w) => state.has(w.hash)).length,
    extracted: 0,
    refinedOnly: 0,
    failed: 0,
    candidates: 0,
    wallMs: 0,
    callMs: [],
    refine: { candidates: 0, flagged: 0, kept: 0, rewritten: 0, split: 0, dropped: 0, rejected: 0, out: 0, residualFlags: 0 },
  };
  log(
    `extraction: ${windows.length} windows · ${stats.cached} cached · ${todo.filter((w) => !state.has(w.hash)).length} to extract, ` +
      `${todo.length} to refine (${concurrency} extraction calls, ${editorConcurrency} editor calls in parallel)`,
  );
  const parse = cfg.quotes === "llm" ? extractionOutputWithQuote : extractionOutput;
  const editorGate = new Semaphore(editorConcurrency);
  const result = await runPool(
    todo,
    async (w) => {
      let points: ExtractedPoint[];
      let callMs = 0;
      if (!state.has(w.hash)) {
        const r = await provider.generateStructured({ system: w.system, prompt: w.prompt, schema: w.schema, model: cfg.model });
        points = (parse.parse(r.output) as { points: ExtractedPoint[] }).points;
        callMs = r.provenance.durationMs;
        await db.execute(sql`
          INSERT INTO extractions (tenant_id, consultation_id, submission_id, window_index, window_count,
                                   window_start, window_end, call_hash, model, output, provenance)
          VALUES (${w.tenantId}, ${w.consultationId}, ${w.submissionId}, ${w.index}, ${w.count},
                  ${w.start}, ${w.end}, ${w.hash}, ${cfg.model}, ${JSON.stringify({ points })},
                  ${JSON.stringify(r.provenance)})
          ON CONFLICT (submission_id, window_index, call_hash) DO NOTHING
        `);
        stats.extracted++;
        stats.callMs.push(callMs);
      } else {
        const r = await db.execute(sql`SELECT output FROM extractions WHERE submission_id = ${w.submissionId} AND window_index = ${w.index} AND call_hash = ${w.hash}`);
        points = (r.rows[0] as { output: { points: ExtractedPoint[] } }).output.points;
        stats.refinedOnly++;
      }
      stats.candidates += points.length;
      const t0 = Date.now();
      const { refined, stats: rs } = await refineWindow(
        judge,
        provider,
        editorGate,
        consultationTitle,
        texts.get(w.submissionId)!,
        { start: w.start, end: w.end },
        points,
        cfg.model,
      );
      await db.execute(sql`
        UPDATE extractions SET refined = ${JSON.stringify({ policy: "refine.v1", candidates: refined, stats: rs })}, refined_at = now()
        WHERE submission_id = ${w.submissionId} AND window_index = ${w.index} AND call_hash = ${w.hash}
      `);
      for (const k of Object.keys(stats.refine) as (keyof RefineStats)[]) stats.refine[k] += rs[k];
      log(
        `  window ${w.index + 1}/${w.count} of ${w.submissionId.slice(0, 8)} (${w.end - w.start} chars): ` +
          `${points.length} points${callMs ? ` in ${(callMs / 1000).toFixed(0)}s` : " (cached)"} → refined ${rs.out} ` +
          `(${rs.flagged} flagged: ${rs.split} split, ${rs.rewritten} rewritten, ${rs.kept} kept, ${rs.dropped} dropped; ` +
          `${rs.rejected} rejected) in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    },
    concurrency,
  );
  stats.failed = result.failed;
  stats.wallMs = Date.now() - started;
  return stats;
}
