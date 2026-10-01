/**
 * Shared machinery for Jev pipeline stages (exp/jev).
 *
 * Every stage follows the same discipline:
 *  - one Jev request per item, small item-local state (accuracy drops with
 *    irrelevant state), independent questions answered in parallel;
 *  - raw typed answers persisted to `judgments` (probabilities included), the
 *    derived decision next to them — policy stays re-tunable in code;
 *  - canonical columns are FILLED when empty, never overwritten without an
 *    explicit --overwrite (existing LLM labels stay until a person approves).
 */

import { sql, type Db } from "@policy/db";
import type { EntryType, JevJudge, JudgeProvenance, Questions } from "@policy/llm";

import { runPool } from "./pool.ts";

export const USD_PER_JEV_TOKEN = 42 / 1e9;

export interface StageStats {
  ok: number;
  failed: number;
  tokens: number;
  latencies: number[];
  wallMs: number;
}

export async function judgeAll<I>(
  judge: JevJudge,
  items: I[],
  build: (item: I) => { state: EntryType; questions: Questions } | null,
  onResult: (item: I, answers: Record<string, unknown>, provenance: JudgeProvenance) => Promise<void>,
  concurrency = 8,
): Promise<StageStats> {
  const stats: StageStats = { ok: 0, failed: 0, tokens: 0, latencies: [], wallMs: 0 };
  const started = Date.now();
  let done = 0;
  const result = await runPool(
    items,
    async (item) => {
      const req = build(item);
      if (!req) return;
      const { answers, provenance } = await judge.judge(req.state, req.questions);
      stats.tokens += provenance.inputTokens;
      stats.latencies.push(provenance.durationMs);
      await onResult(item, answers as Record<string, unknown>, provenance);
      if (++done % 50 === 0) process.stdout.write(".");
    },
    concurrency,
  );
  stats.ok = result.ok;
  stats.failed = result.failed;
  stats.wallMs = Date.now() - started;
  return stats;
}

export function statsLine(s: StageStats): string {
  const sorted = [...s.latencies].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return (
    `${s.ok} judged, ${s.failed} failed in ${(s.wallMs / 1000).toFixed(1)}s · ` +
    `p50 ${q(0.5)}ms p95 ${q(0.95)}ms · ${s.tokens.toLocaleString("en")} tokens ≈ $${(s.tokens * USD_PER_JEV_TOKEN).toFixed(4)}`
  );
}

export async function saveJudgment(
  db: Db,
  j: {
    tenantId: string;
    consultationId: string;
    subjectKind: string;
    subjectId: string;
    family: string;
    provenance: JudgeProvenance;
    answers: unknown;
    decided: unknown;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO judgments (tenant_id, consultation_id, subject_kind, subject_id, family,
                           model, request_id, answers, decided)
    VALUES (${j.tenantId}, ${j.consultationId}, ${j.subjectKind}, ${j.subjectId}, ${j.family},
            ${j.provenance.model}, ${j.provenance.requestId ?? null},
            ${JSON.stringify(j.answers)}, ${JSON.stringify(j.decided)})
    ON CONFLICT (subject_kind, subject_id, family) DO UPDATE SET
      model = excluded.model, request_id = excluded.request_id,
      answers = excluded.answers, decided = excluded.decided, created_at = now()
  `);
}

/**
 * Audit entries older than the consultation's last reset (reset-consultation
 * .ts) belong to a discarded run — resume markers must compare against this.
 */
export function sinceReset(consultationId: string) {
  return sql`COALESCE((SELECT max(r.created_at) FROM audit_log r
    WHERE r.action = 'consultation.reset' AND r.subject_id = ${consultationId}::text), '-infinity'::timestamptz)`;
}

export async function resolveConsultation(
  db: Db,
  ref: string,
): Promise<{ id: string; tenantId: string; title: string }> {
  const res = await db.execute(sql`
    SELECT id, tenant_id, title FROM consultations
    WHERE id::text = ${ref} OR source_ref = ${ref}
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = res.rows[0] as { id: string; tenant_id: string; title: string } | undefined;
  if (!row) throw new Error(`consultation ${ref} not found`);
  return { id: row.id, tenantId: row.tenant_id, title: row.title };
}

/** Agreement table between an existing label and the Jev label. */
export function agreementReport(
  pairs: { existing: string | null; jev: string }[],
  name: string,
): string {
  const compared = pairs.filter((p) => p.existing !== null);
  const agree = compared.filter((p) => p.existing === p.jev).length;
  const confusion = new Map<string, number>();
  for (const p of compared) {
    if (p.existing === p.jev) continue;
    const k = `${p.existing} → ${p.jev}`;
    confusion.set(k, (confusion.get(k) ?? 0) + 1);
  }
  const top = [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    `${name}: agreement ${agree}/${compared.length} = ` +
    `${compared.length ? ((agree / compared.length) * 100).toFixed(1) : "n/a"}%` +
    (top.length ? `\n  top disagreements (existing → jev): ${top.map(([k, v]) => `${k} ×${v}`).join(" · ")}` : "")
  );
}
