/**
 * exp/jev step 6 — quotes.
 *
 *   --what spans      1. deterministic: locate every unlocated quote with the
 *                        normalizing locator and store its span (pure
 *                        provenance repair — no displayed text changes);
 *                     2. Jev: for quotes that are paraphrases, pick the
 *                        verbatim source passage; with --apply the passage
 *                        replaces the paraphrase (+ span).
 *   --what landkarte  Jev ranks the members' quotes per map point; with
 *                     --apply the best (>= "clearly supports", one per
 *                     organisation, max 3) replace map_points.quotes (with
 *                     their submission, so diagnose-map can add the camp).
 *                     --widen extends quotes to full source sentences.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/jev-quotes.ts \
 *     --consultation <ref> --what spans|landkarte [--apply] [--concurrency 8]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import {
  EVIDENCE_FAMILY_QUOTES,
  EVIDENCE_MIN,
  SOURCE_FAMILY,
  SOURCE_MIN_CONFIDENCE,
  evidenceRequest,
  sourceCandidates,
  sourceRequest,
} from "../src/jev-quotes.ts";
import { textSimilarity } from "../src/jev-match.ts";
import { judgeAll, resolveConsultation, saveJudgment, statsLine } from "../src/jev-stage.ts";
import { displayQuote, enclosingSentences, locateQuote } from "../src/quote-span.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const what = arg("what");
  if (what !== "spans" && what !== "landkarte") throw new Error("--what spans|landkarte required");
  const apply = process.argv.includes("--apply");
  const concurrency = Number(arg("concurrency") ?? 8);

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const judge = new JevJudge();
  const subRes = await db.execute(sql`SELECT id, text FROM submissions WHERE consultation_id = ${cons.id} AND text IS NOT NULL`);
  const subText = new Map((subRes.rows as { id: string; text: string }[]).map((s) => [s.id, s.text]));
  const report: Record<string, unknown> = { consultation: ref, what, apply };

  if (what === "spans") {
    const res = await db.execute(sql`
      SELECT ps.id, ps.quote, ps.submission_id, p.label, p.summary
      FROM point_sources ps JOIN points p ON p.id = ps.point_id
      WHERE p.consultation_id = ${cons.id} AND ps.span_start IS NULL AND ps.quote IS NOT NULL
    `);
    const rows = res.rows as { id: string; quote: string; submission_id: string; label: string; summary: string | null }[];
    const byMatch: Record<string, number> = { normalized: 0, alnum: 0, exact: 0 };
    const unresolved: typeof rows = [];
    for (const r of rows) {
      const text = subText.get(r.submission_id);
      const span = text ? locateQuote(text, r.quote) : null;
      if (!span) {
        if (text) unresolved.push(r);
        continue;
      }
      byMatch[span.match]!++;
      await db.execute(sql`UPDATE point_sources SET span_start = ${span.start}, span_end = ${span.end} WHERE id = ${r.id}`);
    }
    console.log(
      `${rows.length} quotes without span → located ${byMatch.exact! + byMatch.normalized! + byMatch.alnum!} ` +
        `(normalized ${byMatch.normalized}, alnum ${byMatch.alnum}) · paraphrases left: ${unresolved.length}`,
    );

    const picks: unknown[] = [];
    let replaced = 0;
    const stats = await judgeAll(
      judge,
      unresolved,
      (r) => {
        const cands = sourceCandidates(subText.get(r.submission_id)!, r.quote);
        return cands.length ? sourceRequest({ label: r.label, summary: r.summary }, r.quote, cands) : null;
      },
      async (r, answers, provenance) => {
        const text = subText.get(r.submission_id)!;
        const cands = sourceCandidates(text, r.quote);
        const a = answers.source as { choice: string; confidence: number };
        const chosen = a.choice === "none" ? null : cands[Number(a.choice.slice(1)) - 1]!;
        const accept = !!chosen && a.confidence >= SOURCE_MIN_CONFIDENCE;
        await saveJudgment(db, {
          tenantId: cons.tenantId,
          consultationId: cons.id,
          subjectKind: "point_source",
          subjectId: r.id,
          family: SOURCE_FAMILY,
          provenance,
          answers,
          decided: { accept, start: chosen?.start ?? null, end: chosen?.end ?? null, confidence: a.confidence },
        });
        picks.push({ quote: r.quote, source: chosen ? displayQuote(chosen.text) : null, confidence: Number(a.confidence.toFixed(3)), accept });
        if (apply && accept) {
          await db.execute(sql`
            UPDATE point_sources SET quote = ${displayQuote(chosen!.text)}, span_start = ${chosen!.start}, span_end = ${chosen!.end}
            WHERE id = ${r.id}
          `);
          replaced++;
        }
      },
      concurrency,
    );
    if (unresolved.length) console.log(`\n${statsLine(stats)} · accepted ${picks.filter((p) => (p as { accept: boolean }).accept).length}/${picks.length} · replaced ${replaced}`);
    report.spans = { located: byMatch, picks };
  }

  if (what === "landkarte") {
    const mpRes = await db.execute(sql`
      SELECT id, scope, label, text, quotes FROM map_points
      WHERE consultation_id = ${cons.id} AND typ <> 'luecke'
    `);
    const mps = mpRes.rows as { id: string; scope: string; label: string; text: string; quotes: { quelle: string; text: string }[] | null }[];
    const srcRes = await db.execute(sql`
      SELECT p.map_point_id, ps.quote, ps.span_start, ps.span_end, ps.submission_id, s.author_org
      FROM point_sources ps JOIN points p ON p.id = ps.point_id JOIN submissions s ON s.id = ps.submission_id
      WHERE p.consultation_id = ${cons.id} AND p.map_point_id IS NOT NULL AND ps.quote IS NOT NULL
        AND p.status IN ('draft','released')
    `);
    type Cand = { text: string; org: string; submission: string };
    const cands = new Map<string, Cand[]>();
    // --widen: extend to the full enclosing sentence(s) of the source text —
    // only sensible on clean text; PDF text brings its debris along.
    const widen = process.argv.includes("--widen");
    for (const r of srcRes.rows as { map_point_id: string; quote: string; span_start: number | null; span_end: number | null; submission_id: string; author_org: string | null }[]) {
      const src = subText.get(r.submission_id);
      const text =
        widen && src && r.span_start !== null && r.span_end !== null
          ? enclosingSentences(src, r.span_start, r.span_end)
          : displayQuote(r.quote);
      if (text.length < 25 || text.length > 400) continue;
      const list = cands.get(r.map_point_id) ?? [];
      if (!list.some((c) => c.text === text)) list.push({ text, org: r.author_org ?? "Stellungnahme", submission: r.submission_id });
      cands.set(r.map_point_id, list);
    }
    const shortlistFor = (m: { id: string; text: string }) =>
      (cands.get(m.id) ?? [])
        .map((c) => ({ ...c, sim: textSimilarity(m.text, c.text) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 12);

    const changes: unknown[] = [];
    let applied = 0;
    let unchanged = 0;
    const stats = await judgeAll(
      judge,
      mps,
      (m) => {
        const list = shortlistFor(m);
        return list.length ? evidenceRequest(m.text, list) : null;
      },
      async (m, answers, provenance) => {
        const list = shortlistFor(m);
        const scored = list
          .map((c, i) => ({ ...c, score: (answers[`q${i + 1}`] as { score: number }).score }))
          .sort((a, b) => b.score - a.score);
        const seen = new Set<string>();
        const picked: { lager: string; quelle: string; text: string; submission: string }[] = [];
        for (const c of scored) {
          if (c.score < EVIDENCE_MIN || seen.has(c.org)) continue;
          seen.add(c.org);
          picked.push({ lager: "—", quelle: c.org, text: c.text, submission: c.submission });
          if (picked.length >= 3) break;
        }
        await saveJudgment(db, {
          tenantId: cons.tenantId,
          consultationId: cons.id,
          subjectKind: "map_point",
          subjectId: m.id,
          family: EVIDENCE_FAMILY_QUOTES,
          provenance,
          answers,
          decided: { picked, scores: scored.map((c) => ({ text: c.text.slice(0, 80), org: c.org, score: Number(c.score.toFixed(2)) })) },
        });
        const before = (m.quotes ?? []).map((q) => q.text);
        const after = picked.map((q) => q.text);
        if (JSON.stringify(before) === JSON.stringify(after)) unchanged++;
        else changes.push({ scope: m.scope, claim: m.text, before, after, scores: scored.map((c) => Number(c.score.toFixed(2))) });
        if (apply) {
          await db.execute(sql`UPDATE map_points SET quotes = ${JSON.stringify(picked)} WHERE id = ${m.id}`);
          applied++;
        }
      },
      concurrency,
    );
    console.log(`\n${statsLine(stats)} · map points ${mps.length}: unchanged ${unchanged}, changed ${changes.length}, applied ${applied}${applied ? " — re-render the Landkarten" : ""}`);
    const emptyAfter = changes.filter((c) => (c as { after: string[] }).after.length === 0).length;
    console.log(`map points left without a quote (no candidate clearly supports the claim): ${emptyAfter}`);
    report.landkarte = { changes };
  }

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-quotes-${what}-${ref}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`report → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
