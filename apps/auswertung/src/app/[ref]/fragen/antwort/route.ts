/**
 * POST /[ref]/fragen/antwort  { question } → AskResponse
 *
 * 1. Retrieval (no AI): askMaterial() finds ~15 Landkarten-Punkte and ~25
 *    arguments with quotes (Postgres full-text search, organisation names,
 *    diagnoses the question asks about).
 * 2. The language model phrases an answer from exactly that material, a
 *    citation key after every sentence. Keys not in the material are removed;
 *    an answer without a single valid key becomes the fixed "nothing" sentence.
 * Read-only: nothing is written to the database.
 */

import { AgentSdkProvider } from "@policy/llm";
import { findConsultation } from "@policy/landkarte/data";
import { askMaterial, type AskMaterial, type AskResponse } from "@policy/landkarte/data/ask";

import { uncitedSentences } from "@/components/AskBoxText";
import { getDb } from "@/lib/db";

import { ANSWER_SCHEMA, NO_ANSWER, SYSTEM, buildPrompt, checkCitations, repairPrompt } from "./prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_QUESTION = 400;
const TIMEOUT_MS = 100_000;
/** The repair round (sentences without a source) may take this long; otherwise the first answer stands. */
const REPAIR_MS = 60_000;

let provider: AgentSdkProvider | undefined;

const json = (body: AskResponse, status = 200) => Response.json(body, { status });

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const knownKeys = (m: AskMaterial) => new Set(["L0", ...m.mapPoints.map((p) => p.key), ...m.arguments.map((a) => a.key)]);

function respond(m: AskMaterial, question: string, answer: string, started: number): AskResponse {
  const checked = checkCitations(answer, knownKeys(m));
  const nothing = checked.citations.length === 0;
  const cited = new Set(checked.citations);
  return {
    ok: true,
    question,
    answer: nothing ? NO_ANSWER : checked.answer,
    nothing,
    citations: nothing ? [] : checked.citations,
    points: m.mapPoints
      .filter((p) => cited.has(p.key))
      .map((p) => ({ key: p.key, id: p.id, label: p.label, text: p.text, question: p.question, diag: p.diag, typ: p.typ, scope: p.scope })),
    arguments: m.arguments
      .filter((a) => cited.has(a.key))
      .map((a) => ({
        key: a.key,
        label: a.label,
        summary: a.summary,
        sources: a.sources,
        mapPointId: a.mapPointId,
        mapPointKey: a.mapPointKey,
        mapPointLabel: a.mapPointLabel,
      })),
    searched: {
      mapPoints: m.totals.mapPoints,
      arguments: m.totals.arguments,
      foundPoints: m.mapPoints.length,
      foundArguments: m.arguments.length,
      orgs: m.orgs.map((o) => ({ name: o.name, submissionId: o.submissionId })),
      focus: m.focus,
    },
    whole: {
      mapPoints: m.totals.mapPoints,
      byDiag: m.byDiag,
      camps: m.camps.map((c) => ({ name: c.name, orgs: c.orgs })),
      words: m.words,
      orgs: m.orgs.map((o) => {
        const cov = m.coverage.find((c) => c.submissionId === o.submissionId);
        return { name: o.name, total: cov?.total ?? 0, onTopic: cov?.onTopic ? cov.onTopic.length : null };
      }),
    },
    dropped: checked.dropped,
    ms: Date.now() - started,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const started = Date.now();
  const { ref } = await params;

  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  } catch {
    return json({ ok: false, error: "Die Anfrage war unvollständig. Bitte stellen Sie die Frage noch einmal." }, 400);
  }
  if (question.length < 3) return json({ ok: false, error: "Bitte schreiben Sie eine Frage in das Feld." }, 400);
  if (question.length > MAX_QUESTION) {
    return json({ ok: false, error: `Die Frage ist zu lang. Bitte fassen Sie sie in höchstens ${MAX_QUESTION} Zeichen.` }, 400);
  }

  let material: AskMaterial;
  let title: string;
  try {
    const db = getDb();
    const c = await findConsultation(db, ref);
    if (!c) return json({ ok: false, error: "Diese Anhörung gibt es nicht." }, 404);
    title = c.title;
    material = await askMaterial(db, c.id, question);
  } catch (e) {
    console.error("[fragen] retrieval failed", e);
    return json(
      { ok: false, error: "Die Landkarte konnte nicht durchsucht werden, weil die Datenbank nicht geantwortet hat. Bitte versuchen Sie es in einem Moment noch einmal." },
      503,
    );
  }

  // Nothing found: no model call, the plain answer.
  if (material.mapPoints.length === 0 && material.arguments.length === 0) {
    return json(respond(material, question, NO_ANSWER, started));
  }

  try {
    provider ??= new AgentSdkProvider();
    const prompt = buildPrompt(material, title);
    const result = await withTimeout(
      provider.generateStructured<{ answer: string; citations: string[] }>({ system: SYSTEM, prompt, schema: ANSWER_SCHEMA }),
      TIMEOUT_MS,
    );
    let answer = typeof result.output?.answer === "string" ? result.output.answer : "";

    // One repair round: sentences without a source get their keys, or go.
    const draft = checkCitations(answer, knownKeys(material));
    const missing = draft.citations.length ? uncitedSentences(draft.answer) : [];
    if (missing.length) {
      try {
        const fixed = await withTimeout(
          provider.generateStructured<{ answer: string; citations: string[] }>({
            system: SYSTEM,
            prompt: repairPrompt(prompt, draft.answer, missing),
            schema: ANSWER_SCHEMA,
          }),
          REPAIR_MS,
        );
        const next = typeof fixed.output?.answer === "string" ? fixed.output.answer : "";
        const checked = checkCitations(next, knownKeys(material));
        if (checked.citations.length && uncitedSentences(checked.answer).length < missing.length) answer = next;
      } catch (e) {
        console.error("[fragen] repair round failed, keeping the first answer", e);
      }
    }
    return json(respond(material, question, answer, started));
  } catch (e) {
    console.error("[fragen] answer failed", e);
    const slow = e instanceof Error && /timeout/.test(e.message);
    return json(
      {
        ok: false,
        error: slow
          ? "Das Sprachmodell hat nicht rechtzeitig geantwortet. Die Suche in der Landkarte hat funktioniert; bitte stellen Sie die Frage noch einmal."
          : "Das Sprachmodell konnte keine Antwort formulieren. Bitte stellen Sie die Frage noch einmal; oft klappt es beim zweiten Versuch.",
      },
      502,
    );
  }
}
