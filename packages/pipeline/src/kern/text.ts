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

export async function extractFileText(bytes: Uint8Array, filename: string, mime: string | null): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text: string;
  if (mime === "application/pdf" || ext === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    text = (pages as string[]).join("\n\n");
  } else if (mime === DOCX || ext === "docx") {
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  } else if (mime?.startsWith("text/") || ["txt", "md", "text"].includes(ext)) {
    text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  } else {
    throw new UnreadableFile(`Dateien dieser Art kann die Maschine nicht lesen (${ext || mime}). Bitte als PDF, DOCX oder Text hochladen.`);
  }
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40) {
    throw new UnreadableFile("In der Datei steht kein lesbarer Text. Ist sie eingescannt? Dann bitte mit Texterkennung erneut speichern.");
  }
  return text;
}
