/**
 * Paper letters: the language model reads a scanned page (a PDF without a text layer, or a photo)
 * and writes down its words, nothing else. What it cannot read it marks; it adds nothing. The
 * result becomes the statement's text like any typed letter, with the usual quotes and checks.
 */

import type { LlmProvider } from "@policy/llm";

import type { Ocr } from "./text.ts";

const OCR_SYSTEM = `Du liest einen eingescannten oder fotografierten Brief an eine Stadtverwaltung ab. Gib den Text wörtlich wieder, in der Reihenfolge, in der er auf dem Blatt steht, mit Absätzen.
Regeln:
1. Nichts ergänzen, nichts verbessern, nichts zusammenfassen, keine Rechtschreibung korrigieren.
2. Was du nicht sicher lesen kannst, schreibst du als [unleserlich].
3. Briefkopf, Anschrift, Datum, Unterschrift und Stempel lässt du weg; nur der Brieftext selbst.
4. Steht auf dem Bild kein Text, gibst du einen leeren Text zurück und setzt lesbar auf false.`;

const schema = {
  type: "object",
  properties: {
    lesbar: { type: "boolean" },
    text: { type: "string" },
  },
  required: ["lesbar", "text"],
  additionalProperties: false,
};

export function readScan(llm: LlmProvider): Ocr {
  return async (bytes, mediaType) => {
    const r = await llm.generateStructured<{ lesbar: boolean; text: string }>({
      system: OCR_SYSTEM,
      prompt: "Lies den Brief im Anhang ab.",
      schema,
      attachments: [{ mediaType, data: Buffer.from(bytes).toString("base64") }],
    });
    return r.output.lesbar ? r.output.text : "";
  };
}
