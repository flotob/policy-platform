/**
 * Door 2 (Gesamtmodell B5–B7): a citizen's own point in two sentences.
 *
 * The first answer has to come while the citizen waits, so it is Jev only
 * (a second or two, no language model): is it an argument at all, and is it
 * a point that already stands to vote — the same claim, or its opposite? If
 * so, the citizen sees that point and confirms with one click; the vote
 * counts there (assumption 2). Otherwise, or on "Nein, das ist etwas
 * anderes", the text goes through the core loop in the background
 * (decomposeShort) and lands with the editors.
 */

import { choice, noul, type JevJudge, type JudgeProvenance } from "@policy/llm";
import { z } from "zod";

import { trigrams } from "../jev-match.ts";
import { decideMatch, matchRequest, type MatchNode, type MoveMatch } from "./match.ts";
import { moveOutput, type KernContext } from "./prompts.ts";

export const KERN_SHORT_FAMILY = "kern-short.v1";
/** Up to this many nodes are compared in one request; beyond, Jev first picks the step. */
const ONE_CALL = 24;
const STEP_SHORTLIST = 14;
const ANYWHERE = 8;
/** Below this the text is treated as no argument (the citizen may still send it on). */
const ARGUMENT_FROM = 0.3;

export const shortMovesOutput = z.object({ zuege: z.array(moveOutput).min(1).max(3) }).strict();
export const shortMovesJsonSchema = (() => {
  const { $schema: _, ...rest } = z.toJSONSchema(shortMovesOutput, { target: "draft-2020-12" }) as Record<string, unknown> & { $schema?: string };
  return rest;
})();

export function shortPrompt(text: string): string {
  return (
    "Kurzaussage aus der Beteiligung (höchstens zwei Sätze, von einer Bürgerin oder einem Bürger). " +
    "Zerlege sie in einen, höchstens drei Züge. Auch eine zugespitzte oder schwache Aussage ist ein Zug, wenn sie einen Kern hat: " +
    `Ton abstreifen, Kern behalten.\n\n<<<\n${text}\n>>>`
  );
}

export type ShortOutcome = "kein_argument" | "gleich" | "gegenteil" | "neu";

export interface ShortCheck {
  outcome: ShortOutcome;
  /** The point to show the citizen ("Das könnte ein Punkt sein, den es schon gibt"). */
  node: string | null;
  /** +1: the citizen says the same; -1: the citizen says the opposite. */
  stance: 1 | -1;
  pArgument: number;
  pPersonal: number;
  match: MoveMatch | null;
}

const argumentQuestions = () => ({
  argument: noul(
    "Does `statement` make a claim about the measure — a fact, an assessment, a concern or a proposal — that other people could agree or disagree with?",
    {
      true: "A claim about the measure, however blunt or short ('Ökodiktatur! Niemand schreibt mir vor, was auf mein Dach kommt' claims that the duty violates owners' freedom).",
      false: "No claim: only an insult without content, a greeting, a question without a position, spam, or something unrelated to the measure.",
    },
  ),
  personal: noul("Does `statement` name or describe a private individual, or attack a person?", {
    true: "Personal data about a private person, or a personal attack.",
    false: "No private person is identifiable or attacked.",
  }),
});

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

const byWording = (text: string, nodes: MatchNode[]) => {
  const t = trigrams(text);
  return nodes.map((n) => ({ n, s: dice(t, trigrams(`${n.text} ${n.einwand ?? ""}`)) })).sort((a, b) => b.s - a.s).map((x) => x.n);
};

export async function checkShortStatement(
  judge: JevJudge,
  c: KernContext,
  text: string,
  nodes: MatchNode[],
): Promise<{ check: ShortCheck; answers: Record<string, unknown>; provenance: JudgeProvenance[] }> {
  const ctx = { town: c.town, measure: c.measure };
  const provenance: JudgeProvenance[] = [];
  let answers: Record<string, unknown> = {};
  // Never the measure itself: everyone against it says "the opposite" of it, but a point with a
  // reason ("Ökodiktatur! Mein Dach, meine Entscheidung") belongs to that reason — the property
  // claim — not to a bare no. A pure "Ich bin dagegen" goes to the editors, who file it in one click.
  nodes = nodes.filter((n) => n.schritt !== null);
  let shortlisted = nodes;

  if (nodes.length > ONE_CALL) {
    // Stage 1: is it an argument, and which step of the justification does it concern?
    const steps: Record<string, string> = {};
    for (const s of c.steps) steps[s.key] = `It concerns "${s.label}": ${s.these}`;
    steps.massnahme = "It concerns the measure as a whole — for or against it — rather than one step of the justification.";
    const first = await judge.judge(
      { procedure: `Public participation procedure of ${c.town} on the measure: "${c.measure}".`, statement: text },
      { ...argumentQuestions(), step: choice("Which part of the town's justification does `statement` concern most?", steps) },
    );
    provenance.push(first.provenance);
    answers = { ...first.answers };
    if ((first.answers.argument as { noul: number }).noul < ARGUMENT_FROM) {
      const a = first.answers as unknown as Record<string, { noul: number }>;
      return {
        check: { outcome: "kein_argument", node: null, stance: 1, pArgument: a.argument!.noul, pPersonal: a.personal!.noul, match: null },
        answers,
        provenance,
      };
    }
    const step = (first.answers.step as { choice: string }).choice;
    const inStep = byWording(text, nodes.filter((n) => n.schritt === step)).slice(0, STEP_SHORTLIST);
    const anywhere = byWording(text, nodes).slice(0, ANYWHERE);
    const seen = new Set<string>();
    shortlisted = [...inStep, ...anywhere].filter((n) => !seen.has(n.id) && seen.add(n.id)).slice(0, ONE_CALL);
  }

  const extra = nodes.length > ONE_CALL ? {} : argumentQuestions();
  const { state, questions, keys } = matchRequest(ctx, { statement: text, claim: text }, shortlisted, extra);
  const second = await judge.judge(state, questions);
  provenance.push(second.provenance);
  answers = { ...answers, ...second.answers };
  const a = answers as Record<string, { noul: number }>;
  const pArgument = a.argument!.noul;
  const pPersonal = a.personal!.noul;
  const match = keys.length ? decideMatch(second.answers, keys, shortlisted) : null;

  let check: ShortCheck;
  if (pArgument < ARGUMENT_FROM) check = { outcome: "kein_argument", node: null, stance: 1, pArgument, pPersonal, match };
  else if (match?.outcome === "treffer") check = { outcome: "gleich", node: match.node, stance: 1, pArgument, pPersonal, match };
  else if (match?.outcome === "gegenteil") check = { outcome: "gegenteil", node: match.node, stance: -1, pArgument, pPersonal, match };
  else check = { outcome: "neu", node: null, stance: 1, pArgument, pPersonal, match };
  return { check, answers, provenance };
}
