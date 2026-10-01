/**
 * Phase 2 of the two-phase decomposition (exp/jev): CANONICALIZATION.
 *
 * Consumes cached extractions in a fixed order (submission by submission,
 * window by window) and turns candidates into map points:
 *  - known or new? — Jev P(same) over a lexical shortlist of everything
 *    already on the map (windows stay strictly ordered: a window's snapshot
 *    contains every earlier window, never its own siblings);
 *  - the candidates are the REFINED ones (refine.ts): their Jev intake
 *    judgment (release, role, door, fact/value, slot) and any automatic
 *    repair already happened right after extraction, in parallel;
 *  - quote — "llm": the extracted quote is located in the text; "jev": Jev
 *    rates the window's sentences closest to the claim and the best one
 *    becomes the verbatim quote, with its span.
 * All Jev calls of a window run concurrently; the window's writes commit in
 * one transaction together with its canonicalized_at mark, so a crash never
 * leaves a half-applied window and a rerun resumes exactly.
 *
 * Afterwards, possible duplicates (Jev P(same) between 0.2 and 0.5) get a
 * second opinion from the LLM; confirmed duplicates are merged (sources move
 * to the earlier point, the later one is marked merged).
 */

import {
  and,
  eq,
  matchDecisions,
  ne,
  points,
  pointSources,
  sql,
  type Db,
} from "@policy/db";
import type { JevJudge, JudgeProvenance, LlmProvider } from "@policy/llm";

import type { PlannedWindow, QuoteMode } from "./extract.ts";
import { INTAKE_FAMILY } from "./intake.ts";
import { jevMatch, shortlist, textSimilarity, type JevMatchVerdict } from "./jev-match.ts";
import { EVIDENCE_MIN, evidenceRequest } from "./jev-quotes.ts";
import { runPool } from "./pool.ts";
import { MATCH_SYSTEM, matchPrompt } from "./prompts.ts";
import { REFINE_POLICY, type RefinedCandidate } from "./refine.ts";
import { displayQuote, locateQuote, sentences } from "./quote-span.ts";
import { matchJsonSchema, matchOutput } from "./schemas.ts";

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
  candidate: RefinedCandidate;
  match: JevMatchVerdict | null;
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
      SELECT id, refined, provenance, canonicalized_at FROM extractions
      WHERE submission_id = ${w.submissionId} AND window_index = ${w.index} AND call_hash = ${w.hash}
    `);
    const ex = exRes.rows[0] as
      | {
          id: string;
          refined: { policy?: string; candidates: RefinedCandidate[] } | null;
          provenance: Record<string, unknown>;
          canonicalized_at: string | null;
        }
      | undefined;
    if (!ex) throw new Error(`window ${w.index + 1}/${w.count} of submission ${w.submissionId} not extracted yet — run the extract phase`);
    if (!ex.refined) throw new Error(`window ${w.index + 1}/${w.count} of submission ${w.submissionId} not refined yet — run the extract phase`);
    if (ex.refined.policy !== REFINE_POLICY) {
      throw new Error(
        `window ${w.index + 1}/${w.count} of submission ${w.submissionId} was refined under ${ex.refined.policy}, ` +
          `the pipeline expects ${REFINE_POLICY} — run the extract phase (and reset first if it was canonicalized)`,
      );
    }
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
          // Held-back points (unresolved personal data) never absorb others.
          eq(points.status, "released"),
          ne(points.createdBy, "import:questionnaire"),
        ),
      )
      .orderBy(points.createdAt);

    const candidates = ex.refined.candidates;
    const judged: Judged[] = new Array(candidates.length);
    const pool = await runPool(
      candidates,
      async (c, i) => {
        const point = { label: c.label, summary: c.summary };
        // Only released candidates enter the public map by matching: a
        // rejected one is recorded only, a held-back one (unresolved personal
        // data) stays its own draft point — its quote must not reach a
        // released point through a match.
        const live = c.status === "released";
        const [match, quote] = await Promise.all([
          live && existing.length > 0
            ? withRetry(() => jevMatch(judge, { consultationTitle: consultation.title }, point, shortlist(point, existing)))
            : Promise.resolve(null),
          quotes === "llm"
            ? Promise.resolve(locatedQuote(text, c.quote ?? ""))
            : withRetry(() => pickQuote(judge, `${c.label}. ${c.summary}`, c.summary, windowSentences)),
        ]);
        stats.jevTokens += (match?.provenance.inputTokens ?? 0) + (quote.provenance?.inputTokens ?? 0);
        judged[i] = { candidate: c, match, quote };
      },
      10,
      { label: (c) => `candidate "${c.label}" (window ${w.index + 1}/${w.count} of ${w.submissionId.slice(0, 8)})` },
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
        const { candidate, match, quote } = j;
        const intake = candidate.intake;
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
          const status = candidate.status;
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
              status,
              createdBy: method,
            })
            .returning({ id: points.id });
          pointId = inserted!.id;
          counts.created++;
          if (status === "released") stats.released++;
          else if (status === "rejected") stats.rejected++;
          else stats.review++;
          await saveJudgmentTx(
            txDb,
            consultation,
            "point",
            pointId,
            INTAKE_FAMILY,
            { model: intake.model, requestId: intake.requestId },
            intake.answers,
            { ...d, status, origin: candidate.origin },
          );
          const flags = [...d.flags, ...(review ? [review] : []), ...(quote.flag ? [quote.flag] : [])];
          const action =
            status === "released" ? "point.release" : status === "rejected" ? "point.reject" : "point.needs_review";
          await tx.execute(sql`
            INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, reason, payload)
            VALUES (${consultation.tenantId}, ${`jev:${intake.model}`}, ${action},
                    'point', ${pointId}, ${flags.join(", ") || null},
                    ${JSON.stringify({ origin: candidate.origin })})
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
          method: match ? method : candidate.status === "rejected" ? "refine:rejected" : "auto:first-points",
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
            createdPoint: match?.outcome === "matched" ? undefined : pointId,
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

/**
 * Second opinion on possible duplicates: every new point that Jev placed in
 * the review band (P(same) 0.2–0.5) is put to the LLM matcher against its
 * closest existing point. Confirmed duplicates merge into the earlier point.
 */
export async function resolvePossibleDuplicates(
  db: Db,
  provider: LlmProvider,
  consultation: { id: string; tenantId: string },
  concurrency: number,
  log: (line: string) => void = console.log,
): Promise<{ checked: number; merged: number; failed: number }> {
  // Pending = no second opinion yet — whatever happened to the two points
  // since (an earlier merge may have moved either; roots are resolved when
  // the verdict is applied). The judgment uses the original texts.
  const res = await db.execute(sql`
    SELECT p.id, p.label, p.summary, q.id AS q_id, q.label AS q_label, q.summary AS q_summary, md.id AS md_id
    FROM match_decisions md
    JOIN points p ON p.id = (md.provenance->>'createdPoint')::uuid
    JOIN points q ON q.id = (md.provenance->'match'->>'reviewCandidate')::uuid
    WHERE md.consultation_id = ${consultation.id} AND md.provenance->>'review' = 'possible_duplicate'
      AND md.provenance->>'second_opinion' IS NULL AND p.id <> q.id
    ORDER BY md.created_at, md.id
  `);
  const cases = res.rows as { id: string; label: string; summary: string | null; q_id: string; q_label: string; q_summary: string | null; md_id: string }[];

  // 1. Judgments in parallel — no writes yet.
  const verdicts = new Map<string, { same: boolean; confidence: number; model: string }>();
  const pool = await runPool(
    cases,
    async (c) => {
      const r = await provider.generateStructured({
        system: MATCH_SYSTEM,
        prompt: matchPrompt({ label: c.label, summary: c.summary ?? "" }, [{ label: c.q_label, summary: c.q_summary }]),
        schema: matchJsonSchema,
      });
      const d = matchOutput.parse(r.output);
      verdicts.set(c.md_id, { same: d.decision === "matched" && d.matched_index === 0, confidence: d.confidence, model: r.provenance.model });
    },
    concurrency,
    { label: (c) => `duplicate check "${c.label}" ~ "${c.q_label}"`, progress: "duplicate checks" },
  );

  // 2. Merges applied one after another, in decision order, each against the
  // CURRENT live root of both points (an earlier merge may have moved either).
  const root = async (id: string): Promise<{ id: string; status: string }> => {
    for (let cur = id, hops = 0; hops < 50; hops++) {
      const r = (await db.execute(sql`SELECT status, merged_into FROM points WHERE id = ${cur}`)).rows[0] as
        | { status: string; merged_into: string | null }
        | undefined;
      if (!r) return { id: cur, status: "missing" };
      if (r.status !== "merged" || !r.merged_into) return { id: cur, status: r.status };
      cur = r.merged_into;
    }
    throw new Error(`merge chain from ${id} does not end`);
  };
  let merged = 0;
  for (const c of cases) {
    const v = verdicts.get(c.md_id);
    if (!v) continue; // failed judgment: stays pending for the next run
    await db.transaction(async (tx) => {
      let applied = "no merge (different)";
      if (v.same) {
        const rf = await root(c.id);
        const ri = await root(c.q_id);
        const from = rf.id;
        const into = ri.id;
        // Only two RELEASED points merge — never into or out of a held-back,
        // rejected, or missing one.
        if (from === into) applied = "already merged";
        else if (rf.status !== "released" || ri.status !== "released") applied = `skipped (${rf.status} → ${ri.status})`;
        if (from !== into && rf.status === "released" && ri.status === "released") {
          applied = "merged";
          // Sources the target does not have yet move over; exact duplicates stay behind.
          await tx.execute(sql`
            UPDATE point_sources ps SET point_id = ${into}
            WHERE ps.point_id = ${from} AND NOT EXISTS (
              SELECT 1 FROM point_sources o WHERE o.point_id = ${into} AND o.submission_id = ps.submission_id
                AND o.quote IS NOT DISTINCT FROM ps.quote)
          `);
          await tx.execute(sql`UPDATE points SET status = 'merged', merged_into = ${into} WHERE id = ${from}`);
          await tx.execute(sql`UPDATE points SET merged_into = ${into} WHERE merged_into = ${from}`);
          await tx.execute(sql`
            INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
            VALUES (${consultation.tenantId}, ${`ai-editor:${v.model}`}, 'point.merge', 'point', ${from},
                    ${JSON.stringify({ into, decidedFor: { point: c.id, candidate: c.q_id }, confidence: v.confidence, reason: "possible_duplicate second opinion" })})
          `);
          merged++;
        }
      }
      await tx.execute(sql`
        UPDATE match_decisions SET provenance = provenance || ${JSON.stringify({
          second_opinion: { same: v.same, confidence: v.confidence, model: v.model, applied },
        })}::jsonb WHERE id = ${c.md_id}
      `);
    });
  }
  log(`possible duplicates: ${cases.length} to check · ${verdicts.size} judged by the LLM · ${merged} merged · ${pool.failed} failed`);
  return { checked: verdicts.size, merged, failed: pool.failed };
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
  provenance: { model: string; requestId?: string | null },
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
