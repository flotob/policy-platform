/**
 * Pipeline health report for one consultation — run after every stage of a
 * test run. Checks invariants (hard failures → exit 1) and prints the
 * numbers a person needs to judge the run. Stages that have not run yet are
 * reported as "not yet", not as failures.
 *
 * Usage: DATABASE_URL=... tsx scripts/check-run.ts --consultation <ref>
 */

import { createDb, sql } from "@policy/db";

import { resolveConsultation } from "../src/jev-stage.ts";
import { displayQuote } from "../src/quote-span.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];
  const failures: string[] = [];
  const warnings: string[] = [];
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const dbName = (await q<{ d: string }>(sql`SELECT current_database() AS d`))[0]!.d;
  console.log(`━━━ ${cons.title} · database ${dbName}`);

  // ── Extraction ──
  const ex = (await q<{ n: number; done: number; calls_min: number; max_s: number; subs: number }>(sql`
    SELECT count(*)::int n, count(canonicalized_at)::int done, count(DISTINCT submission_id)::int subs,
      coalesce(round(sum((provenance->>'durationMs')::numeric) / 60000, 1), 0)::float calls_min,
      coalesce(round(max((provenance->>'durationMs')::numeric) / 1000), 0)::int max_s
    FROM extractions WHERE consultation_id = ${cons.id}`))[0]!;
  if (ex.n === 0) console.log("extraction: not yet");
  else {
    console.log(`extraction: ${ex.n} windows from ${ex.subs} submissions, ${ex.done} canonicalized · LLM ${ex.calls_min} min total, slowest ${ex.max_s}s`);
    if (ex.done < ex.n) warnings.push(`${ex.n - ex.done} extracted windows not canonicalized`);
  }

  // ── Points ──
  const pts = await q<{ status: string; kind: string; n: number }>(sql`
    SELECT status, kind, count(*)::int n FROM points
    WHERE consultation_id = ${cons.id} AND created_by <> 'import:questionnaire' GROUP BY 1, 2`);
  const total = pts.reduce((s, r) => s + r.n, 0);
  if (total === 0) console.log("points: not yet");
  else {
    const by = (key: "status" | "kind") => {
      const m = new Map<string, number>();
      for (const r of pts) m.set(r[key], (m.get(r[key]) ?? 0) + r.n);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
    };
    console.log(`points: ${total} · status ${by("status")} · kind ${by("kind")}`);
    const orphan = (await q<{ n: number }>(sql`
      SELECT count(*)::int n FROM points p WHERE p.consultation_id = ${cons.id} AND p.created_by <> 'import:questionnaire'
        AND NOT EXISTS (SELECT 1 FROM point_sources ps WHERE ps.point_id = p.id)`))[0]!.n;
    if (orphan) failures.push(`${orphan} points without any source`);
    if (ex.n > 0) {
      const noIntake = (await q<{ n: number }>(sql`
        SELECT count(*)::int n FROM points p WHERE p.consultation_id = ${cons.id} AND p.created_by <> 'import:questionnaire'
          AND NOT EXISTS (SELECT 1 FROM judgments j WHERE j.subject_kind = 'point' AND j.subject_id = p.id::text AND j.family = 'intake.v1')`))[0]!.n;
      if (noIntake) failures.push(`${noIntake} points without intake judgment`);
    }
    const dupLabels = (await q<{ n: number }>(sql`
      SELECT count(*)::int n FROM (SELECT lower(label) FROM points WHERE consultation_id = ${cons.id}
        AND status IN ('draft','released') GROUP BY 1 HAVING count(*) > 1) d`))[0]!.n;
    if (dupLabels) warnings.push(`${dupLabels} labels occur more than once`);
    const flags = await q<{ reason: string; n: number }>(sql`
      SELECT trim(f) reason, count(*)::int n FROM audit_log a, unnest(string_to_array(a.reason, ',')) f
      WHERE a.action IN ('point.needs_review','point.release','point.reject') AND a.subject_kind = 'point'
        AND a.actor LIKE 'jev:%'
        AND a.subject_id IN (SELECT id::text FROM points WHERE consultation_id = ${cons.id})
      GROUP BY 1 ORDER BY 2 DESC`);
    if (flags.length) console.log(`  editor flags: ${flags.map((f) => `${f.reason} ${f.n}`).join(" · ")}`);
    const md = (await q<{ n: number; matched: number; review: number }>(sql`
      SELECT count(*)::int n, count(*) FILTER (WHERE outcome = 'matched')::int matched,
        count(*) FILTER (WHERE provenance->>'review' = 'possible_duplicate')::int review
      FROM match_decisions WHERE consultation_id = ${cons.id}`))[0]!;
    console.log(`  match decisions: ${md.n} · matched ${md.matched} (${pct(md.matched, md.n)}) · possible duplicates ${md.review}`);
  }

  // ── Quotes: verbatim at their span ──
  const srcs = await q<{ quote: string | null; span_start: number | null; span_end: number | null; text: string }>(sql`
    SELECT ps.quote, ps.span_start, ps.span_end, s.text FROM point_sources ps
    JOIN points p ON p.id = ps.point_id JOIN submissions s ON s.id = ps.submission_id
    WHERE p.consultation_id = ${cons.id} AND p.created_by <> 'import:questionnaire'`);
  if (srcs.length) {
    let noQuote = 0;
    let noSpan = 0;
    let mismatch = 0;
    let long = 0;
    for (const s of srcs) {
      if (!s.quote) {
        noQuote++;
        continue;
      }
      if (s.quote.length > 400) long++;
      if (s.span_start === null || s.span_end === null) {
        noSpan++;
        continue;
      }
      // Same tolerance as locateQuote: case, punctuation, hyphenation, whitespace.
      const norm = (t: string) => displayQuote(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (norm(s.text.slice(s.span_start, s.span_end)) !== norm(s.quote)) mismatch++;
    }
    console.log(
      `quotes: ${srcs.length} sources · without quote ${noQuote} · without span ${noSpan} · ` +
        `longer than 400 chars ${long} · verbatim at span ${srcs.length - noQuote - noSpan - mismatch}/${srcs.length - noQuote - noSpan}`,
    );
    if (mismatch) failures.push(`${mismatch} quotes differ from the text at their span`);
  }

  // ── Structure ──
  const st = (await q<{ live: number; measure: number; theme: number; mapped: number; nongap: number }>(sql`
    SELECT count(*)::int live, count(measure)::int measure, count(theme)::int theme,
      count(map_point_id)::int mapped, count(*) FILTER (WHERE kind <> 'gap')::int nongap
    FROM points WHERE consultation_id = ${cons.id} AND status IN ('draft','released') AND created_by <> 'import:questionnaire'`))[0]!;
  if (st.live && (st.measure || st.mapped)) {
    console.log(`structure: measure ${pct(st.measure, st.live)} · theme ${pct(st.theme, st.live)} · on a map point ${st.mapped}/${st.nongap} (${pct(st.mapped, st.nongap)})`);
  } else console.log("structure: not yet");

  const mps = await q<{ scope: string; typ: string; bezirk: string; diag: string | null; n_voted: number; befund: string | null }>(sql`
    SELECT scope, typ, bezirk, diag, n_voted, befund FROM map_points WHERE consultation_id = ${cons.id}`);
  if (mps.length === 0) console.log("map points: not yet");
  else {
    const scopes = new Map<string, number>();
    for (const m of mps) scopes.set(m.scope, (scopes.get(m.scope) ?? 0) + 1);
    console.log(`map points: ${mps.length} in ${scopes.size} measures (${[...scopes.values()].join("/")})`);
    const bad = mps.filter(
      (m) =>
        (m.typ === "W" && m.bezirk !== "wert") ||
        (m.typ === "verfahren" && m.bezirk !== "ausgestaltung") ||
        (m.typ === "T" && (m.bezirk === "wert" || m.bezirk === "ausgestaltung")),
    ).length;
    if (bad) failures.push(`${bad} map points with typ/district mismatch`);
    const diagnosed = mps.filter((m) => m.diag);
    if (diagnosed.length) {
      const dist = new Map<string, number>();
      for (const m of diagnosed) dist.set(m.diag!, (dist.get(m.diag!) ?? 0) + 1);
      const nonGap = mps.filter((m) => m.typ !== "luecke");
      const noVotes = nonGap.filter((m) => m.n_voted === 0).length;
      console.log(
        `diagnosis: ${[...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")} · ` +
          `map points without votes ${noVotes}/${nonGap.length} (${pct(noVotes, nonGap.length)})`,
      );
      const noBefund = diagnosed.filter((m) => !m.befund).length;
      if (noBefund) warnings.push(`${noBefund} diagnosed map points without Befund`);
    } else console.log("diagnosis: not yet");
  }

  // ── Votes ──
  const v = (await q<{ votes: number; participants: number; inferred: number }>(sql`
    SELECT count(*)::int votes, count(DISTINCT v.participant_id)::int participants,
      count(*) FILTER (WHERE v.method = 'inferred')::int inferred
    FROM votes v JOIN participants pa ON pa.id = v.participant_id WHERE pa.consultation_id = ${cons.id}`))[0]!;
  console.log(v.votes ? `votes: ${v.votes} from ${v.participants} participants (${v.inferred} inferred)` : "votes: not yet");

  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.log(failures.length ? `━━━ ${failures.length} failure(s)` : "━━━ all invariants hold");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
