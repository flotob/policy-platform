/**
 * System One judgments via TypeSafe (Jev). Complements the generative
 * LlmProvider: Jev never writes text, it answers typed questions (choice /
 * score / noul) over a state object with calibrated probabilities. Code owns
 * the policy — thresholds, merges, escalation — and every call yields the
 * same provenance discipline as the LLM path (model, request hash, timing,
 * tokens, request id) so judgments stay auditable.
 *
 * Auth: TYPESAFE_API_KEY (env). The client is created lazily so importing
 * this module never requires the key.
 */

import { createHash } from "node:crypto";

import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export { choice, noul, score } from "@typesafe-ai/sdk";
export type { EntryType, Questions } from "@typesafe-ai/sdk";

const DEFAULT_JEV_MODEL = process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";

export interface JudgeProvenance {
  provider: "typesafe";
  /** Resolved model as reported by the API (e.g. jev-1.13.0). */
  model: string;
  /** sha256 over state + questions — identifies the exact judgment shape. */
  requestHash: string;
  requestId: string | undefined;
  startedAt: string;
  durationMs: number;
  inputTokens: number;
}

export interface JudgeResult<Q extends Questions> {
  answers: SystemOneResult<Q>["answers"];
  provenance: JudgeProvenance;
}

export class JevJudge {
  readonly name = "typesafe";
  #client: TypeSafeClient | undefined;

  constructor(private readonly model: string = DEFAULT_JEV_MODEL) {}

  get client(): TypeSafeClient {
    this.#client ??= new TypeSafeClient({ defaultModel: this.model });
    return this.#client;
  }

  async judge<const Q extends Questions>(
    state: EntryType,
    questions: Q,
  ): Promise<JudgeResult<Q>> {
    const startedAt = new Date();
    const { data, requestId } = await this.client
      .systemOne({ state, questions })
      .withResponse();
    return {
      answers: data.answers,
      provenance: {
        provider: "typesafe",
        model: data.model,
        requestHash: createHash("sha256")
          .update(JSON.stringify({ state, questions }))
          .digest("hex"),
        requestId,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        inputTokens: data.usage.input_tokens,
      },
    };
  }
}
