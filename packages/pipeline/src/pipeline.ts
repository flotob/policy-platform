/**
 * The decomposition pipeline: submission → candidate points → match
 * ("known point or new?") → draft points + provenance + match decisions.
 *
 * Everything lands as DRAFT for editorial review — the machine proposes,
 * humans release (trust architecture). Every LLM judgment is recorded as a
 * first-class match_decisions row with full call provenance.
 */

import {
  and,
  eq,
  inArray,
  matchDecisions,
  ne,
  points,
  pointSources,
  submissions,
  auditLog,
  type Db,
} from "@policy/db";
import type { LlmProvider } from "@policy/llm";

import {
  DECOMPOSE_SYSTEM,
  decomposePrompt,
  MATCH_SYSTEM,
  matchPrompt,
} from "./prompts.ts";
import {
  decompositionOutput,
  decompositionJsonSchema,
  matchOutput,
  matchJsonSchema,
  type CandidatePoint,
} from "./schemas.ts";

export interface PipelineRunResult {
  submissionId: string;
  candidates: number;
  created: number;
  matched: number;
  truncated: boolean;
}

export async function runForSubmission(
  db: Db,
  provider: LlmProvider,
  submissionId: string,
  model?: string,
): Promise<PipelineRunResult> {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  if (!submission) throw new Error(`submission ${submissionId} not found`);
  if (!submission.text) throw new Error(`submission ${submissionId} has no text`);

  const { prompt, truncated } = decomposePrompt(submission.text);
  const decomposition = await provider.generateStructured({
    system: DECOMPOSE_SYSTEM,
    prompt,
    schema: decompositionJsonSchema,
    model,
  });
  const parsed = decompositionOutput.parse(decomposition.output);
  const method = `${decomposition.provenance.provider}:${decomposition.provenance.model}`;

  let created = 0;
  let matchedCount = 0;

  // Snapshot BEFORE the loop: candidates from the same submission never match
  // against each other — the decomposition prompt already dedupes within a
  // document, and intra-document matching would risk false merges.
  const existing = await db
    .select({
      id: points.id,
      label: points.label,
      summary: points.summary,
    })
    .from(points)
    .where(
      and(
        eq(points.consultationId, submission.consultationId),
        inArray(points.status, ["draft", "released"]),
        // Questionnaire pseudo-points are question texts, not claims — a
        // free-text argument must never be folded into one.
        ne(points.createdBy, "import:questionnaire"),
      ),
    )
    .orderBy(points.createdAt);

  for (const candidate of parsed.points) {

    let outcome: "matched" | "new" = "new";
    let matchedPointId: string | null = null;
    let confidence: number | null = null;
    let matchProvenance: unknown = null;

    if (existing.length > 0) {
      const match = await provider.generateStructured({
        system: MATCH_SYSTEM,
        prompt: matchPrompt(candidate, existing),
        schema: matchJsonSchema,
        model,
      });
      const decision = matchOutput.parse(match.output);
      matchProvenance = match.provenance;
      confidence = decision.confidence;
      if (
        decision.decision === "matched" &&
        decision.matched_index !== null &&
        decision.matched_index < existing.length
      ) {
        outcome = "matched";
        matchedPointId = existing[decision.matched_index]!.id;
      }
    }

    let pointId: string;
    if (outcome === "matched" && matchedPointId) {
      pointId = matchedPointId;
      matchedCount++;
    } else {
      const [inserted] = await db
        .insert(points)
        .values({
          tenantId: submission.tenantId,
          consultationId: submission.consultationId,
          kind: candidate.kind,
          slot: candidate.slot,
          label: candidate.label,
          summary: candidate.summary,
          status: "draft",
          createdBy: method,
        })
        .returning({ id: points.id });
      pointId = inserted!.id;
      created++;
    }

    const spanStart = submission.text.indexOf(candidate.quote);
    await db.insert(pointSources).values({
      tenantId: submission.tenantId,
      pointId,
      submissionId: submission.id,
      quote: candidate.quote,
      spanStart: spanStart >= 0 ? spanStart : null,
      spanEnd: spanStart >= 0 ? spanStart + candidate.quote.length : null,
    });

    await db.insert(matchDecisions).values({
      tenantId: submission.tenantId,
      consultationId: submission.consultationId,
      submissionId: submission.id,
      candidateLabel: candidate.label,
      candidateSummary: candidate.summary,
      outcome,
      matchedPoint: outcome === "matched" ? matchedPointId : null,
      confidence,
      method: existing.length > 0 ? method : "auto:first-points",
      provenance: {
        decomposition: decomposition.provenance,
        match: matchProvenance,
        truncated,
      },
    });
  }

  await db.insert(auditLog).values({
    tenantId: submission.tenantId,
    actor: method,
    action: "submission.decompose",
    subjectKind: "submission",
    subjectId: submission.id,
    payload: { candidates: parsed.points.length, created, matched: matchedCount, truncated },
  });

  return {
    submissionId,
    candidates: parsed.points.length,
    created,
    matched: matchedCount,
    truncated,
  };
}

export type { CandidatePoint };
