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
  pointEdges,
  points,
  pointSources,
  sql,
  submissions,
  auditLog,
  type Db,
} from "@policy/db";
import type { LlmProvider } from "@policy/llm";

import {
  BATCH_MATCH_SYSTEM,
  batchMatchPrompt,
  DECOMPOSE_SYSTEM,
  decomposePrompt,
  MATCH_SYSTEM,
  matchPrompt,
} from "./prompts.ts";
import {
  batchMatchOutput,
  batchMatchJsonSchema,
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
  /** Number of text windows the submission was processed in (1 = no split). */
  chunks: number;
  /** @deprecated always false since chunking; kept for caller compatibility. */
  truncated: boolean;
}

/**
 * Split a long text into windows at paragraph boundaries. Every window is
 * fully processed — nothing is dropped or summarized; cross-window
 * duplicates are folded by the matcher like any cross-submission repeat.
 */
export function chunkText(text: string, maxChars = 20_000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    let piece = para;
    // A single paragraph longer than the window is hard-split as a last resort.
    while (piece.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(piece.slice(0, maxChars));
      piece = piece.slice(maxChars);
    }
    if (current && current.length + piece.length + 2 > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface MatchVerdict {
  outcome: "matched" | "new";
  matchedPointId: string | null;
  confidence: number;
}

export interface RunOptions {
  /**
   * Throughput plan O1: one match call per decomposition chunk instead of
   * one per candidate. Candidates a batch verdict misses (or answers with an
   * invalid index) fall back to the per-candidate call.
   */
  batchMatch?: boolean;
}

export async function runForSubmission(
  db: Db,
  provider: LlmProvider,
  submissionId: string,
  model?: string,
  options: RunOptions = {},
): Promise<PipelineRunResult> {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  if (!submission) throw new Error(`submission ${submissionId} not found`);
  if (!submission.text) throw new Error(`submission ${submissionId} has no text`);

  const chunks = chunkText(submission.text);
  let method = "";
  let totalCandidates = 0;
  let created = 0;
  let matchedCount = 0;
  let edgeCount = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const { prompt } = decomposePrompt(chunks[chunkIndex]!);
    const decomposition = await provider.generateStructured({
      system: DECOMPOSE_SYSTEM,
      prompt,
      schema: decompositionJsonSchema,
      model,
    });
    const parsed = decompositionOutput.parse(decomposition.output);
    method = `${decomposition.provenance.provider}:${decomposition.provenance.model}`;
    totalCandidates += parsed.points.length;
    const pointIdByCandidate: string[] = [];

    // Snapshot BEFORE the candidate loop: candidates from the same chunk never
    // match against each other — the decomposition prompt already dedupes
    // within a window, and sibling matching would risk false merges. Points
    // from EARLIER chunks are included, so cross-window repeats fold together.
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

    // O1 batch matching: one call for the whole chunk. Invalid or missing
    // verdicts drop out of the map and take the per-candidate fallback below.
    const batchVerdicts = new Map<number, MatchVerdict>();
    let batchProvenance: unknown = null;
    if (options.batchMatch && existing.length > 0 && parsed.points.length > 0) {
      try {
        const batch = await provider.generateStructured({
          system: BATCH_MATCH_SYSTEM,
          prompt: batchMatchPrompt(parsed.points, existing),
          schema: batchMatchJsonSchema,
          model,
        });
        const decisions = batchMatchOutput.parse(batch.output);
        batchProvenance = batch.provenance;
        for (const v of decisions.matches) {
          if (v.candidate_index >= parsed.points.length) continue;
          if (batchVerdicts.has(v.candidate_index)) continue;
          const valid =
            v.decision === "matched" &&
            v.matched_index !== null &&
            v.matched_index < existing.length;
          batchVerdicts.set(v.candidate_index, {
            outcome: valid ? "matched" : "new",
            matchedPointId: valid ? existing[v.matched_index!]!.id : null,
            confidence: v.confidence,
          });
        }
      } catch (err) {
        console.log(
          `  batch match failed (${err instanceof Error ? err.message : err}), ` +
            `falling back to per-candidate calls`,
        );
      }
    }

    for (let ci = 0; ci < parsed.points.length; ci++) {
      const candidate = parsed.points[ci]!;

    let outcome: "matched" | "new" = "new";
    let matchedPointId: string | null = null;
    let confidence: number | null = null;
    let matchProvenance: unknown = null;

    const batched = batchVerdicts.get(ci);
    if (batched) {
      outcome = batched.outcome;
      matchedPointId = batched.matchedPointId;
      confidence = batched.confidence;
      matchProvenance = { ...(batchProvenance as object), batch: true };
    } else if (existing.length > 0) {
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
          cq: candidate.cq ?? null,
          answersCq: candidate.answers_cq ?? null,
          status: "draft",
          createdBy: method,
        })
        .returning({ id: points.id });
      pointId = inserted!.id;
      created++;
    }

      pointIdByCandidate.push(pointId);

      // Reruns and cross-chunk matches must not duplicate a source row.
      const dupSource = await db.execute(sql`
        SELECT 1 FROM point_sources
        WHERE point_id = ${pointId} AND submission_id = ${submission.id}
          AND quote = ${candidate.quote} LIMIT 1
      `);
      if (dupSource.rows.length === 0) {
        const spanStart = submission.text.indexOf(candidate.quote);
        await db.insert(pointSources).values({
          tenantId: submission.tenantId,
          pointId,
          submissionId: submission.id,
          quote: candidate.quote,
          spanStart: spanStart >= 0 ? spanStart : null,
          spanEnd: spanStart >= 0 ? spanStart + candidate.quote.length : null,
        });
      }

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
          chunk: chunks.length > 1 ? { index: chunkIndex, of: chunks.length } : undefined,
          truncated: false,
        },
      });
    }

    // Argumentative relations between this chunk's candidates, mapped to
    // their (possibly matched) point ids. Idempotent via unique constraint.
    for (const rel of parsed.relations) {
      const fromId = pointIdByCandidate[rel.from];
      const toId = pointIdByCandidate[rel.to];
      if (!fromId || !toId || fromId === toId) continue;
      await db
        .insert(pointEdges)
        .values({
          tenantId: submission.tenantId,
          fromPoint: fromId,
          toPoint: toId,
          kind: rel.kind,
        })
        .onConflictDoNothing();
      edgeCount++;
    }
  }

  await db.insert(auditLog).values({
    tenantId: submission.tenantId,
    actor: method,
    action: "submission.decompose",
    subjectKind: "submission",
    subjectId: submission.id,
    payload: {
      candidates: totalCandidates,
      created,
      matched: matchedCount,
      edges: edgeCount,
      chunks: chunks.length,
    },
  });

  return {
    submissionId,
    candidates: totalCandidates,
    created,
    matched: matchedCount,
    chunks: chunks.length,
    truncated: false,
  };
}

export type { CandidatePoint };
