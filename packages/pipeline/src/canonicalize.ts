/**
 * Phase 2 of the two-phase decomposition (exp/jev): CANONICALIZATION.
 *
 * Consumes cached extractions in a fixed order (submission by submission,
 * window by window) and turns candidates into map points:
 *  - known or new? — Jev P(same) over a lexical shortlist of everything
 *    already on the map (windows stay strictly ordered: a window's snapshot
 *    contains every earlier window, never its own siblings);
 *  - intake — one Jev request per NEW point decides release, role, door,
 *    fact/value and slot (asked speculatively for every candidate in
 *    parallel with the match; answers for matched candidates are dropped);
 *  - quote — "llm": the extracted quote is located in the text; "jev": Jev
 *    rates the window's sentences closest to the claim and the best one
 *    becomes the verbatim quote, with its span.
 * All Jev calls of a window run concurrently; the window's writes commit in
 * one transaction together with its canonicalized_at mark, so a crash never
 * leaves a half-applied window and a rerun resumes exactly.
 */

import {
  and,
  eq,
  inArray,
  matchDecisions,
  ne,
  points,
  pointSources,
  sql,
  type Db,
} from "@policy/db";
import type { JevJudge, JudgeProvenance } from "@policy/llm";

import type { PlannedWindow, QuoteMode } from "./extract.ts";
import { decideIntake, INTAKE_FAMILY, intakeRequest, type IntakeDecision } from "./intake.ts";
import { jevMatch, shortlist, textSimilarity, type JevMatchVerdict } from "./jev-match.ts";
import { EVIDENCE_MIN, evidenceRequest } from "./jev-quotes.ts";
import { runPool } from "./pool.ts";
import { displayQuote, locateQuote, sentences } from "./quote-span.ts";
import type { ExtractedPoint } from "./schemas.ts";

export const QUOTE_PICK_FAMILY = "quote-pick.v1";
/** Window sentences offered to Jev per point (lexical shortlist). */
export const QUOTE_SHORTLIST = 12;
/** Longer "sentences" are PDF run-ons, not quotable. */
export const QUOTE_MAX_CHARS = 500;
/** Below this expected evidence level no quote is shown ("related" at best). */
export const QUOTE_FLOOR = 1;

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 600 * 2 ** i));
    }
  }
}

interface QuotePick {
  quote: string | null;
  start: number | null;
  end: number | null;
  score: number | null;
  flag?: "weak_evidence" | "no_evidence" | "not_located";
  answers?: unknown;
  provenance?: JudgeProvenance;
}

interface Judged {
  candidate: ExtractedPoint;
  match: JevMatchVerdict | null;
  intake: { decision: IntakeDecision; answers: unknown; provenance: JudgeProvenance };
  quote: QuotePick;
}

export interface CanonicalizeStats {
  windows: number;
  skipped: number;
  candidates: number;
  created: number;
  matched: number;
  released: number;
  rejected: number;
  review: number;
  possibleDuplicates: number;
  noQuote: number;
  jevTokens: number;
  wallMs: number;
}

export async function canonicalize(
  db: Db,
  judge: JevJudge,
  consultation: { id: string; tenantId: string; title: string },
  windows: PlannedWindow[],
  quotes: QuoteMode,
  log: (line: string) => void = console.log,
): Promise<CanonicalizeStats> {
  const started = Date.now();
  const stats: CanonicalizeStats = {
    windows: windows.length,
    skipped: 0,
    candidates: 0,
    created: 0,
    matched: 0,
    released: 0,
    rejected: 0,
    review: 0,
    possibleDuplicates: 0,
    noQuote: 0,
    jevTokens: 0,
    wallMs: 0,
  };
  const textCache = new Map<string, string>();
  const sentenceCache = new Map<string, ReturnType<typeof sentences>>();

  for (const w of windows) {
    const exRes = await db.execute(sql`
      SELECT id, output, provenance, canonicalized_at FROM extractions
      WHERE submission_id = ${w.submissionId} AND window_index = ${w.index} AND call_hash = ${w.hash}
    `);
    const ex = exRes.rows[0] as
      | { id: string; output: { points: ExtractedPoint[] }; provenance: Record<string, unknown>; canonicalized_at: string | null }
      | undefined;
    if (!ex) throw new Error(`window ${w.index + 1}/${w.count} of submission ${w.submissionId} not extracted yet — run the extract phase`);
    if (ex.canonicalized_at) {
      stats.skipped++;
      continue;
    }

    if (!textCache.has(w.submissionId)) {
      const t = await db.execute(sql`SELECT text FROM submissions WHERE id = ${w.submissionId}`);
      const text = (t.rows[0] as { text: string }).text;
      textCache.set(w.submissionId, text);
      sentenceCache.set(w.submissionId, sentences(text));
    }
    const text = textCache.get(w.submissionId)!;
    const windowSentences = sentenceCache
      .get(w.submissionId)!
      .filter((s) => s.start >= w.start && s.end <= w.end && s.text.length <= QUOTE_MAX_CHARS);

    // Snapshot of the map BEFORE this window (siblings never match each other).
    const existing = await db
      .select({ id: points.id, label: points.label, summary: points.summary })
      .from(points)
      .where(
        and(
          eq(points.consultationId, consultation.id),
          inArray(points.status, ["draft", "released"]),
          ne(points.createdBy, "import:questionnaire"),
        ),
      )
      .orderBy(points.createdAt);

    const candidates = ex.output.points;
    const judged: Judged[] = new Array(candidates.length);
    const pool = await runPool(
      candidates,
      async (c, i) => {
        const point = { label: c.label, summary: c.summary };
        const [match, intake, quote] = await Promise.all([
          existing.length > 0
            ? withRetry(() => jevMatch(judge, { consultationTitle: consultation.title }, point, shortlist(point, existing)))
            : Promise.resolve(null),
          withRetry(async () => {
            const req = intakeRequest(consultation.title, point);
            const { answers, provenance } = await judge.judge(req.state, req.questions);
            return { decision: decideIntake(answers as Record<string, unknown>), answers, provenance };
          }),
          quotes === "llm"
            ? Promise.resolve(locatedQuote(text, c.quote ?? ""))
            : withRetry(() => pickQuote(judge, `${c.label}. ${c.summary}`, c.summary, windowSentences)),
        ]);
        stats.jevTokens +=
          (match?.provenance.inputTokens ?? 0) + intake.provenance.inputTokens + (quote.provenance?.inputTokens ?? 0);
        judged[i] = { candidate: c, match, intake, quote };
      },
      10,
    );
    if (pool.failed > 0) {
      throw new Error(`window ${w.index + 1}/${w.count} of submission ${w.submissionId}: ${pool.failed} Jev judgments failed — rerun resumes here`);
    }

    const extraction = ex.provenance as { provider?: string; model?: string };
    const method = `${extraction.provider ?? "llm"}:${extraction.model ?? "unknown"}`;
    const counts = { created: 0, matched: 0 };

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      for (const j of judged) {
        const { candidate, match, intake, quote } = j;
        let pointId: string;
        let review: string | undefined;
        if (match?.outcome === "matched" && match.matchedPointId) {
          pointId = match.matchedPointId;
          counts.matched++;
        } else {
          if (match?.band === "review") {
            review = "possible_duplicate";
            stats.possibleDuplicates++;
          }
          const d = intake.decision;
          const [inserted] = await tx
            .insert(points)
            .values({
              tenantId: consultation.tenantId,
              consultationId: consultation.id,
              kind: d.kind,
              slot: d.slot,
              label: candidate.label,
              summary: candidate.summary,
              cq: d.cq,
              answersCq: d.answersCq,
              status: d.status,
              createdBy: method,
            })
            .returning({ id: points.id });
          pointId = inserted!.id;
          counts.created++;
          if (d.status === "released") stats.released++;
          else if (d.status === "rejected") stats.rejected++;
          else stats.review++;
          await saveJudgmentTx(txDb, consultation, "point", pointId, INTAKE_FAMILY, intake.provenance, intake.answers, d);
          const flags = [...d.flags, ...(review ? [review] : []), ...(quote.flag ? [quote.flag] : [])];
          await tx.execute(sql`
            INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, reason)
            VALUES (${consultation.tenantId}, ${`jev:${intake.provenance.model}`},
                    ${`point.${d.verdict === "review" ? "needs_review" : d.verdict}`},
                    'point', ${pointId}, ${flags.join(", ") || null})
          `);
        }

        if (!quote.quote) stats.noQuote++;
        const dup = await tx.execute(sql`
          SELECT 1 FROM point_sources WHERE point_id = ${pointId} AND submission_id = ${w.submissionId}
            AND quote IS NOT DISTINCT FROM ${quote.quote} LIMIT 1
        `);
        if (dup.rows.length === 0) {
          const [src] = await tx
            .insert(pointSources)
            .values({
              tenantId: consultation.tenantId,
              pointId,
              submissionId: w.submissionId,
              quote: quote.quote,
              spanStart: quote.start,
              spanEnd: quote.end,
            })
            .returning({ id: pointSources.id });
          if (quote.provenance) {
            await saveJudgmentTx(txDb, consultation, "point_source", src!.id, QUOTE_PICK_FAMILY, quote.provenance, quote.answers, {
              score: quote.score,
              flag: quote.flag ?? null,
            });
          }
        }

        await tx.insert(matchDecisions).values({
          tenantId: consultation.tenantId,
          consultationId: consultation.id,
          submissionId: w.submissionId,
          candidateLabel: candidate.label,
          candidateSummary: candidate.summary,
          outcome: match?.outcome === "matched" ? "matched" : "new",
          matchedPoint: match?.outcome === "matched" ? match.matchedPointId : null,
          confidence: match
            ? match.outcome === "matched"
              ? match.bestSameProbability
              : 1 - match.bestSameProbability
            : null,
          method: match ? method : "auto:first-points",
          provenance: {
            decomposition: ex.provenance,
            match: match
              ? {
                  ...match.provenance,
                  matcher: "jev",
                  band: match.band,
                  pSame: match.bestSameProbability,
                  bestScore: match.bestScore,
                  choicePick: match.choicePick,
                  shortlist: match.shortlistIds.length,
                  ...(review ? { reviewCandidate: match.matchedPointId } : {}),
                }
              : null,
            chunk: w.count > 1 ? { index: w.index, of: w.count } : undefined,
            extraction: ex.id,
            review,
          },
        });
      }
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
        VALUES (${consultation.tenantId}, ${method}, 'submission.canonicalize', 'submission', ${w.submissionId},
                ${JSON.stringify({ window: w.index, of: w.count, candidates: candidates.length, ...counts })})
      `);
      await tx.execute(sql`UPDATE extractions SET canonicalized_at = now() WHERE id = ${ex.id}`);
    });

    stats.candidates += candidates.length;
    stats.created += counts.created;
    stats.matched += counts.matched;
    log(
      `  window ${w.index + 1}/${w.count} of ${w.submissionId.slice(0, 8)}: ${candidates.length} candidates → ` +
        `${counts.created} new, ${counts.matched} matched (map now ${existing.length + counts.created})`,
    );
  }
  stats.wallMs = Date.now() - started;
  return stats;
}

function locatedQuote(text: string, quote: string): QuotePick {
  if (!quote) return { quote: null, start: null, end: null, score: null, flag: "no_evidence" };
  const span = locateQuote(text, quote);
  return span
    ? { quote, start: span.start, end: span.end, score: null }
    : { quote, start: null, end: null, score: null, flag: "not_located" };
}

/**
 * Select, don't generate: the window's sentences closest to the claim
 * (lexical shortlist) are rated by Jev on the 4-level evidence scale; the
 * best becomes the verbatim quote. Below QUOTE_FLOOR no sentence is shown.
 */
async function pickQuote(
  judge: JevJudge,
  claim: string,
  summary: string,
  windowSentences: { text: string; start: number; end: number }[],
): Promise<QuotePick> {
  const cands = windowSentences
    .map((s) => ({ ...s, sim: textSimilarity(claim, s.text) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, QUOTE_SHORTLIST);
  if (cands.length === 0) return { quote: null, start: null, end: null, score: null, flag: "no_evidence" };
  const req = evidenceRequest(summary, cands);
  const { answers, provenance } = await judge.judge(req.state, req.questions);
  let best = -1;
  let bestScore = -1;
  cands.forEach((_, i) => {
    const s = (answers as Record<string, { score: number }>)[`q${i + 1}`]!.score;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  const c = cands[best]!;
  if (bestScore < QUOTE_FLOOR) {
    return { quote: null, start: null, end: null, score: bestScore, flag: "no_evidence", answers, provenance };
  }
  return {
    quote: displayQuote(c.text),
    start: c.start,
    end: c.end,
    score: bestScore,
    flag: bestScore < EVIDENCE_MIN ? "weak_evidence" : undefined,
    answers,
    provenance,
  };
}

async function saveJudgmentTx(
  db: Db,
  consultation: { id: string; tenantId: string },
  subjectKind: string,
  subjectId: string,
  family: string,
  provenance: JudgeProvenance,
  answers: unknown,
  decided: unknown,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO judgments (tenant_id, consultation_id, subject_kind, subject_id, family,
                           model, request_id, answers, decided)
    VALUES (${consultation.tenantId}, ${consultation.id}, ${subjectKind}, ${subjectId}, ${family},
            ${provenance.model}, ${provenance.requestId ?? null},
            ${JSON.stringify(answers)}, ${JSON.stringify(decided)})
    ON CONFLICT (subject_kind, subject_id, family) DO UPDATE SET
      model = excluded.model, request_id = excluded.request_id,
      answers = excluded.answers, decided = excluded.decided, created_at = now()
  `);
}
