/**
 * The two generative calls of the core loop, in German like the procedure:
 * E2 (start skeleton from the town's justification) and Z2/Z3/A1 (a
 * statement into moves with fixed fields and a votable sentence each). The
 * model fills fixed fields with finite domains (I2); the free-text fields
 * (kern, aussage) go through the editors.
 */

import { z } from "zod";

export const STEP_KEYS = ["lage", "wirkung", "weg", "eingriff"] as const;
export const QUESTION_KEYS = ["lage", "wirkung", "weg", "nebenfolgen", "wert"] as const;
export const TYP_KEYS = ["T", "W", "verfahren"] as const;
export const BELEG_KEYS = ["keine", "behauptung", "vergleichsfall", "studie", "messdaten"] as const;

export type StepKey = (typeof STEP_KEYS)[number];
export type QuestionKey = (typeof QUESTION_KEYS)[number];
export type Typ = (typeof TYP_KEYS)[number];
export type Beleg = (typeof BELEG_KEYS)[number];
export type Richtung = "stuetzt" | "greift_an";

/** The campaign as the machine sees it: the measure and its four-step justification. */
export interface KernContext {
  /** "Stadt Musterstadt" */
  town: string;
  question: string;
  measure: string;
  justification: string | null;
  steps: { key: StepKey; label: string; these: string }[];
  /** The five critical questions and the steps each may attack (a campaign parameter). */
  questions: { key: QuestionKey; label: string; steps: readonly StepKey[] }[];
}

function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  // The Claude Code CLI's validator rejects the external $schema meta-ref.
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown> & { $schema?: string };
  return rest;
}

// ——— E2: start skeleton ——————————————————————————————————————————————————

export const skeletonOutput = z
  .object({
    schluss: z.string().min(10).max(300),
    praemissen: z
      .array(
        z
          .object({
            schritt: z.enum(STEP_KEYS),
            aussage: z.string().min(10).max(300),
            label: z.string().min(2).max(60),
            typ: z.enum(["T", "W"]),
          })
          .strict(),
      )
      .min(4)
      .max(16),
  })
  .strict();
export type SkeletonOutput = z.infer<typeof skeletonOutput>;
export const skeletonJsonSchema = toProviderSchema(skeletonOutput);

export const SKELETON_SYSTEM = `Du bereitest ein kommunales Beteiligungsverfahren vor. Eine Gemeinde stellt eine Maßnahme zur Diskussion und begründet sie in vier Schritten. Du zerlegst diese Begründung in einzelne abstimmbare Aussagen: das Startgerüst, auf das sich später jeder Beitrag aus der Beteiligung bezieht.

Regeln:
1. Jede Aussage enthält genau eine Behauptung aus der Begründung, so dass man ihr als Ganzes zustimmen oder sie ablehnen kann. Keine Begründungsnebensätze („…, weil …“, „…, sodass …“), keine Und-Ketten.
2. Nichts hinzuerfinden: nur, was die Gemeinde selbst schreibt. Zahlen, Fristen und Orte so übernehmen, wie sie dastehen.
3. Ein neutraler Aussagesatz ohne „Die Stadt meint“, konkret auf die Gemeinde bezogen.
4. Je Schritt eine bis vier Aussagen: das Tragende, nicht jede Nebenbemerkung.
5. typ: „T“ (Tatsache), wenn Daten, Studien oder Erfahrung die Aussage prüfen können; „W“ (Wertung), wenn es darum geht, was richtig, gerecht, zumutbar oder den Preis wert ist.
6. label: ein Stichwort für die Übersicht, höchstens 45 Zeichen.
7. schluss: die Entscheidung selbst als Aussagesatz („Musterstadt soll …“), abstimmbar wie die anderen.`;

export function skeletonPrompt(c: KernContext): string {
  const steps = c.steps.map((s) => `[${s.key}] ${s.label}:\n${s.these}`).join("\n\n");
  return (
    `Gemeinde: ${c.town}\nEntscheidungsfrage: ${c.question}\nMaßnahme: ${c.measure}\n\n` +
    (c.justification ? `Begründung der Gemeinde im Zusammenhang:\n${c.justification}\n\n` : "") +
    `Die Begründung in vier Schritten:\n\n${steps}\n\n` +
    `Zerlege die vier Schritte in abstimmbare Aussagen und formuliere den Schluss.`
  );
}

// ——— Z2/Z3/A1: a statement into moves ———————————————————————————————————————

export const moveOutput = z
  .object({
    zitat: z.string().min(10).max(1500),
    kern: z.string().min(5).max(400),
    aussage: z.string().min(5).max(300),
    label: z.string().min(2).max(60),
    typ: z.enum(TYP_KEYS),
    schritt: z.enum(STEP_KEYS),
    frage: z.enum(QUESTION_KEYS),
    richtung: z.enum(["stuetzt", "greift_an"]),
    einwand: z.string().max(240).nullable(),
    beleg: z.enum(BELEG_KEYS),
  })
  .strict();
export const movesOutput = z.object({ zuege: z.array(moveOutput).max(30) }).strict();
export type MoveOutput = z.infer<typeof moveOutput>;
export const movesJsonSchema = toProviderSchema(movesOutput);

export function movesSystem(c: KernContext): string {
  const steps = c.steps.map((s) => `- „${s.key}“ (${s.label}): ${s.these}`).join("\n");
  const questions = c.questions.map((q) => `- „${q.key}“: ${q.label} Greift an: ${q.steps.map((s) => `„${s}“`).join(" oder ")}.`).join("\n");
  return `Du liest eine Stellungnahme zu einer Maßnahme, die eine Gemeinde zur Diskussion stellt, und zerlegst sie in Züge. Ein Zug ist eine einzelne Behauptung, der man für sich zustimmen oder die man bestreiten kann.

Gemeinde: ${c.town}
Entscheidungsfrage: ${c.question}
Maßnahme: ${c.measure}

Die Gemeinde begründet die Maßnahme in vier Schritten (schritt):
${steps}

Jeder Zug stützt einen dieser Schritte oder greift ihn an. Dabei stellt oder beantwortet er eine von fünf Prüffragen (frage):
${questions}

Regeln:
1. Nur Sachargumente. Begrüßung, Dank, Floskeln, reine Kritik am Verfahren und Wiederholungen derselben Behauptung im selben Text sind keine Züge.
2. zitat: die Textstelle, aus der der Zug stammt, WÖRTLICH kopiert: ein bis drei zusammenhängende Sätze, nichts umformuliert, nichts ausgelassen, keine Auslassungszeichen.
3. kern: die Behauptung so, wie der Verfasser sie aufstellt, in einem Satz, mit abgestreiftem Ton („Ökodiktatur“ wird „Die Pflicht greift unverhältnismäßig ins Eigentum ein“).
4. aussage: der Satz, über den Bürgerinnen und Bürger abstimmen. Ein neutraler Aussagesatz mit genau einer Behauptung, ohne Begründungsnebensatz („…, weil …“), in der Richtung des Verfassers: Wer ihm zustimmt, teilt dessen Position. Zahlen und Orte wie im Text.
5. label: ein Stichwort für die Übersicht, höchstens 45 Zeichen.
6. typ: „T“ (Tatsache: Daten, Studien oder Erfahrung können es prüfen), „W“ (Wertung: was richtig, gerecht, zumutbar oder den Preis wert ist), „verfahren“ (ein Vorschlag, wie die Maßnahme auszugestalten ist: Frist, Ausnahme, Förderung, Härtefallregel).
7. schritt und richtung: welchen Schritt der Begründung der Zug stützt („stuetzt“) oder angreift („greift_an“). Ein Ausgestaltungsvorschlag, der einen Einwand auffängt, stützt den Schritt, den der Einwand angreift.
8. frage: welche Prüffrage der Zug stellt (bei einem Angriff) oder beantwortet (bei einer Stütze). Nur die Paare aus der Liste oben sind erlaubt. Nebenfolgen (Kosten, Mieten, Wartung, Belastung bestimmter Gruppen) haben immer frage „nebenfolgen“: als Tatsache („Die Mehrkosten liegen bei 3 Prozent“) mit schritt „lage“, als Wertung („Das ist nicht zumutbar“) mit schritt „eingriff“.
9. einwand: bei einem Angriff der Einwand in einem kurzen Satz, so wie er erhoben wird („Das Handwerk schafft die Menge nicht.“); bei einer Stütze null.
10. beleg: was der Verfasser für die Behauptung anführt: „keine“ (nichts, etwa bei Wertungen), „behauptung“ (eine Tatsache ohne Quelle), „vergleichsfall“ (eine andere Stadt, ein Präzedenzfall), „studie“ (eine benannte Studie oder ein Gutachten), „messdaten“ (eigene Zahlen oder Messungen mit Herkunft).`;
}

export function movesPrompt(sender: { name: string | null; type: string | null }, window: { text: string; index: number; count: number }): string {
  const who = [sender.name, sender.type].filter(Boolean).join(", ") || "unbekannt";
  const part = window.count > 1 ? ` (Abschnitt ${window.index + 1} von ${window.count}; zerlege nur diesen Abschnitt)` : "";
  return `Stellungnahme von: ${who}${part}\n\n<<<\n${window.text}\n>>>\n\nZerlege die Stellungnahme in Züge.`;
}
