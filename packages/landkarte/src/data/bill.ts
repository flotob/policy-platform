/**
 * The draft law, section by section (idea 2: the bill as the backbone).
 * Reads the bill from consultation_documents, cuts the law part like
 * lawTextOf in propose-measures-bill.ts, parses Artikel 1 (the WPG) into its
 * §§ with Teil/Abschnitt, and counts per § the arguments that NAME it
 * (namedSections, ported from packages/pipeline/src/measures.ts).
 * Read-only; no AI.
 */

import { sql, type Db } from "@policy/db";

import type { Diag, Typ } from "../vocab.ts";

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as unknown as T[];

// ---------------------------------------------------------------- references

/** Abbreviations of OTHER laws: "§ 71 GEG" is not § 71 of this bill (same rule as the pipeline). */
const OTHER_LAW = /\b(?!WPG\b)[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*(?:G|V|O|B)\b|\b(?:Gebäudeenergiegesetz|Baugesetzbuch|Energiewirtschaftsgesetz|Grundgesetz)/;

/** Section numbers of THIS bill named in a text (others filtered out). Port of pipeline/src/measures.ts. */
export function namedSections(text: string): number[] {
  const out: number[] = [];
  const re = /§§?\s*(\d{1,3})(?:\s*(?:,|und|bis|–|-)\s*(\d{1,3}))*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40).split("§")[0]!;
    if (OTHER_LAW.test(tail)) continue;
    for (const n of m[0].match(/\d{1,3}/g) ?? []) out.push(Number(n));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- text

/** One line of legal text: an Absatz "(1)", a numbered item "1.", a letter "a)", or a sub-letter "aa)". */
export interface LawSegment {
  level: 0 | 1 | 2 | 3;
  marker: string | null;
  text: string;
  /** A heading inside an Anlage ("I. Zielszenario nach § 17"). */
  heading?: boolean;
}

export interface LawSection {
  n: number;
  title: string;
  part: { n: number; title: string };
  chapter: { n: number; title: string } | null;
  segments: LawSegment[];
  /** First sentence of the section, for the collapsed view. */
  lead: string;
  /** Number of Absätze. */
  absaetze: number;
}

/** Anlagen of the WPG and Artikel 2–4 of the bill. */
export interface LawExtra {
  /** "Anlage 1", "Artikel 2" — the prefix the bill measures use in `other`. */
  key: string;
  title: string;
  /** "zu § 15" for an Anlage. */
  ref: string | null;
  segments: LawSegment[];
}

export interface ParsedBill {
  /** Artikel 1's title and its short name ("Wärmeplanungsgesetz"), when the bill names one. */
  law: { title: string; short: string | null; abbr: string | null };
  sections: LawSection[];
  extras: LawExtra[];
}

/** The law part of the bill: everything before "A. Allgemeiner Teil" (lawTextOf in propose-measures-bill.ts). */
export function lawTextOf(text: string): string {
  const skip = Math.floor(text.length * 0.05);
  const m = /\n\s*A\.\s*Allgemeiner\s+Teil/.exec(text.slice(skip));
  const end = m ? skip + m.index : 200_000;
  return text.slice(0, Math.min(end, 200_000));
}

const spaced = (s: string) =>
  s
    .split(/\s{2,}/)
    .map((w) => w.replace(/ /g, ""))
    .filter(Boolean)
    .join(" ");

/** "T e i l  2" / "A b s c h n i t t  6" heading lines (letter-spaced in the PDF). */
const PART = /^T e i l\s+(\d+)\s*$/;
const CHAPTER = /^A b s c h n i t t\s+(\d+)\s*$/;
const SECTION = /^§ (\d+)\s*$/;

/** Join hard-wrapped PDF lines: hyphenation, compound hyphens and "Aus- oder Umbau" survive. */
function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    if (/[A-Za-zÄÖÜäöüß]-$/.test(out)) {
      if (/^(und|oder|sowie|bis|bzw\.)\b/.test(line)) out += " " + line;
      else if (/^[a-zäöüß]/.test(line)) out = out.slice(0, -1) + line;
      else out += line;
    } else out += " " + line;
  }
  return out.replace(/\s+/g, " ").trim();
}

const MONTH = /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\.\s/;
/** A sentence ends here (not an ordinal "1." or an abbreviation like "Nr." / "BGBl."). */
const SENTENCE_END = /(?<!\b(?:Nr|Abs|S|bzw|Buchst|vgl|ff|Art|BGBl|z\.\s?B|d\.\s?h|u\.\s?a|Ziff|Satz))[a-zäöüß)“"]\.\s*$/;

/** Lines of legal text → segments (Absätze, numbered items, letters), each joined into one string. */
export function segmentsOf(lines: string[]): LawSegment[] {
  const segs: { level: LawSegment["level"]; marker: string | null; lines: string[]; heading?: boolean }[] = [];
  let absatz = 0;
  let item = 0;
  let letter = "";
  const push = (level: LawSegment["level"], marker: string | null, first: string) => segs.push({ level, marker, lines: [first] });
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\((\d+)([a-z]?)\)\s+(.*)$/.exec(line)) && (Number(m[1]) === absatz + 1 || m[2])) {
      absatz = Number(m[1]);
      item = 0;
      letter = "";
      push(0, `(${m[1]}${m[2]})`, m[3]!);
      continue;
    }
    if ((m = /^(\d{1,2})\.\s+(.*)$/.exec(line)) && !MONTH.test(m[2]!) && (Number(m[1]) === item + 1 || (Number(m[1]) === 1 && item > 1))) {
      item = Number(m[1]);
      letter = "";
      push(1, `${m[1]}.`, m[2]!);
      continue;
    }
    if ((m = /^([a-z])\)\s+(.*)$/.exec(line)) && (m[1] === "a" || (letter && m[1]!.charCodeAt(0) === letter.charCodeAt(0) + 1))) {
      letter = m[1]!;
      push(2, `${m[1]})`, m[2]!);
      continue;
    }
    if ((m = /^([a-z])\1\)\s+(.*)$/.exec(line))) {
      push(3, `${m[1]}${m[1]})`, m[2]!);
      continue;
    }
    if (ROMAN.test(line)) {
      item = 0;
      letter = "";
      segs.push({ level: 0, marker: null, lines: [line], heading: true });
      continue;
    }
    const last = segs[segs.length - 1];
    // Text after a heading starts its own paragraph (a lowercase line continues the heading).
    if (!last || (last.heading && !/^[a-zäöüß]/.test(line))) {
      push(0, null, line);
      continue;
    }
    // A sentence after the last item of a list ("§ 5 bleibt unberührt.") belongs to the Absatz again.
    if (last.level > 0 && SENTENCE_END.test(last.lines[last.lines.length - 1]!) && /^[A-ZÄÖÜ§]/.test(line)) {
      push(0, null, line);
      continue;
    }
    last.lines.push(line);
  }
  return segs.map((s) => ({ level: s.level, marker: s.marker, text: joinLines(s.lines), ...(s.heading ? { heading: true } : {}) }));
}

/** First sentence of a text, at most ~220 characters. */
export function firstSentence(text: string, max = 220): string {
  const re = /(?<!\b(?:Nr|Abs|S|bzw|Buchst|vgl|ff|Art|BGBl|Ziff|Satz))(?<!\d)(?<!z\.\s?B)(?<!d\.\s?h)(?<!u\.\s?a)\.\s+(?=[A-ZÄÖÜ§(„])/g;
  const m = re.exec(text);
  let s = m ? text.slice(0, m.index + 1) : text;
  if (s.length > max) s = s.slice(0, s.lastIndexOf(" ", max)).replace(/[,;:]$/, "") + " …";
  return s;
}

/** Parse Artikel 1 (§§ with Teil/Abschnitt), its Anlagen, and Artikel 2–4. */
export function parseBill(text: string): ParsedBill {
  const lines = lawTextOf(text).split("\n");

  // Titles from the table of contents (they may wrap; the body repeats them).
  const toc = new Map<number, string>();
  const tocStart = lines.findIndex((l) => /I n h a l t s ü b e r s i c h t/.test(l));
  // Artikel 1's title sits between "Artikel 1" and the contents.
  let art1 = tocStart - 1;
  while (art1 > 0 && !/^Artikel 1\s*$/.test(lines[art1]!.trim())) art1--;
  const lawTitle = art1 > 0 ? joinLines(lines.slice(art1 + 1, tocStart)) : "";
  const short = /\(([^()–-]+?)\s*[–-]\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöü]*)\)\s*$/.exec(lawTitle);
  const law = { title: lawTitle, short: short ? short[1]!.trim() : null, abbr: short ? short[2]! : null };
  let i = tocStart + 1;
  let cur: number | null = null;
  for (; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (SECTION.test(l)) break; // body starts with "§ 1" on its own line
    const m = /^§ (\d+)\s+(.+)$/.exec(l);
    if (m) {
      cur = Number(m[1]);
      toc.set(cur, m[2]!.trim());
    } else if (/^Anlage\b/.test(l) || PART.test(l) || CHAPTER.test(l) || /^\S \S \S/.test(l)) {
      cur = null; // headings (letter-spaced) and the Anlagen end a title
    } else if (cur != null && l) toc.set(cur, joinLines([toc.get(cur)!, l]));
  }

  const norm = (s: string) => s.replace(/[\s-]+/g, "");
  const sections: LawSection[] = [];
  const extras: LawExtra[] = [];
  let part = { n: 0, title: "" };
  let chapter: LawSection["chapter"] = null;
  // Body: from the first "§ N" after the contents (rewind to its Teil heading) to "Anlage 1 (zu § 15)".
  let start = i;
  while (start > tocStart && !PART.test(lines[start]!.trim())) start--;
  let sec: { n: number; title: string; body: string[]; part: typeof part; chapter: typeof chapter } | null = null;
  let extra: { key: string; title: string[]; ref: string | null; body: string[] } | null = null;
  let heading: { kind: "part" | "chapter"; n: number; title: string[] } | null = null;

  const closeSection = () => {
    if (!sec) return;
    const segments = segmentsOf(sec.body);
    sections.push({
      n: sec.n,
      title: sec.title,
      part: sec.part,
      chapter: sec.chapter,
      segments,
      lead: firstSentence(
        segments
          .slice(0, 4)
          .map((x) => (x.level > 0 ? `${x.marker} ${x.text}` : x.text))
          .join(" "),
      ),
      absaetze: segments.filter((s) => s.level === 0 && s.marker).length,
    });
    sec = null;
  };
  const closeExtra = () => {
    if (!extra) return;
    extras.push({ key: extra.key, title: joinLines(extra.title), ref: extra.ref, segments: segmentsOf(extra.body) });
    extra = null;
  };
  const closeHeading = () => {
    if (!heading) return;
    const t = { n: heading.n, title: spaced(heading.title.join("")) };
    if (heading.kind === "part") {
      part = t;
      chapter = null;
    } else chapter = t;
    heading = null;
  };

  for (let k = start; k < lines.length; k++) {
    const l = lines[k]!.trimEnd();
    const t = l.trim();
    let m: RegExpExecArray | null;
    if (!extra && (m = PART.exec(t))) {
      closeSection();
      heading = { kind: "part", n: Number(m[1]), title: [] };
      continue;
    }
    if (!extra && (m = CHAPTER.exec(t))) {
      closeSection();
      closeHeading();
      heading = { kind: "chapter", n: Number(m[1]), title: [] };
      continue;
    }
    if (!extra && (m = SECTION.exec(t))) {
      closeHeading();
      closeSection();
      const n = Number(m[1]);
      const want = toc.get(n);
      // Consume the title lines the table of contents announced.
      const titleLines: string[] = [];
      let k2 = k + 1;
      if (want) {
        while (k2 < lines.length && norm(titleLines.join(" ")).length < norm(want).length && norm(want).startsWith(norm(titleLines.concat(lines[k2]!).join(" ")))) {
          titleLines.push(lines[k2]!);
          k2++;
        }
      }
      if (titleLines.length === 0) titleLines.push(lines[k2++]!);
      sec = { n, title: want ?? joinLines(titleLines), body: [], part, chapter };
      k = k2 - 1;
      continue;
    }
    if (heading) {
      // Letter-spaced heading text; keep raw spacing (spaced() needs the double spaces). "G e -" + "b ä u d e" = one word.
      heading.title.push(l.endsWith("-") ? l.replace(/-$/, "") : l + "  ");
      continue;
    }
    if (t === "Begründung") break;
    if ((m = /^(Anlage \d|Artikel \d)\s*$/.exec(t))) {
      closeSection();
      closeExtra();
      extra = { key: m[1]!, title: [], ref: null, body: [] };
      continue;
    }
    if (extra) {
      const r = /^\((zu § \d+)\)\s*$/.exec(t);
      if (r && !extra.ref && extra.title.length === 0) extra.ref = r[1]!;
      else if (extra.body.length === 0 && (extra.title.length === 0 || /-\s*$/.test(extra.title[extra.title.length - 1]!) || /^-/.test(t) || /\bund\s*$/.test(extra.title[extra.title.length - 1]!)))
        extra.title.push(t);
      else extra.body.push(t);
      continue;
    }
    if (sec) sec.body.push(t);
  }
  closeSection();
  closeExtra();
  return { law, sections, extras };
}

// ---------------------------------------------------------------- loader

export interface SectionPoint {
  id: string;
  label: string;
  diag: Diag | null;
  typ: Typ;
  scope: string;
  /** Arguments under this Landkarten-Punkt that name the section. */
  naming: number;
}

export interface SectionHeat {
  /** Released arguments (not questionnaire, not gaps) whose label, summary, or quotes name this §. */
  points: number;
  /** Organisations behind those arguments. */
  orgs: number;
  /** Landkarten-Punkte whose members name the §, most-naming first. */
  mapPoints: SectionPoint[];
}

export interface Bill {
  filename: string;
  law: ParsedBill["law"];
  sections: (LawSection & { heat: SectionHeat })[];
  extras: LawExtra[];
  /** Organisations that submitted a statement. */
  orgs: number;
  /** Arguments that name at least one § of the WPG. */
  naming: number;
  /** All released arguments (same filter). */
  arguments: number;
}

const DIAG_RANK: Diag[] = ["kern", "wert", "klaerbar", "gestaltung", "warnung", "bruecke", "offen", "luecke"];

export async function loadBill(db: Db, consultationId: string): Promise<Bill | null> {
  const doc = (
    await rows<{ filename: string; text: string }>(db, sql`
      SELECT filename, text FROM consultation_documents
      WHERE consultation_id = ${consultationId} AND kind = 'drucksache:Gesetzentwurf' AND text IS NOT NULL
      ORDER BY length(text) DESC LIMIT 1`)
  )[0];
  if (!doc) return null;
  const parsed = parseBill(doc.text);
  const known = new Set(parsed.sections.map((s) => s.n));

  const pts = await rows<{ id: string; label: string; summary: string | null; map_point_id: string | null; quotes: string | null; subs: string[] }>(db, sql`
    SELECT p.id, p.label, p.summary, p.map_point_id,
      (SELECT string_agg(ps.quote, ' ¶ ') FROM point_sources ps WHERE ps.point_id = p.id) AS quotes,
      COALESCE((SELECT array_agg(DISTINCT ps.submission_id::text) FROM point_sources ps WHERE ps.point_id = p.id), '{}') AS subs
    FROM points p
    WHERE p.consultation_id = ${consultationId} AND p.status = 'released' AND p.kind <> 'gap'
      AND p.created_by <> 'import:questionnaire'`);
  const mps = await rows<{ id: string; label: string; diag: Diag | null; typ: Typ; scope: string }>(db, sql`
    SELECT id, label, diag, typ, scope FROM map_points WHERE consultation_id = ${consultationId} AND typ <> 'luecke'`);
  const mpById = new Map(mps.map((m) => [m.id, m]));
  const orgs = (
    await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM submissions WHERE consultation_id = ${consultationId} AND text IS NOT NULL`)
  )[0]!.n;

  const bySection = new Map<number, { points: number; subs: Set<string>; mp: Map<string, number> }>();
  let naming = 0;
  for (const p of pts) {
    // Each source text on its own so a "§" in one quote never borrows another's law abbreviation.
    const named = new Set<number>();
    for (const t of [p.label, p.summary ?? "", ...(p.quotes ?? "").split(" ¶ ")]) for (const n of namedSections(t)) if (known.has(n)) named.add(n);
    if (named.size) naming++;
    for (const n of named) {
      const e = bySection.get(n) ?? { points: 0, subs: new Set<string>(), mp: new Map<string, number>() };
      e.points++;
      for (const s of p.subs) e.subs.add(s);
      if (p.map_point_id && mpById.has(p.map_point_id)) e.mp.set(p.map_point_id, (e.mp.get(p.map_point_id) ?? 0) + 1);
      bySection.set(n, e);
    }
  }

  return {
    filename: doc.filename,
    law: parsed.law,
    extras: parsed.extras,
    orgs,
    naming,
    arguments: pts.length,
    sections: parsed.sections.map((s) => {
      const e = bySection.get(s.n);
      const mapPoints = [...(e?.mp ?? new Map<string, number>())]
        .map(([id, k]) => ({ ...mpById.get(id)!, naming: k }))
        .sort(
          (a, b) =>
            b.naming - a.naming ||
            DIAG_RANK.indexOf(a.diag ?? "offen") - DIAG_RANK.indexOf(b.diag ?? "offen") ||
            a.label.localeCompare(b.label, "de"),
        );
      return { ...s, heat: { points: e?.points ?? 0, orgs: e?.subs.size ?? 0, mapPoints } };
    }),
  };
}
