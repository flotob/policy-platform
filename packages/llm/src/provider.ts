/**
 * The LLM provider abstraction (roadmap §4 commitment 7).
 *
 * One narrow interface: structured-output generation against a JSON schema.
 * Providers are config; every call yields provenance (provider, model,
 * prompt hash, timing) because decomposition outputs must be
 * reproducible-in-principle and auditable.
 */

import { createHash } from "node:crypto";

export interface GenerateRequest {
  /** Instruction context (system-prompt-like). */
  system?: string;
  /** The task input. */
  prompt: string;
  /** JSON Schema the output must validate against. */
  schema: Record<string, unknown>;
  /** Provider-specific model override. */
  model?: string;
}

export interface CallProvenance {
  provider: string;
  model: string;
  /** sha256 over system + prompt + schema — identifies the exact call shape. */
  promptHash: string;
  startedAt: string;
  durationMs: number;
}

export interface GenerateResult<T = unknown> {
  output: T;
  provenance: CallProvenance;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured<T = unknown>(req: GenerateRequest): Promise<GenerateResult<T>>;
}

export function promptHash(req: GenerateRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        system: req.system ?? null,
        prompt: req.prompt,
        schema: req.schema,
      }),
    )
    .digest("hex");
}
