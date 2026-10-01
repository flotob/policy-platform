/**
 * Phase 1 of the two-phase decomposition (exp/jev): EXTRACTION.
 *
 * The old decomposition was sequential because matching needed every earlier
 * point; with Jev matching that coupling is gone. Here every text window of
 * every submission is an independent LLM call — all windows run in parallel
 * (longest first, so the pool drains evenly) and their raw output lands in
 * `extractions`, keyed by the exact call. Canonicalization (canonicalize.ts)
 * then consumes them in a fixed order. A rerun with unchanged prompt, schema,
 * window and model costs nothing.
 */

import { createHash } from "node:crypto";

import { sql, type Db } from "@policy/db";
import type { LlmProvider } from "@policy/llm";

import { runPool } from "./pool.ts";
import { extractPrompt, extractSystem } from "./prompts.ts";
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

/**
 * Windows at paragraph boundaries as exact character ranges of the text
 * (unlike chunkText, which re-joins paragraphs) — quote candidates and spans
 * refer to the original text. An oversized paragraph is split at whitespace.
 */
export function windowSpans(text: string, maxChars = 20_000): { start: number; end: number }[] {
  if (text.length <= maxChars) return [{ start: 0, end: text.length }];
  const paras: { start: number; end: number }[] = [];
  const re = /\n{2,}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    paras.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  paras.push({ start: last, end: text.length });

  const out: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  for (let p of paras) {
    while (p.end - p.start > maxChars) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      let cut = p.start + maxChars;
      const ws = text.lastIndexOf(" ", cut);
      if (ws > p.start + maxChars / 2) cut = ws;
      out.push({ start: p.start, end: cut });
      p = { start: cut, end: p.end };
    }
    if (cur && p.end - cur.start > maxChars) {
      out.push(cur);
      cur = { ...p };
    } else {
      cur = cur ? { start: cur.start, end: p.end } : { ...p };
    }
  }
  if (cur) out.push(cur);
  return out.filter((w) => text.slice(w.start, w.end).trim().length >= 50);
}

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
): PlannedWindow[] {
  const spans = windowSpans(sub.text, cfg.window);
  const system = extractSystem(cfg.quotes === "llm");
  const schema = cfg.quotes === "llm" ? extractionWithQuoteJsonSchema : extractionJsonSchema;
  return spans.map((w, index) => {
    const prompt = extractPrompt(sub.text.slice(w.start, w.end), { index, count: spans.length });
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

export async function cachedWindows(db: Db, windows: PlannedWindow[]): Promise<Set<string>> {
  if (windows.length === 0) return new Set();
  const res = await db.execute(sql`
    SELECT call_hash FROM extractions
    WHERE call_hash IN (${sql.join(windows.map((w) => sql`${w.hash}`), sql`, `)})
  `);
  return new Set((res.rows as { call_hash: string }[]).map((r) => r.call_hash));
}

export interface ExtractStats {
  windows: number;
  cached: number;
  ok: number;
  failed: number;
  candidates: number;
  wallMs: number;
  callMs: number[];
}

/** Run every not-yet-cached window through the LLM, `concurrency` at a time. */
export async function extractWindows(
  db: Db,
  provider: LlmProvider,
  windows: PlannedWindow[],
  cfg: ExtractConfig,
  concurrency: number,
  log: (line: string) => void = console.log,
): Promise<ExtractStats> {
  const started = Date.now();
  const cached = await cachedWindows(db, windows);
  const pending = windows
    .filter((w) => !cached.has(w.hash))
    .sort((a, b) => b.end - b.start - (a.end - a.start));
  const stats: ExtractStats = {
    windows: windows.length,
    cached: windows.length - pending.length,
    ok: 0,
    failed: 0,
    candidates: 0,
    wallMs: 0,
    callMs: [],
  };
  log(`extraction: ${windows.length} windows, ${stats.cached} cached, ${pending.length} to call (${concurrency} in parallel)`);
  const parse = cfg.quotes === "llm" ? extractionOutputWithQuote : extractionOutput;
  const result = await runPool(
    pending,
    async (w) => {
      const res = await provider.generateStructured({
        system: w.system,
        prompt: w.prompt,
        schema: w.schema,
        model: cfg.model,
      });
      const parsed = parse.parse(res.output) as { points: ExtractedPoint[] };
      await db.execute(sql`
        INSERT INTO extractions (tenant_id, consultation_id, submission_id, window_index, window_count,
                                 window_start, window_end, call_hash, model, output, provenance)
        VALUES (${w.tenantId}, ${w.consultationId}, ${w.submissionId}, ${w.index}, ${w.count},
                ${w.start}, ${w.end}, ${w.hash}, ${cfg.model}, ${JSON.stringify(parsed)},
                ${JSON.stringify(res.provenance)})
        ON CONFLICT (submission_id, window_index, call_hash) DO NOTHING
      `);
      stats.candidates += parsed.points.length;
      stats.callMs.push(res.provenance.durationMs);
      log(
        `  window ${w.index + 1}/${w.count} of ${w.submissionId.slice(0, 8)} ` +
          `(${w.end - w.start} chars): ${parsed.points.length} points in ${(res.provenance.durationMs / 1000).toFixed(0)}s`,
      );
    },
    concurrency,
  );
  stats.ok = result.ok;
  stats.failed = result.failed;
  stats.wallMs = Date.now() - started;
  return stats;
}
