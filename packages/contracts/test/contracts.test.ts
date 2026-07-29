import { describe, expect, it } from "vitest";

import { extractDocumentPayload, extractDocumentResult } from "../src/index.ts";

describe("extract_document contract", () => {
  it("accepts a valid payload", () => {
    const payload = {
      document_id: "018f2f47-0000-7000-8000-000000000000",
      blob_path: "ab/abcd.pdf",
      filename: "stellungnahme.pdf",
    };
    expect(extractDocumentPayload.parse(payload)).toEqual(payload);
  });

  it("rejects unknown fields (strict contract)", () => {
    expect(() =>
      extractDocumentPayload.parse({
        document_id: "018f2f47-0000-7000-8000-000000000000",
        blob_path: "ab/abcd.pdf",
        filename: "x.pdf",
        extra: true,
      }),
    ).toThrow();
  });

  it("rejects a non-uuid document_id", () => {
    expect(() =>
      extractDocumentPayload.parse({
        document_id: "42",
        blob_path: "ab/abcd.pdf",
        filename: "x.pdf",
      }),
    ).toThrow();
  });

  it("accepts a null-text result with zero chars", () => {
    expect(
      extractDocumentResult.parse({ text: null, tool: null, chars: 0 }),
    ).toBeTruthy();
  });
});
