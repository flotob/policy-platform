/**
 * System One judgments via TypeSafe (Jev). Complements the generative
 * LlmProvider: Jev never writes text, it answers typed questions (choice /
 * score / noul) over a state object with calibrated probabilities. Code owns
 * the policy — thresholds, merges, escalation — and every call yields the
 * same provenance discipline as the LLM path (model, request hash, timing,
 * tokens, request id) so judgments stay auditable.
 *
 * Auth: TYPESAFE_API_KEY (env). The client is created lazily so importing
 * this module never requires the key. All requests of a process share one
 * concurrency ceiling (JEV_CONCURRENCY, default 16) and retry transient
 * failures (429, 5xx, network) with backoff; a final failure still throws.
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

/**
 * One ceiling for ALL Jev requests of a process, whatever pool they come
 * from (intake per candidate × windows in parallel × scopes in parallel would
 * otherwise multiply into hundreds of simultaneous requests).
 */
const JEV_CONCURRENCY = Number(process.env.JEV_CONCURRENCY ?? 16);
let free = JEV_CONCURRENCY;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

/** Transient = rate limit, server error, or no HTTP status at all (network). */
function transient(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === undefined || status === 429 || status >= 500;
}
const RETRIES = 3;

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
    const { data, requestId } = await limited(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.client.systemOne({ state, questions }).withResponse();
        } catch (err) {
          // Authentication/permission errors hit every request alike: mark them
          // fatal so pools stop at the first one instead of failing N times.
          const status = (err as { status?: number } | null)?.status;
          if (status === 401 || status === 403) Object.assign(err as object, { fatal: true });
          if (attempt >= RETRIES || !transient(err)) throw err;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    });
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
