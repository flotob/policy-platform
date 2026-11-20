/**
 * Z1 — text comes in: the full text of an uploaded statement (PDF, DOCX,
 * plain text). Offsets of every move point into exactly this string, so it is
 * stored once (submissions.text) and never re-extracted.
 */

import { inflateRawSync } from "node:zlib";

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

/** A Word file unpacks to at most this much; anything larger is refused before it is read. */
export const DOCX_MAX_UNPACKED = 50 * 1024 * 1024;
const DOCX_MAX_PARTS = 5000;

/**
 * A Word file is a ZIP archive, and the web server itself unpacks it. A doctored file of 1 MB can unpack
 * to gigabytes and take the whole site down. So before mammoth reads it, every part is unpacked here once
 * with a hard ceiling on what comes out: the sizes the archive declares can lie, the ceiling cannot.
 */
export function checkDocxSize(bytes: Uint8Array, max = DOCX_MAX_UNPACKED): void {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tooBig = () =>
    new UnreadableFile(`Die Word-Datei ist ausgepackt größer als ${Math.round(max / 1024 / 1024)} MB. Bitte als PDF speichern und das hochladen.`);
  const damaged = () => new UnreadableFile("Die Word-Datei ist beschädigt. Bitte neu speichern oder als PDF hochladen.");
  // The archive's table of contents ends with a fixed record in the last 22 bytes (plus up to 64 KB of comment).
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw damaged();
  const parts = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  if (parts === 0xffff || p === 0xffffffff || parts > DOCX_MAX_PARTS) throw tooBig(); // ZIP64 or absurdly many parts: no Word file needs that
  let used = 0;
  for (let n = 0; n < parts; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw damaged();
    const method = b.readUInt16LE(p + 10);
    const packed = b.readUInt32LE(p + 20);
    const local = b.readUInt32LE(p + 42);
    if (packed === 0xffffffff || local === 0xffffffff) throw tooBig();
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) throw damaged();
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (start + packed > b.length) throw damaged();
    if (method === 0) used += packed;
    else if (method === 8) {
      try {
        used += inflateRawSync(b.subarray(start, start + packed), { maxOutputLength: Math.max(1, max - used) }).length;
      } catch (e) {
        throw e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? tooBig() : damaged();
      }
    } else throw damaged();
    if (used > max) throw tooBig();
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
}

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
    checkDocxSize(bytes);
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
