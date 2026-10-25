import { sql } from "@policy/db";
import { JevJudge, type LlmProvider } from "@policy/llm";
import type { KernCampaign, KernDeps, MatchNode } from "@policy/pipeline/kern";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { QUESTIONS, STEPS } from "./params";

/** The campaign as the core loop sees it: measure, the four steps, the question→step mapping, the thresholds. */
export function kernCampaign(c: Campaign, town: string): KernCampaign {
  return {
    id: c.id,
    tenantId: c.tenantId,
    consultationId: c.consultationId,
    context: {
      town,
      question: c.question,
      measure: c.measure,
      justification: c.justification,
      steps: STEPS.map((s) => ({ key: s.key, label: s.label, these: c.steps[s.key] ?? "" })),
      questions: QUESTIONS.map((q) => ({ key: q.key, label: q.label, steps: q.steps })),
    },
    params: { matchThreshold: c.params.matchThreshold, sampleRate: c.params.sampleRate, editorialMode: c.params.editorialMode },
  };
}

let llm: LlmProvider | undefined;
let judge: JevJudge | undefined;

/** Models are created on first use: the Agent SDK spawns the Claude CLI, Jev needs TYPESAFE_API_KEY. */
export async function kernDeps(log: (m: string) => void): Promise<KernDeps> {
  if (!llm) {
    const { AgentSdkProvider } = await import("@policy/llm");
    llm = new AgentSdkProvider();
  }
  judge ??= new JevJudge();
  return { db: getDb(), llm, judge, log };
}

export type JobKind = "skelett" | "zerlegen" | "kurzaussage" | "lagernamen" | "bericht";

export async function enqueue(
  tenantId: string,
  campaignId: string,
  kind: JobKind,
  fileId: string | null = null,
  submissionId: string | null = null,
  target: { resultId?: string; reportId?: string } = {},
) {
  const resultId = target.resultId ?? null;
  const reportId = target.reportId ?? null;
  // One open job per task: a second click does not queue the same work twice.
  await getDb().execute(sql`
    INSERT INTO campaign_jobs (tenant_id, campaign_id, kind, file_id, submission_id, result_id, report_id)
    SELECT ${tenantId}, ${campaignId}, ${kind}, ${fileId}, ${submissionId}, ${resultId}, ${reportId}
    WHERE NOT EXISTS (
      SELECT 1 FROM campaign_jobs WHERE campaign_id = ${campaignId} AND kind = ${kind}
        AND file_id IS NOT DISTINCT FROM ${fileId}::uuid AND submission_id IS NOT DISTINCT FROM ${submissionId}::uuid
        AND result_id IS NOT DISTINCT FROM ${resultId}::uuid AND report_id IS NOT DISTINCT FROM ${reportId}::uuid
        AND state IN ('wartet', 'laeuft'))`);
}

/** The points under vote, as the door-2 check compares against them. */
export async function releasedNodes(consultationId: string): Promise<MatchNode[]> {
  const r = await getDb().execute(sql`
    SELECT id, text, einwand, schritt FROM map_points WHERE consultation_id = ${consultationId} AND rolle IS NOT NULL AND status = 'released'`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    text: x.text as string,
    einwand: (x.einwand as string | null) ?? null,
    schritt: (x.schritt as string | null) ?? null,
  }));
}
