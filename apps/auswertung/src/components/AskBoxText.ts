/**
 * Text helpers for "Frag die Landkarte", shared by the answer route (server)
 * and AskBox (client): citation keys and a conservative German sentence split.
 */

/** A group of citation keys: [L3], [A12, L3], [L0]. */
export const KEYS = /\[\s*([LA]\d+(?:\s*[,;]\s*[LA]\d+)*)\s*\]/g;

/** Words that end with a full stop without ending the sentence. */
const ABBR = new Set(["z", "b", "bzw", "abs", "nr", "art", "ca", "vgl", "d", "h", "u", "a", "s", "dr", "ing", "e", "v", "insb", "evtl", "ggf", "sog", "usw", "etc", "inkl", "max", "min", "mio", "mrd", "rd"]);

/**
 * Split a paragraph into sentences, each with the citation group at its end (before or after the full stop).
 * Conservative: when in doubt it does not split, so a sentence is only marked uncited when it surely has no key.
 */
export function sentencesOf(para: string): string[] {
  const out: string[] = [];
  const boundary = /([.!?])(["“”)]*)((?:\s*\[[^\]]*\])*)\s+(?=[A-ZÄÖÜ„"])/g;
  let start = 0;
  for (const m of para.matchAll(boundary)) {
    const at = m.index ?? 0;
    const before = para.slice(start, at).match(/(\S+)$/)?.[1] ?? "";
    const word = before.replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
    if (m[1] === "." && (ABBR.has(word) || /^\d{1,2}$/.test(word) || /^\p{L}$/u.test(word))) continue;
    const end = at + m[0].length;
    out.push(para.slice(start, end).trimEnd());
    start = end;
  }
  out.push(para.slice(start).trim());
  return out.filter(Boolean);
}

export const cited = (sentence: string) => new RegExp(KEYS.source).test(sentence);

/** Sentences of an answer (paragraphs separated by blank lines) that carry no citation key. */
export function uncitedSentences(answer: string): string[] {
  return answer
    .split(/\n\s*\n/)
    .flatMap(sentencesOf)
    .filter((x) => !cited(x));
}
