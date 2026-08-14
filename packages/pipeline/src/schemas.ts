/**
 * Structured-output contracts for the decomposition pipeline.
 * zod is the source; JSON Schema is derived for the LLM provider.
 */

import { z } from "zod";

/** The five critical questions — the doors every objection comes through. */
export const cqKind = z.enum([
  "empirics",
  "alternatives",
  "goal_conflict",
  "feasibility",
  "value_conflict",
]);

export const candidatePoint = z
  .object({
    /** Short editorial label in the submission's language (≤ 80 chars). */
    label: z.string().min(3).max(120),
    /** One neutral sentence stating the claim. */
    summary: z.string().min(10).max(500),
    kind: z.enum(["fact", "value", "design", "gap"]),
    /** Slot in the practical-reasoning schema; null when not attributable. */
    slot: z.enum(["P1", "P2", "P3", "P4", "conclusion"]).nullable(),
    /** For an OBJECTION: the door it comes through; null otherwise. */
    cq: cqKind.nullable(),
    /** For an instrument (kind=design): the door(s) it answers,
     *  first = primary; null otherwise. */
    answers_cq: z.array(cqKind).max(3).nullable(),
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

/** One verdict of a batch match call (throughput plan O1). */
export const batchMatchVerdict = z
  .object({
    /** Index into the numbered candidate list. */
    candidate_index: z.number().int().nonnegative(),
    decision: z.enum(["matched", "new"]),
    /** Index into the numbered list of existing points (when matched). */
    matched_index: z.number().int().nonnegative().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const batchMatchOutput = z
  .object({
    matches: z.array(batchMatchVerdict).max(30),
  })
  .strict();

export const measuresProposeOutput = z
  .object({
    measures: z.array(z.string().min(3).max(80)).min(2).max(7),
  })
  .strict();

export const measureAssignVerdict = z
  .object({
    index: z.number().int().nonnegative(),
    /** Index into the measure list; -1 = übergreifend (shared trunk). */
    measure_index: z.number().int().min(-1),
  })
  .strict();

export const measuresAssignOutput = z
  .object({
    verdicts: z.array(measureAssignVerdict).max(40),
  })
  .strict();

/** Backfill classifier verdict for one existing point (by index). */
export const cqVerdict = z
  .object({
    index: z.number().int().nonnegative(),
    role: z.enum(["claim", "objection", "instrument", "gap"]),
    /** Door for objections; null otherwise. */
    cq: cqKind.nullable(),
    /** Door(s) an instrument answers, first = primary; null otherwise. */
    answers_cq: z.array(cqKind).max(3).nullable(),
  })
  .strict();

export const classifyCqOutput = z
  .object({
    verdicts: z.array(cqVerdict).max(40),
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

/** Human-readable camp naming from composition + representative statements. */
export const campNamesOutput = z
  .object({
    camps: z
      .array(
        z.object({
          group: z.number().int().nonnegative(),
          name: z.string().min(3).max(60),
          summary: z.string().min(10).max(240),
        }).strict(),
      )
      .max(8),
  })
  .strict();

/** Short display labels for overlong point labels (same language). */
export const shortLabelsOutput = z
  .object({
    labels: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          short: z.string().min(5).max(90),
        }).strict(),
      )
      .max(40),
  })
  .strict();

/** Theme proposal + assignment (the map's zoom level). */
export const themesOutput = z
  .object({ themes: z.array(z.string().min(3).max(60)).min(3).max(15) })
  .strict();

export const themeAssignOutput = z
  .object({
    assignments: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          /** Index into the theme list; -1 = none fits. */
          theme: z.number().int().gte(-1),
        }).strict(),
      )
      .max(50),
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
export const batchMatchJsonSchema = toProviderSchema(batchMatchOutput);
export const classifyCqJsonSchema = toProviderSchema(classifyCqOutput);
export const measuresProposeJsonSchema = toProviderSchema(measuresProposeOutput);
export const measuresAssignJsonSchema = toProviderSchema(measuresAssignOutput);
export const statementJsonSchema = toProviderSchema(statementOutput);
export const relationsJsonSchema = toProviderSchema(relationsOutput);
export const aiReviewJsonSchema = toProviderSchema(aiReviewOutput);
export const stanceJsonSchema = toProviderSchema(stanceOutput);
export const campNamesJsonSchema = toProviderSchema(campNamesOutput);
export const shortLabelsJsonSchema = toProviderSchema(shortLabelsOutput);
export const themesJsonSchema = toProviderSchema(themesOutput);
export const themeAssignJsonSchema = toProviderSchema(themeAssignOutput);
