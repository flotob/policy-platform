/**
 * Deterministic fake provider for tests and offline development.
 * Returns queued responses in order, recording every request.
 */

import {
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  promptHash,
} from "./provider.ts";

export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly requests: GenerateRequest[] = [];
  private queue: unknown[] = [];

  enqueue(...outputs: unknown[]): void {
    this.queue.push(...outputs);
  }

  async generateStructured<T = unknown>(
    req: GenerateRequest,
  ): Promise<GenerateResult<T>> {
    this.requests.push(req);
    const output = this.queue.shift();
    if (output === undefined) {
      throw new Error("FakeProvider queue is empty — enqueue() a response first");
    }
    return {
      output: output as T,
      provenance: {
        provider: this.name,
        model: req.model ?? "fake-model",
        promptHash: promptHash(req),
        startedAt: new Date().toISOString(),
        durationMs: 0,
      },
    };
  }
}
