/**
 * Locate an extracted quote in its source text despite cosmetic drift.
 *
 * The decomposition model is told to copy quotes verbatim, but PDF text keeps
 * hard line breaks, soft hyphens, word hyphenation across lines, and
 * typographic quotes/dashes the model silently normalizes — an exact indexOf
 * missed 37 % of all quotes (2026-10-01: 296/792), of which 286 reappear after
 * normalization. Deterministic, no model: normalize both sides with an index
 * map back to the original, then search.
 */

export interface QuoteSpan {
  start: number;
  end: number;
  /** "exact" = verbatim, "normalized" = equal after whitespace/case/punctuation normalization. */
  match: "exact" | "normalized" | "alnum";
}

const QUOTE_CHARS: Record<string, string> = {
  "„": '"', "“": '"', "”": '"', "«": '"', "»": '"', "‚": "'", "‘": "'", "’": "'", "`": "'",
  "–": "-", "—": "-", "‑": "-", "‐": "-",
};

/** Normalized text + map from each normalized char to its source index. */
function normalizeWithMap(text: string, alnumOnly: boolean): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!;
    if (ch === "\u00AD") continue; // soft hyphen
    // Line-break hyphenation: "Wärme-\nplanung" → "Wärmeplanung".
    if ((ch === "-" || ch === "‐") && /\s/.test(text[i + 1] ?? "") && /[a-zäöüß]/.test(nextNonSpace(text, i + 1))) {
      const j = skipSpace(text, i + 1);
      if (text.slice(i + 1, j).includes("\n")) {
        i = j - 1;
        continue;
      }
    }
    ch = QUOTE_CHARS[ch] ?? ch;
    if (alnumOnly) {
      if (!/[\p{L}\p{N}]/u.test(ch)) continue;
      norm += ch.toLowerCase();
      map.push(i);
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) {
      norm += " ";
      map.push(i);
      pendingSpace = false;
    }
    norm += ch.toLowerCase();
    map.push(i);
  }
  return { norm, map };
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

function nextNonSpace(text: string, i: number): string {
  return text[skipSpace(text, i)] ?? "";
}

export function locateQuote(text: string, quote: string): QuoteSpan | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length, match: "exact" };
  for (const alnumOnly of [false, true]) {
    const t = normalizeWithMap(text, alnumOnly);
    const q = normalizeWithMap(quote, alnumOnly).norm;
    if (q.length < 8) continue;
    const at = t.norm.indexOf(q);
    if (at >= 0) {
      return {
        start: t.map[at]!,
        end: t.map[at + q.length - 1]! + 1,
        match: alnumOnly ? "alnum" : "normalized",
      };
    }
  }
  return null;
}

/** Display form of a source passage: whitespace collapsed, line-break hyphenation joined. */
export function displayQuote(raw: string): string {
  return raw
    .replace(/\u00AD/g, "")
    .replace(/([a-zäöüß])-\s*\n\s*([a-zäöüß])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sentence-ish passages of a source text, with their spans (for quote
 * selection). Boundaries: sentence punctuation followed by whitespace, or a
 * blank line — single hard line breaks (PDF wrapping) stay inside the
 * sentence, and short abbreviation tokens ("Abs.", "z. B.", "Nr.", "14.")
 * do not end one.
 */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const push = (from: number, to: number) => {
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    if (to - from >= 30) out.push({ text: text.slice(from, to), start: from, end: to });
  };
  const boundary = /[.!?]+(?=\s)|\n[ \t]*\n/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text)) !== null) {
    const isBlankLine = m[0].startsWith("\n");
    if (!isBlankLine && /(?:^|[\s(§])(?:\p{L}{1,4}|\d+)$/u.test(text.slice(Math.max(0, m.index - 6), m.index))) {
      continue;
    }
    push(start, isBlankLine ? m.index : m.index + m[0].length);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return out;
}

/**
 * The full sentence(s) around a located quote — extraction spans are often
 * clause fragments ("dem Gesetzeszweck einer …"), which make poor quotations.
 * Falls back to the span itself when the sentences would exceed maxChars.
 */
export function enclosingSentences(text: string, start: number, end: number, maxChars = 400): string {
  const hits = sentences(text).filter((s) => s.start < end && s.end > start);
  if (hits.length === 0) return displayQuote(text.slice(start, end));
  const from = Math.min(hits[0]!.start, start);
  const to = Math.max(hits.at(-1)!.end, end);
  return displayQuote(to - from <= maxChars ? text.slice(from, to) : text.slice(start, end));
}
