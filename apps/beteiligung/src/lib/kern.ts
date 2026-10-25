import { sql } from "@policy/db";
import { JevJudge, type LlmProvider } from "@policy/llm";
import type { KernCampaign, KernDeps } from "@policy/pipeline/kern";

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

export type JobKind = "skelett" | "zerlegen";

export async function enqueue(tenantId: string, campaignId: string, kind: JobKind, fileId: string | null = null) {
  // One open job per task: a second click does not queue the same work twice.
  await getDb().execute(sql`
    INSERT INTO campaign_jobs (tenant_id, campaign_id, kind, file_id)
    SELECT ${tenantId}, ${campaignId}, ${kind}, ${fileId}
    WHERE NOT EXISTS (
      SELECT 1 FROM campaign_jobs WHERE campaign_id = ${campaignId} AND kind = ${kind}
        AND file_id IS NOT DISTINCT FROM ${fileId}::uuid AND state IN ('wartet', 'laeuft'))`);
}
