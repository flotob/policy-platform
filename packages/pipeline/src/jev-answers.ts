/**
 * Questionnaire answers → votes (exp/jev step 7).
 *
 * The import mapped answer labels with an English-only regex ladder
 * ("yes|much|very much|…") and called a question votable when >= 60 % of its
 * answers matched. That breaks on German labels ("Eher ja"), other scales
 * (1–7, "sehr wichtig"), and treats categorical/demographic questions by
 * accident. Here: one request per question — a type choice (is this a stance
 * question at all?) plus one choice per DISTINCT answer label (a small,
 * cacheable set), judged against the question's own wording.
 */

import { choice, type JevJudge } from "@policy/llm";

export const ANSWERS_FAMILY = "questionnaire-answers.v1";
/** Above this many distinct labels a question is free text — labels are not judged. */
export const MAX_LABELS = 40;

/** The original regex mapping, kept for comparison and as no-key fallback. */
export function regexMapAnswer(value: string): -1 | 0 | 1 | null {
  const v = value.trim().replace(/&apos;/g, "'");
  if (!v) return 0;
  const lower = v.toLowerCase();
  if (/^(no opinion|i don'?t know|don'?t know|neutral|3\b)/.test(lower)) return 0;
  if (/^(yes|much|very much|rather yes|agree|strongly agree)/.test(lower)) return 1;
  if (/^(no|not at all|rather not|disagree|strongly disagree)/.test(lower)) return -1;
  const likert = /^([1-5])\s*[-–]/.exec(v);
  if (likert) {
    const n = Number(likert[1]);
    return n >= 4 ? 1 : n <= 2 ? -1 : 0;
  }
  return null;
}

const TYPES = {
  stance:
    "The answers express a position on what the question asks — yes/no, agree/disagree, or a scale of importance, support, or approval.",
  categorical:
    "The answers pick from categories that are not a position on a claim (e.g. which sector, which option among several, which country).",
  free_text: "The answers are free text.",
  demographic: "The question asks about the respondent (organisation type, size, location, role).",
} as const;

const ANSWER = {
  agree: "The answer affirms what the question asks: yes, agree, important, support — at any strength.",
  disagree: "The answer denies what the question asks: no, disagree, not important, oppose — at any strength.",
  neutral: "The answer is explicitly undecided: no opinion, neutral, don't know, the middle of a scale.",
  not_a_position: "The answer is not a position on the question (a category, a number of units, free text).",
} as const;

export type AnswerValue = -1 | 0 | 1 | null;

export interface QuestionMapping {
  type: keyof typeof TYPES;
  typeConfidence: number;
  labels: Map<string, { value: AnswerValue; confidence: number }>;
}

const VALUE: Record<keyof typeof ANSWER, AnswerValue> = {
  agree: 1,
  disagree: -1,
  neutral: 0,
  not_a_position: null,
};

export async function mapQuestion(
  judge: JevJudge,
  question: string,
  labels: string[],
): Promise<{ mapping: QuestionMapping; answers: Record<string, unknown> }> {
  const judged = labels.length <= MAX_LABELS ? labels : [];
  const questions: Record<string, ReturnType<typeof choice>> = {
    type: choice("What kind of questionnaire question is `question`, judging by its wording and `answer_sample`?", TYPES),
  };
  judged.forEach((label, i) => {
    questions[`a${i}`] = choice({ task: "What does this answer to `question` express?", answer: label }, ANSWER);
  });
  const { answers } = await judge.judge(
    { question, answer_sample: labels.slice(0, 12) },
    questions,
  );
  const t = answers.type as { choice: keyof typeof TYPES; confidence: number };
  const map = new Map<string, { value: AnswerValue; confidence: number }>();
  judged.forEach((label, i) => {
    const a = answers[`a${i}`] as { choice: keyof typeof ANSWER; confidence: number };
    map.set(label, { value: VALUE[a.choice], confidence: a.confidence });
  });
  return {
    mapping: {
      type: labels.length > MAX_LABELS ? "free_text" : t.choice,
      typeConfidence: t.confidence,
      labels: map,
    },
    answers: answers as Record<string, unknown>,
  };
}

/**
 * Numeric rating scales are decided in code, not by the model (Jev reads a
 * bare "3" without its scale — a known weakness with numbers). Applies when
 * every label is a number on 1–5 (optionally "N - text", optionally with a
 * 0 that EU questionnaires use for "don't know" → no vote).
 */
export function numericScaleValue(labels: string[]): Map<string, AnswerValue> | null {
  const nums = labels.map((l) => /^\s*(\d+)\s*(?:[-–].*)?$/.exec(l)?.[1]);
  if (nums.some((n) => n === undefined)) return null;
  const values = nums.map(Number);
  if (values.some((n) => n > 5)) return null;
  const out = new Map<string, AnswerValue>();
  labels.forEach((l, i) => {
    const n = values[i]!;
    out.set(l, n === 0 ? null : n < 3 ? -1 : n === 3 ? 0 : 1);
  });
  return out;
}

export interface QuestionDecision {
  votable: boolean;
  values: Map<string, AnswerValue>;
  reason: "stance" | "not_stance" | "multi_select" | "few_mapped";
}

/**
 * Policy in code: votable = Jev calls it a stance question, it is not a
 * multi-select ('|'-joined options), and >= 60 % of its answers map to a
 * position. Numeric scales take the code rule; words take Jev's label map.
 */
export function decideQuestion(labelCounts: Map<string, number>, jev: QuestionMapping): QuestionDecision {
  const labels = [...labelCounts.keys()];
  const numeric = numericScaleValue(labels);
  const values = new Map<string, AnswerValue>();
  for (const l of labels) values.set(l, numeric ? numeric.get(l)! : (jev.labels.get(l)?.value ?? null));
  if (labels.some((l) => l.includes(" | "))) return { votable: false, values, reason: "multi_select" };
  if (!numeric && jev.type !== "stance") return { votable: false, values, reason: "not_stance" };
  let mapped = 0;
  let total = 0;
  for (const [l, n] of labelCounts) {
    total += n;
    if (values.get(l) !== null) mapped += n;
  }
  if (mapped / total < 0.6) return { votable: false, values, reason: "few_mapped" };
  return { votable: true, values, reason: "stance" };
}
