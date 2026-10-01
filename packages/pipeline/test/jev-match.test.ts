import { describe, expect, it } from "vitest";

import { MERGE_AT, REVIEW_FROM, matchBand, shortlist, trigrams } from "../src/jev-match.ts";

describe("trigrams", () => {
  it("normalizes case and punctuation and pads words", () => {
    const t = trigrams("Netz-Ausbau!");
    expect(t.has(" ne")).toBe(true);
    expect(t.has("au ")).toBe(true);
    expect([...t].some((x) => /[A-Z!-]/.test(x))).toBe(false);
  });
});

describe("shortlist", () => {
  const existing = [
    { id: "a", label: "Höchstgrenzen für Biomasse anheben", summary: null },
    { id: "b", label: "Bürokratieabbau als Voraussetzung", summary: null },
    { id: "c", label: "Wasserstoffnetze dürfen von Gasnetzbetreibern betrieben werden", summary: null },
  ];

  it("ranks the paraphrase with shared word stems first", () => {
    const top = shortlist({ label: "Biomasse-Höchstgrenzen anheben", summary: null }, existing, 2);
    expect(top[0]!.id).toBe("a");
    expect(top).toHaveLength(2);
  });

  it("tolerates German compounds", () => {
    const top = shortlist({ label: "Gasnetzbetreiber sollen Wasserstoffnetze betreiben", summary: null }, existing, 1);
    expect(top[0]!.id).toBe("c");
  });

  it("returns at most k points and nothing for an empty map", () => {
    expect(shortlist({ label: "x", summary: null }, existing, 10)).toHaveLength(3);
    expect(shortlist({ label: "x", summary: null }, [], 10)).toHaveLength(0);
  });
});

describe("matchBand — 'when in doubt, new' as a threshold", () => {
  it("merges only when more likely same than not", () => {
    expect(MERGE_AT).toBe(0.5);
    expect(matchBand(0.5)).toBe("merge");
    expect(matchBand(0.97)).toBe("merge");
  });

  it("routes the grey zone to editorial review", () => {
    expect(REVIEW_FROM).toBe(0.2);
    expect(matchBand(0.2)).toBe("review");
    expect(matchBand(0.49)).toBe("review");
  });

  it("treats confident differences as new", () => {
    expect(matchBand(0.19)).toBe("new");
    expect(matchBand(0)).toBe("new");
  });
});
