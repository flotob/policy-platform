import { describe, expect, it } from "vitest";

import { displayQuote, locateQuote, sentences } from "../src/quote-span.ts";

const SRC =
  "Die kommunale Wärme-\nplanung ist ein wichtiges „Instrument“ der\nWärmewende. Der BDEW begrüßt den Entwurf gem. § 14 Abs. 2 ausdrücklich.\n\nNeuer Absatz mit weiterem Text hier.";

describe("locateQuote", () => {
  it("finds verbatim quotes", () => {
    const s = locateQuote(SRC, "Der BDEW begrüßt");
    expect(s?.match).toBe("exact");
    expect(SRC.slice(s!.start, s!.end)).toBe("Der BDEW begrüßt");
  });

  it("bridges hard line breaks and hyphenation", () => {
    const s = locateQuote(SRC, "Die kommunale Wärmeplanung ist ein wichtiges");
    expect(s?.match).toBe("normalized");
    expect(displayQuote(SRC.slice(s!.start, s!.end))).toBe("Die kommunale Wärmeplanung ist ein wichtiges");
  });

  it("tolerates typographic quotes and case", () => {
    const s = locateQuote(SRC, 'ein wichtiges "instrument" der Wärmewende');
    expect(s).not.toBeNull();
    expect(displayQuote(SRC.slice(s!.start, s!.end))).toBe("ein wichtiges „Instrument“ der Wärmewende");
  });

  it("returns null for paraphrases", () => {
    expect(locateQuote(SRC, "Die Wärmeplanung ist ein zentrales Werkzeug")).toBeNull();
  });
});

describe("sentences", () => {
  it("keeps PDF-wrapped sentences and legal abbreviations together", () => {
    const ss = sentences(SRC).map((x) => x.text);
    expect(ss[0]).toContain("Wärme-\nplanung ist ein wichtiges");
    expect(ss.some((x) => x.includes("gem. § 14 Abs. 2 ausdrücklich."))).toBe(true);
    expect(ss.at(-1)).toBe("Neuer Absatz mit weiterem Text hier.");
  });
});

describe("enclosingSentences", () => {
  it("widens a clause fragment to its full sentence", async () => {
    const { enclosingSentences } = await import("../src/quote-span.ts");
    const start = SRC.indexOf("begrüßt den Entwurf");
    const out = enclosingSentences(SRC, start, start + "begrüßt den Entwurf".length);
    expect(out).toBe("Der BDEW begrüßt den Entwurf gem. § 14 Abs. 2 ausdrücklich.");
  });
});
