/**
 * "Frag die Landkarte" — retrieval only (no LLM here).
 *
 * A free-text question is turned into three signals:
 *   - search terms: Postgres full-text search, 'german' configuration, prefix
 *     match per stem (compounds: "Biomasse" finds "Biomasseanlagen"), plus a
 *     substring bonus for infix compounds ("Holzbiomasse");
 *   - organisations named in the question (author_org, shortOrg, acronyms);
 *   - what the question asks about on the map (Brücken, Tatsachenfragen,
 *     Wertfragen, Ausgestaltung, Lücken) — mapped to diagnoses.
 * It returns ~15 Landkarten-Punkte (keys L1…) and ~25 arguments with their
 * organisation and quote (keys A1…). The route handler hands exactly this
 * material to the language model; every key it cites must come from here.
 */

import { sql, type Db } from "@policy/db";

import { shortOrg, type Diag, type Typ } from "../vocab.ts";
import { campsOf, latestAnalysis, loadOrgs } from "./consultation.ts";
import type { Camp, CampCount, Org } from "./types.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

export const ASK_MAX_MAP_POINTS = 15;
export const ASK_MAX_ARGUMENTS = 25;

export interface AskMapPoint {
  /** Citation key: L1, L2, … */
  key: string;
  id: string;
  scope: string;
  typ: Typ;
  diag: Diag | null;
  label: string;
  question: string | null;
  text: string;
  befund: string | null;
  votes: { a: CampCount; b: CampCount } | null;
  /** Organisations (full names) that agree / disagree, inferred from their statements. */
  agree: string[];
  disagree: string[];
  /** Extraction points underneath and how many organisations said one of them. */
  members: number;
  orgs: number;
}

export interface AskSource {
  org: string;
  submissionId: string;
  quote: string | null;
}

export interface AskArgument {
  /** Citation key: A1, A2, … */
  key: string;
  id: string;
  label: string;
  summary: string | null;
  kind: "fact" | "value" | "design" | "gap";
  measure: string | null;
  mapPointId: string | null;
  /** Key of its Landkarten-Punkt when that point is part of the material. */
  mapPointKey: string | null;
  mapPointLabel: string | null;
  sources: AskSource[];
}

export type AskFocus = "bruecke" | "warnung" | "klaerbar" | "wert" | "gestaltung" | "luecke";

export interface AskMaterial {
  question: string;
  /** Stems the full-text search used (after removing organisation names and question words). */
  terms: string[];
  /** The topic words of the question as typed, only those that produced a search stem. */
  words: string[];
  /** Organisations named in the question. */
  orgs: Org[];
  /** Per named organisation: all its arguments, and (when the question has search terms) the ids of those matching them. */
  coverage: { submissionId: string; total: number; onTopic: string[] | null }[];
  /** What the question asks about on the map. */
  focus: AskFocus[];
  /** "critical" for "kritisiert/lehnt ab …", "supportive" for "unterstützt/befürwortet …". */
  stance: "critical" | "supportive" | null;
  camps: Camp[];
  allOrgs: Org[];
  totals: { mapPoints: number; arguments: number };
  /** The whole Landkarte by diagnosis (the material is only a selection). */
  byDiag: Partial<Record<Diag, number>>;
  mapPoints: AskMapPoint[];
  arguments: AskArgument[];
}

/* ---------- wire format of the answer route (POST /[ref]/fragen/antwort) ---------- */

export interface AskCitedPoint {
  key: string;
  id: string;
  label: string;
  text: string;
  question: string | null;
  diag: Diag | null;
  typ: Typ;
  scope: string;
}

export interface AskCitedArgument {
  key: string;
  label: string;
  summary: string | null;
  sources: AskSource[];
  mapPointId: string | null;
  mapPointKey: string | null;
  mapPointLabel: string | null;
}

export type AskResponse =
  | {
      ok: true;
      question: string;
      /** The answer; paragraphs separated by a blank line, citation keys in square brackets. */
      answer: string;
      /** True when the material does not answer the question (answer is then a fixed sentence). */
      nothing: boolean;
      /** Valid keys in order of first use. */
      citations: string[];
      points: AskCitedPoint[];
      arguments: AskCitedArgument[];
      searched: {
        mapPoints: number;
        arguments: number;
        foundPoints: number;
        foundArguments: number;
        orgs: { name: string; submissionId: string }[];
        focus: AskFocus[];
      };
      /** The whole Landkarte (citation key L0): counts by diagnosis and the camps. */
      whole: {
        mapPoints: number;
        byDiag: Partial<Record<Diag, number>>;
        camps: { name: string; orgs: string[] }[];
        /** The topic words of the question and, per named organisation, how many of its arguments contain them. */
        words: string[];
        orgs: { name: string; total: number; onTopic: number | null }[];
      };
      /** Keys the model cited that were not in the material (removed from the answer). */
      dropped: string[];
      ms: number;
    }
  | { ok: false; error: string };

/* ---------- question analysis ---------- */

/** Meta words about the map → diagnoses. These words are removed from the search terms. */
const FOCUS: { focus: AskFocus[]; re: RegExp }[] = [
  { focus: ["warnung"], re: /^scheinbrücke|^scheinkonsens|^scheineinig/ },
  { focus: ["bruecke", "warnung"], re: /^einig|^einver|^konsens|^brücke|^gemeinsamkeit|^übereinstimm|^unstrittig|^unstreitig|^common/ },
  { focus: ["klaerbar"], re: /^tatsache|^gutacht|^studie|^klärbar|^klären|^klärung|^faktenstreit|^fakten|^empiri|^beleg/ },
  { focus: ["wert"], re: /^wertfrage|^wertung|^kernkonflikt|^grundsatz|^umstritten|^streit$|^streiten|^streitfrage|^konflikt|^uneinig|^gespalten|^trennt|^spaltet|^dissens/ },
  { focus: ["gestaltung"], re: /^ausgestaltung|^verhandl|^kompromiss/ },
  { focus: ["luecke"], re: /^lücke|^übersehen|^blinde|^niemand/ },
];

const CRITICAL = /^kritis|^kritik|^ablehn|^lehnt|^bemängel|^warnt|^warnen|^einw[äa]nd|^bedenken|^gegen$|^zweifel|^bezweifel|^moniert|^beanstand/;
const SUPPORTIVE = /^unterstütz|^befürwort|^begrüß|^zustimm|^stimmt|^dafür$|^lob|^positiv/;

/** Question words and verbs that carry no topic. */
const GENERIC = new Set(
  (
    "was wer wie wo wann warum wieso weshalb welche welcher welches welchen welchem gibt gibt's geht ging " +
    "sagt sagen sagte meint meinen meinung denkt denken findet finden hält halten steht stehen äußert äußern äußerung " +
    "sieht sehen fordert fordern forderung forderungen will wollen möchte möchten schreibt schreiben schlägt vor " +
    "lager lagern organisation organisationen verband verbände verbänden landkarte anhörung stellungnahme stellungnahmen " +
    "frage fragen position positionen thema themen punkt punkte punkten alle allen beide beiden seite seiten " +
    "sollte sollten soll sollen kann können könnte müsste muss müssen eigentlich genau bitte mir uns zusammen zusammenfassung " +
    "kritisiert kritisieren kritik ablehnt lehnt ab unterstützt unterstützen befürwortet"
  ).split(/\s+/),
);

/** Common short names and acronyms not derivable from the full name (keyed by shortOrg). */
const EXTRA_ALIASES: Record<string, string[]> = {
  "Deutsche Umwelthilfe": ["duh", "umwelthilfe"],
  "Stadtwerke München": ["swm"],
  "Haus & Grund": ["haus und grund", "haus+grund"],
  ZDH: ["handwerk", "zentralverband des handwerks"],
  "Kommunale Spitzenverbände": ["kommunalen spitzenverbände", "spitzenverbände", "spitzenverbänden"],
  "Agora Energiewende": ["agora"],
  DVGW: ["gas- und wasserfach"],
};

function aliasesOf(org: Org): string[] {
  const out = new Set<string>([org.name.toLowerCase(), org.short.toLowerCase()]);
  out.add(org.name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+e\.\s?V\.?/g, "").trim().toLowerCase());
  for (const m of org.name.matchAll(/\(([A-ZÄÖÜ]{2,8})\)/g)) out.add(m[1]!.toLowerCase());
  for (const m of org.name.matchAll(/\b([A-ZÄÖÜ]{3,8})\b/g)) out.add(m[1]!.toLowerCase());
  for (const a of EXTRA_ALIASES[org.short] ?? []) out.add(a);
  return [...out].filter((a) => a.length >= 3).sort((x, y) => y.length - x.length);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliasRe = (a: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a)}(s|es|n)?(?=$|[^\\p{L}\\p{N}])`, "giu");

export interface ParsedQuestion {
  orgs: Org[];
  focus: AskFocus[];
  stance: "critical" | "supportive" | null;
  /** The remaining topic words (unstemmed). */
  words: string[];
}

export function parseQuestion(question: string, orgs: Org[]): ParsedQuestion {
  let rest = ` ${question.toLowerCase()} `;
  const named: Org[] = [];
  // Longest aliases first, so "deutsche umwelthilfe" wins over "umwelthilfe".
  const all = orgs.flatMap((o) => aliasesOf(o).map((a) => ({ o, a }))).sort((x, y) => y.a.length - x.a.length);
  for (const { o, a } of all) {
    const re = aliasRe(a);
    if (re.test(rest)) {
      if (!named.includes(o)) named.push(o);
      rest = rest.replace(aliasRe(a), " ");
    }
  }
  const focus = new Set<AskFocus>();
  let stance: ParsedQuestion["stance"] = null;
  const words: string[] = [];
  // Topic words keep the spelling of the question ("Biomasse", not "biomasse").
  const original = new Map(question.split(/[^\p{L}\p{N}-]+/u).filter(Boolean).map((w) => [w.toLowerCase(), w]));
  for (const w of rest.split(/[^\p{L}\p{N}-]+/u).filter(Boolean)) {
    const hit = FOCUS.filter((f) => f.re.test(w));
    if (hit.length) {
      for (const h of hit) for (const f of h.focus) focus.add(f);
      continue;
    }
    if (CRITICAL.test(w)) stance = "critical";
    else if (SUPPORTIVE.test(w)) stance = stance ?? "supportive";
    if (GENERIC.has(w) || CRITICAL.test(w) || SUPPORTIVE.test(w)) continue;
    words.push(original.get(w) ?? w);
  }
  // "Wo sind sich alle Lager einig?" asks for bridges; "alle" alone does not.
  return { orgs: named, focus: [...focus], stance, words };
}

/* ---------- retrieval ---------- */

interface MpRow {
  id: string;
  scope: string;
  ord: number;
  typ: Typ;
  diag: Diag | null;
  label: string;
  question: string | null;
  text: string;
  befund: string | null;
  diag_flags: { votes?: { a: CampCount; b: CampCount } } | null;
  members: number;
  orgs: number;
  rank: number;
  matched: string[];
}

interface PtRow {
  id: string;
  label: string;
  summary: string | null;
  kind: AskArgument["kind"];
  measure: string | null;
  map_point_id: string | null;
  subs: string[];
  rank: number;
  matched: string[];
}

/** How far apart the camps are (counts-based share, 0–1). */
function campGap(v: { a: CampCount; b: CampCount } | null): number {
  if (!v) return 0;
  const share = (c: CampCount) => (c.agree + c.disagree ? c.agree / (c.agree + c.disagree) : 0.5);
  return Math.abs(share(v.a) - share(v.b));
}

const DIAG_WEIGHT: Partial<Record<Diag, number>> = { kern: 0.12, wert: 0.08, klaerbar: 0.08, gestaltung: 0.05, warnung: 0.05, bruecke: 0.04 };

/** Retrieve the material for one question. Read-only. */
export async function askMaterial(db: Db, consultationId: string, question: string): Promise<AskMaterial> {
  const analysis = await latestAnalysis(db, consultationId);
  const allOrgs = await loadOrgs(db, consultationId, analysis);
  const camps = campsOf(analysis, allOrgs);
  const parsed = parseQuestion(question, allOrgs);

  // Stems via the 'german' configuration (drops stop words); prefix match per stem.
  const stemmed = parsed.words.length
    ? await rows<{ word: string; lexemes: string[] }>(db, sql`
        SELECT w AS word, tsvector_to_array(to_tsvector('german', w)) AS lexemes
        FROM unnest(string_to_array(${parsed.words.join("|")}, '|')) w`)
    : [];
  const valid = (l: string) => /^[\p{L}\p{N}]+$/u.test(l) && l.length >= 3;
  const terms = [...new Set(stemmed.flatMap((r) => r.lexemes.filter(valid)))];
  const words = stemmed.filter((r) => r.lexemes.some(valid)).map((r) => r.word);
  const hasTerms = terms.length > 0;
  const tsq = terms.map((l) => (/^\d+$/.test(l) ? `'${l}'` : `'${l}':*`)).join(" | ");
  const pats = terms.filter((l) => l.length >= 4).join("|");

  const mpRank = hasTerms
    ? sql`ts_rank_cd(
        setweight(to_tsvector('german', mp.label), 'A') ||
        setweight(to_tsvector('german', coalesce(mp.question, '')), 'A') ||
        setweight(to_tsvector('german', mp.text), 'B') ||
        setweight(to_tsvector('german', coalesce(mp.befund, '')), 'D'),
        ${tsq}::tsquery)`
    : sql`0`;
  const mpHits = pats
    ? sql`ARRAY(SELECT pat FROM unnest(string_to_array(${pats}, '|')) pat
          WHERE replace(translate(lower(mp.label || ' ' || coalesce(mp.question, '') || ' ' || mp.text), 'äöü', 'aou'), 'ß', 'ss')
            LIKE '%' || pat || '%')`
    : sql`'{}'::text[]`;
  const mps = await rows<MpRow>(db, sql`
    SELECT mp.id, mp.scope, mp.ord, mp.typ, mp.diag, mp.label, mp.question, mp.text, mp.befund, mp.diag_flags,
      (SELECT count(*) FROM points p WHERE p.map_point_id = mp.id)::int AS members,
      (SELECT count(DISTINCT ps.submission_id) FROM points p JOIN point_sources ps ON ps.point_id = p.id
        WHERE p.map_point_id = mp.id)::int AS orgs,
      ${mpRank}::float8 AS rank, ${mpHits} AS matched
    FROM map_points mp WHERE mp.consultation_id = ${consultationId}`);

  const ptRank = hasTerms
    ? sql`ts_rank_cd(
        setweight(to_tsvector('german', p.label), 'A') ||
        setweight(to_tsvector('german', coalesce(p.summary, '')), 'B') ||
        setweight(to_tsvector('german', coalesce(src.quotes, '')), 'C'),
        ${tsq}::tsquery)`
    : sql`0`;
  const ptHits = pats
    ? sql`ARRAY(SELECT pat FROM unnest(string_to_array(${pats}, '|')) pat
          WHERE replace(translate(lower(p.label || ' ' || coalesce(p.summary, '') || ' ' || coalesce(src.quotes, '')), 'äöü', 'aou'), 'ß', 'ss')
            LIKE '%' || pat || '%')`
    : sql`'{}'::text[]`;
  const pts = await rows<PtRow>(db, sql`
    SELECT p.id, p.label, p.summary, p.kind, p.measure, p.map_point_id, coalesce(src.subs, '{}') AS subs,
      ${ptRank}::float8 AS rank, ${ptHits} AS matched
    FROM points p
    LEFT JOIN LATERAL (
      SELECT string_agg(ps.quote, ' ') AS quotes, array_agg(DISTINCT ps.submission_id::text) AS subs
      FROM point_sources ps WHERE ps.point_id = p.id) src ON true
    WHERE p.consultation_id = ${consultationId} AND p.status = 'released' AND p.kind <> 'gap'
      AND p.created_by <> 'import:questionnaire'`);

  const votes = await rows<{ map_point_id: string; submission_id: string; value: number }>(db, sql`
    SELECT v.map_point_id, s.id::text AS submission_id, v.value
    FROM map_point_votes v
    JOIN participants pa ON pa.id = v.participant_id
    JOIN submissions s ON pa.source_ref = 'inferred:' || s.id::text
    JOIN map_points m ON m.id = v.map_point_id
    WHERE m.consultation_id = ${consultationId} AND v.value IN (1, -1)`);

  const orgBySub = new Map(allOrgs.map((o) => [o.submissionId, o]));
  const namedSubs = new Set(parsed.orgs.map((o) => o.submissionId));
  const votesOf = new Map<string, { sub: string; value: number }[]>();
  for (const v of votes) {
    const list = votesOf.get(v.map_point_id) ?? [];
    list.push({ sub: v.submission_id, value: v.value });
    votesOf.set(v.map_point_id, list);
  }

  // Argument scores
  // Substring matches (umlauts folded like the stemmer does) weighted by rarity: a stem found in most
  // arguments ("Wärmeplan" in a heat-planning law) counts little, a rare one ("Biomasse") much.
  const df = new Map<string, number>();
  for (const p of pts) for (const t of p.matched) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(pts.length, 2);
  const idf = (t: string) => Math.max(0, Math.log(n / (1 + (df.get(t) ?? 0))) / Math.log(n));
  // A row that contains all the question's stems beats one that contains only the most common of them.
  const patCount = pats ? pats.split("|").length : 0;
  const textScore = (r: { rank: number; matched: string[] }) => {
    if (!hasTerms) return 0;
    const base = Number(r.rank) * (r.matched.length ? 1 : 0.5) + 0.3 * r.matched.reduce((s, t) => s + idf(t), 0);
    return patCount > 1 ? base * (0.4 + (0.6 * r.matched.length) / patCount) : base;
  };
  const ptScore = new Map(pts.map((p) => [p.id, textScore(p)]));
  const memberScore = new Map<string, number>();
  const orgAuthored = new Map<string, boolean>();
  for (const p of pts) {
    if (!p.map_point_id) continue;
    memberScore.set(p.map_point_id, Math.max(memberScore.get(p.map_point_id) ?? 0, ptScore.get(p.id)!));
    if (p.subs.some((s) => namedSubs.has(s))) orgAuthored.set(p.map_point_id, true);
  }

  // Map point scores
  const focus = new Set<Diag>(parsed.focus);
  if (focus.has("wert")) focus.add("kern");
  const named = parsed.orgs.length > 0;
  const scored = mps
    .map((mp) => {
      const topical = textScore(mp) + 0.6 * (memberScore.get(mp.id) ?? 0);
      const v = (votesOf.get(mp.id) ?? []).filter((x) => namedSubs.has(x.sub));
      let org = 0;
      if (named) {
        if (orgAuthored.get(mp.id)) org += 0.4;
        if (v.length) org += 0.2;
        if (parsed.stance === "critical" && v.some((x) => x.value === -1)) org += 0.25;
        if (parsed.stance === "supportive" && v.some((x) => x.value === 1)) org += 0.25;
      }
      const inFocus = mp.diag != null && focus.has(mp.diag);
      const cv = mp.diag_flags?.votes ?? null;
      const breadth = cv ? cv.a.agree + cv.b.agree : 0;
      const secondary = focus.has("bruecke")
        ? breadth / 20
        : focus.size
          ? campGap(cv) / 2 + (mp.diag === "kern" ? 0.2 : 0)
          : (DIAG_WEIGHT[mp.diag ?? "offen"] ?? 0) + mp.orgs / 100;
      const keep = hasTerms ? topical > 0 : named ? org > 0 : focus.size ? inFocus : mp.typ !== "luecke" && mp.diag !== "offen";
      return { mp, keep, score: topical + org + (inFocus ? 1 : 0) + secondary * 0.5 };
    })
    .filter((x) => x.keep)
    .sort((x, y) => y.score - x.score);

  const selectedMp = scored.slice(0, ASK_MAX_MAP_POINTS).map((x) => x.mp);
  const selectedIds = new Set(selectedMp.map((m) => m.id));
  const mpRankPos = new Map(selectedMp.map((m, i) => [m.id, i]));

  // Arguments: the named organisations' own first, then one per selected Landkarten-Punkt, then by text score.
  const chosen: PtRow[] = [];
  const has = new Set<string>();
  const take = (p: PtRow) => {
    if (chosen.length >= ASK_MAX_ARGUMENTS || has.has(p.id)) return;
    chosen.push(p);
    has.add(p.id);
  };
  const byText = (a: PtRow, b: PtRow) => ptScore.get(b.id)! - ptScore.get(a.id)!;
  const byMapPos = (a: PtRow, b: PtRow) =>
    (mpRankPos.get(a.map_point_id ?? "") ?? 99) - (mpRankPos.get(b.map_point_id ?? "") ?? 99);

  let coverage: AskMaterial["coverage"] = [];
  if (named) {
    const limit = hasTerms ? 14 : 18;
    const lists = parsed.orgs.map((o) => {
      const own = pts.filter((p) => p.subs.includes(o.submissionId));
      const relevant = hasTerms
        ? own
            .filter((p) => ptScore.get(p.id)! > 0 || (p.map_point_id && selectedIds.has(p.map_point_id)))
            .sort((a, b) => byText(a, b) || byMapPos(a, b))
        : [...own].sort((a, b) => byMapPos(a, b) || a.label.localeCompare(b.label, "de"));
      return { o, own, relevant };
    });
    // Interleaved, so that every named organisation gets its share.
    for (let i = 0; chosen.length < limit && lists.some((l) => i < l.relevant.length); i++) {
      for (const l of lists) if (i < l.relevant.length && chosen.length < limit) take(l.relevant[i]!);
    }
    coverage = lists.map((l) => ({
      submissionId: l.o.submissionId,
      total: l.own.length,
      onTopic: hasTerms ? l.own.filter((p) => ptScore.get(p.id)! > 0).map((p) => p.id) : null,
    }));
  }
  // Every Landkarten-Punkt gets at least one argument with a quote.
  for (const mp of selectedMp) {
    if (chosen.some((c) => c.map_point_id === mp.id)) continue;
    const best = pts
      .filter((p) => p.map_point_id === mp.id)
      .sort((a, b) => byText(a, b) || b.subs.length - a.subs.length)[0];
    if (best) take(best);
  }
  if (hasTerms) {
    for (const p of pts.filter((p) => ptScore.get(p.id)! > 0).sort(byText)) take(p);
  } else {
    // Second voice per Landkarten-Punkt.
    for (const mp of selectedMp) {
      const quoted = new Set(chosen.filter((c) => c.map_point_id === mp.id).flatMap((c) => c.subs));
      const next = pts.find((p) => p.map_point_id === mp.id && !has.has(p.id) && p.subs.some((s) => !quoted.has(s)));
      if (next) take(next);
    }
  }

  // Arguments whose Landkarten-Punkt is not yet in the material pull it in while there is room.
  const mpById = new Map(mps.map((m) => [m.id, m]));
  for (const p of chosen) {
    if (selectedMp.length >= ASK_MAX_MAP_POINTS) break;
    if (p.map_point_id && !selectedIds.has(p.map_point_id)) {
      const m = mpById.get(p.map_point_id);
      if (m) {
        selectedMp.push(m);
        selectedIds.add(m.id);
      }
    }
  }

  const keyOfMp = new Map(selectedMp.map((m, i) => [m.id, `L${i + 1}`]));
  const sources = chosen.length
    ? await rows<{ point_id: string; submission_id: string; org: string | null; quote: string | null }>(db, sql`
        SELECT ps.point_id::text, ps.submission_id::text, s.author_org AS org, ps.quote
        FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
        WHERE ps.point_id::text = ANY(string_to_array(${chosen.map((c) => c.id).join(",")}, ','))
        ORDER BY ps.created_at`)
    : [];

  const nameOf = (sub: string) => orgBySub.get(sub)?.name ?? "Stellungnahme";
  const mapPoints: AskMapPoint[] = selectedMp.map((m) => {
    const v = votesOf.get(m.id) ?? [];
    return {
      key: keyOfMp.get(m.id)!,
      id: m.id,
      scope: m.scope,
      typ: m.typ,
      diag: m.diag,
      label: m.label,
      question: m.question,
      text: m.text,
      befund: m.befund,
      votes: m.diag_flags?.votes ?? null,
      agree: v.filter((x) => x.value === 1).map((x) => nameOf(x.sub)),
      disagree: v.filter((x) => x.value === -1).map((x) => nameOf(x.sub)),
      members: m.members,
      orgs: m.orgs,
    };
  });
  const args: AskArgument[] = chosen.map((p, i) => ({
    key: `A${i + 1}`,
    id: p.id,
    label: p.label,
    summary: p.summary,
    kind: p.kind,
    measure: p.measure,
    mapPointId: p.map_point_id,
    mapPointKey: p.map_point_id ? (keyOfMp.get(p.map_point_id) ?? null) : null,
    mapPointLabel: p.map_point_id ? (mpById.get(p.map_point_id)?.label ?? null) : null,
    sources: sources
      .filter((s) => s.point_id === p.id)
      .map((s) => ({ org: s.org ?? "Stellungnahme", submissionId: s.submission_id, quote: s.quote })),
  }));

  return {
    question,
    terms,
    words,
    orgs: parsed.orgs,
    coverage,
    focus: parsed.focus,
    stance: parsed.stance,
    camps,
    allOrgs,
    totals: { mapPoints: mps.filter((m) => m.typ !== "luecke").length, arguments: pts.length },
    byDiag: mps.reduce<Partial<Record<Diag, number>>>((acc, m) => {
      const d = m.diag ?? "offen";
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {}),
    mapPoints,
    arguments: args,
  };
}

export { shortOrg };
