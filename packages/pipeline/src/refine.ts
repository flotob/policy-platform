/**
 * Refine (exp/jev): the editors are machines. Every extracted candidate gets
 * the Jev intake judgment (release criteria, role, door, fact/value, slot);
 * a flag no longer means "waiting for a person" but triggers an automatic
 * repair — the LLM editor splits, rewrites or drops the point, and Jev judges
 * the result again. Clear failures (greetings, off-topic) are dropped without
 * an LLM call. Everything — flags before, editor action and reason, flags
 * after — is kept with the refined candidate, so a person can audit later.
 *
 * Status after refine: released, unless a clear failure (rejected) or
 * personal data that the editor could not remove (draft — never released
 * automatically). Residual flags are recorded, not acted on.
 */

import type { JevJudge, LlmProvider } from "@policy/llm";

import { decideIntake, intakeRequest, type IntakeDecision } from "./intake.ts";
import { Semaphore } from "./pool.ts";
import { EDITOR_SYSTEM, editorPrompt } from "./prompts.ts";
import { locateQuote } from "./quote-span.ts";
import { editorJsonSchema, editorOutput, type ExtractedPoint } from "./schemas.ts";

/** Bump when the refine policy or the intake questions change: windows refined under another policy are refined again. */
export const REFINE_POLICY = "refine.v2";

/** Flags that a text repair can fix. Role flags (role_uncertain, demand_as_claim) are recorded only. */
export const REPAIR_FLAGS = new Set([
  "several_claims",
  "mixed_fact_value",
  "not_standalone",
  "not_neutral",
  "personal_data",
  "meta",
  "off_topic",
]);

export interface RefinedCandidate extends ExtractedPoint {
  intake: { answers: Record<string, unknown>; decision: IntakeDecision; model: string; requestId: string | null };
  /** Final status after refine (the intake verdict, overridden by the machine-editor policy). */
  status: "released" | "rejected" | "draft";
  origin: {
    candidate: number;
    action: "as_extracted" | "keep" | "rewrite" | "split" | "drop" | "rejected";
    flagsBefore: string[];
    reason?: string;
    editorModel?: string;
  };
}

export interface RefineStats {
  candidates: number;
  flagged: number;
  kept: number;
  rewritten: number;
  split: number;
  dropped: number;
  rejected: number;
  out: number;
  residualFlags: number;
}

function finalStatus(d: IntakeDecision): RefinedCandidate["status"] {
  if (d.verdict === "reject") return "rejected";
  if (d.flags.includes("personal_data")) return "draft";
  return "released";
}

async function intake(judge: JevJudge, consultation: string, p: ExtractedPoint) {
  const req = intakeRequest(consultation, { label: p.label, summary: p.summary });
  const { answers, provenance } = await judge.judge(req.state, req.questions);
  const a = answers as Record<string, unknown>;
  return { answers: a, decision: decideIntake(a), model: provenance.model, requestId: provenance.requestId ?? null };
}

/** The passage the editor sees: around the quote if it can be found, else the window. */
function passageFor(text: string, window: { start: number; end: number }, quote?: string): string {
  const span = quote ? locateQuote(text, quote) : null;
  if (span) return text.slice(Math.max(0, span.start - 1500), Math.min(text.length, span.end + 1500));
  return text.slice(window.start, Math.min(window.end, window.start + 6000));
}

export async function refineWindow(
  judge: JevJudge,
  provider: LlmProvider,
  editorGate: Semaphore,
  consultation: string,
  text: string,
  window: { start: number; end: number },
  candidates: ExtractedPoint[],
  model: string,
): Promise<{ refined: RefinedCandidate[]; stats: RefineStats }> {
  const stats: RefineStats = {
    candidates: candidates.length,
    flagged: 0,
    kept: 0,
    rewritten: 0,
    split: 0,
    dropped: 0,
    rejected: 0,
    out: 0,
    residualFlags: 0,
  };
  const perCandidate = await Promise.all(
    candidates.map(async (c, i): Promise<RefinedCandidate[]> => {
      const first = await intake(judge, consultation, c);
      const d = first.decision;
      const repair = d.flags.filter((f) => REPAIR_FLAGS.has(f));
      if (d.verdict === "reject") {
        stats.rejected++;
        return [{ ...c, intake: first, status: "rejected", origin: { candidate: i, action: "rejected", flagsBefore: d.flags } }];
      }
      if (repair.length === 0) {
        return [{ ...c, intake: first, status: finalStatus(d), origin: { candidate: i, action: "as_extracted", flagsBefore: d.flags } }];
      }
      stats.flagged++;
      const res = await editorGate.run(() =>
        provider.generateStructured({
          system: EDITOR_SYSTEM,
          prompt: editorPrompt({ consultation, flags: repair, point: c, passage: passageFor(text, window, c.quote) }),
          schema: editorJsonSchema,
          model,
        }),
      );
      const ed = editorOutput.parse(res.output);
      const origin = (action: RefinedCandidate["origin"]["action"]) => ({
        candidate: i,
        action,
        flagsBefore: d.flags,
        reason: ed.reason,
        editorModel: res.provenance.model,
      });
      if (ed.action === "drop") {
        stats.dropped++;
        return [{ ...c, intake: first, status: "rejected", origin: origin("drop") }];
      }
      if (ed.action === "keep" || ed.points.length === 0) {
        stats.kept++;
        return [{ ...c, intake: first, status: finalStatus(d), origin: origin("keep") }];
      }
      const action = ed.action === "split" && ed.points.length > 1 ? "split" : "rewrite";
      if (action === "split") stats.split++;
      else stats.rewritten++;
      return Promise.all(
        ed.points.map(async (p) => {
          const again = await intake(judge, consultation, p);
          return { ...p, intake: again, status: finalStatus(again.decision), origin: origin(action) };
        }),
      );
    }),
  );
  const refined = perCandidate.flat();
  stats.out = refined.filter((r) => r.status !== "rejected").length;
  stats.residualFlags = refined.filter(
    (r) => r.status !== "rejected" && r.intake.decision.flags.some((f) => REPAIR_FLAGS.has(f)),
  ).length;
  return { refined, stats };
}
