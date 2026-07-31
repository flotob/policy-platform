/**
 * Structured-output contracts for the decomposition pipeline.
 * zod is the source; JSON Schema is derived for the LLM provider.
 */

import { z } from "zod";

export const candidatePoint = z
  .object({
    /** Short editorial label in the submission's language (≤ 80 chars). */
    label: z.string().min(3).max(120),
    /** One neutral sentence stating the claim. */
    summary: z.string().min(10).max(500),
    kind: z.enum(["fact", "value", "design", "gap"]),
    /** Slot in the practical-reasoning schema; null when not attributable. */
    slot: z.enum(["P1", "P2", "P3", "P4", "conclusion"]).nullable(),
    /** Verbatim supporting excerpt from the submission text. */
    quote: z.string().min(5).max(600),
  })
  .strict();

/** Argumentative relation between two candidate points (by array index). */
export const candidateRelation = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    /** 'supports' = premise-of; the rest are the five critical questions. */
    kind: z.enum([
      "supports",
      "empirics",
      "alternatives",
      "goal_conflict",
      "feasibility",
      "value_conflict",
    ]),
  })
  .strict();

export const decompositionOutput = z
  .object({
    points: z.array(candidatePoint).max(30),
    relations: z.array(candidateRelation).max(60),
  })
  .strict();

export const matchOutput = z
  .object({
    decision: z.enum(["matched", "new"]),
    /** Index into the numbered list of existing points (when matched). */
    matched_index: z.number().int().nonnegative().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const relationsOutput = z
  .object({
    relations: z.array(candidateRelation).max(60),
  })
  .strict();

/** AI-editor verdict on one item of a numbered batch. */
export const reviewVerdict = z
  .object({
    index: z.number().int().nonnegative(),
    decision: z.enum(["release", "reject"]),
    reason: z.string().max(300),
  })
  .strict();

export const aiReviewOutput = z
  .object({
    verdicts: z.array(reviewVerdict).max(40),
  })
  .strict();

/** Inferred stance of a submission toward one statement of the map. */
export const stanceVerdict = z
  .object({
    index: z.number().int().nonnegative(),
    stance: z.enum(["agree", "disagree", "pass"]),
  })
  .strict();

export const stanceOutput = z
  .object({
    stances: z.array(stanceVerdict).max(40),
  })
  .strict();

export const statementOutput = z
  .object({
    /** Votable statement in German — one declarative sentence. */
    de: z.string().min(10).max(400),
    /** Votable statement in English — one declarative sentence. */
    en: z.string().min(10).max(400),
  })
  .strict();

export type CandidatePoint = z.infer<typeof candidatePoint>;
export type DecompositionOutput = z.infer<typeof decompositionOutput>;
export type MatchOutput = z.infer<typeof matchOutput>;
export type StatementOutput = z.infer<typeof statementOutput>;

function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  // Strip the $schema meta-ref: the Claude Code CLI's validator rejects
  // external meta-schema references.
  const { $schema: _, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown> & { $schema?: string };
  return rest;
}

export const decompositionJsonSchema = toProviderSchema(decompositionOutput);
export const matchJsonSchema = toProviderSchema(matchOutput);
export const statementJsonSchema = toProviderSchema(statementOutput);
export const relationsJsonSchema = toProviderSchema(relationsOutput);
export const aiReviewJsonSchema = toProviderSchema(aiReviewOutput);
export const stanceJsonSchema = toProviderSchema(stanceOutput);
