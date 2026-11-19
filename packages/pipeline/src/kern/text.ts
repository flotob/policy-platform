/**
 * Z1 — text comes in: the full text of an uploaded statement (PDF, DOCX,
 * plain text). Offsets of every move point into exactly this string, so it is
 * stored once (submissions.text) and never re-extracted.
 */

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class UnreadableFile extends Error {
  override name = "UnreadableFile";
}

/** Reads a scanned page (PDF without a text layer, or a photo) and returns its words. */
export type Ocr = (bytes: Uint8Array, mediaType: string) => Promise<string>;

const IMAGES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const clean = (t: string) => t.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/**
 * With `ocr` (the machine's reader, when the text is read in a background job) a scanned PDF or a
 * photographed letter is read from its images; without it such a file is refused, as before.
 */
export async function extractFileText(bytes: Uint8Array, filename: string, mime: string | null, ocr?: Ocr): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text: string;
  const image = mime && Object.values(IMAGES).includes(mime) ? mime : IMAGES[ext];
  if (image && ocr) {
    text = await ocr(bytes, image);
  } else if (mime === "application/pdf" || ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    text = (pages as string[]).join("\n\n");
    if (clean(text).length < 40 && ocr) text = await ocr(bytes, "application/pdf");
  } else if (mime === DOCX || ext === "docx") {
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } else if (mime?.startsWith("text/") || ["txt", "md", "text"].includes(ext)) {
    text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  } else {
    throw new UnreadableFile(`Dateien dieser Art kann die Maschine nicht lesen (${ext || mime}). Bitte als PDF, DOCX oder Text hochladen.`);
  }
  text = clean(text);
  if (text.length < 40) {
    throw new UnreadableFile("In der Datei steht kein lesbarer Text. Ist sie eingescannt? Dann bitte mit Texterkennung erneut speichern.");
  }
  return text;
}
