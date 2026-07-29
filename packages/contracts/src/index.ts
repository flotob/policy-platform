/**
 * The contract for the core ↔ extraction-worker boundary.
 *
 * zod is the single source of truth; `pnpm build` emits JSON Schema artifacts
 * (schemas/*.json, committed) that the Python worker validates against. The two
 * sides can therefore never drift silently: the worker refuses payloads that
 * don't match the committed schema, and CI regenerates + diffs the artifacts.
 */

import { z } from "zod";

export const JOB_KINDS = ["extract_document"] as const;

/** Payload of an extract_document job row (jobs.payload). */
export const extractDocumentPayload = z
  .object({
    /** Document row this extraction belongs to. */
    document_id: z.uuid(),
    /** Path to the uploaded file, relative to the shared blob directory. */
    blob_path: z.string().min(1),
    /** Original filename — the extension selects the extraction method. */
    filename: z.string().min(1),
  })
  .strict();

/** Result written back by the worker (jobs.result) on success. */
export const extractDocumentResult = z
  .object({
    /** Extracted plain text; null when the format yielded none. */
    text: z.string().nullable(),
    /** Tool identifier incl. version, e.g. "pymupdf/1.26.0". */
    tool: z.string().nullable(),
    /** Character count of `text` (0 when null). */
    chars: z.number().int().nonnegative(),
  })
  .strict();

export type ExtractDocumentPayload = z.infer<typeof extractDocumentPayload>;
export type ExtractDocumentResult = z.infer<typeof extractDocumentResult>;

/** Registry used by the schema emitter; one entry per (kind, side). */
export const contractRegistry = {
  "extract_document.payload": extractDocumentPayload,
  "extract_document.result": extractDocumentResult,
} as const;
