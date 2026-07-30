import { describe, expect, it } from "vitest";

import { FakeProvider, promptHash } from "../src/index.ts";

const SCHEMA = {
  type: "object",
  properties: { points: { type: "array", items: { type: "string" } } },
  required: ["points"],
} as const;

describe("provider abstraction", () => {
  it("fake provider returns queued outputs with provenance", async () => {
    const provider = new FakeProvider();
    provider.enqueue({ points: ["P1"] });
    const result = await provider.generateStructured<{ points: string[] }>({
      prompt: "decompose this",
      schema: SCHEMA as unknown as Record<string, unknown>,
    });
    expect(result.output.points).toEqual(["P1"]);
    expect(result.provenance.provider).toBe("fake");
    expect(result.provenance.promptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("prompt hash is stable and sensitive to every input part", () => {
    const base = { prompt: "p", schema: { a: 1 } };
    expect(promptHash(base)).toBe(promptHash({ ...base }));
    expect(promptHash(base)).not.toBe(promptHash({ ...base, prompt: "q" }));
    expect(promptHash(base)).not.toBe(promptHash({ ...base, system: "s" }));
    expect(promptHash(base)).not.toBe(promptHash({ ...base, schema: { a: 2 } }));
  });

  it("fake provider throws when queue is empty", async () => {
    const provider = new FakeProvider();
    await expect(
      provider.generateStructured({ prompt: "x", schema: {} }),
    ).rejects.toThrow(/queue is empty/);
  });
});
