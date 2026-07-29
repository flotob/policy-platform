import { describe, expect, it } from "vitest";

import { getDirection, routing } from "../src/i18n/routing";

describe("RTL smoke test: getDirection", () => {
  it("returns ltr for the shipped locales", () => {
    for (const locale of routing.locales) {
      expect(getDirection(locale)).toBe("ltr");
    }
  });

  it("returns rtl for RTL-script locales the platform must support later", () => {
    for (const locale of ["ar", "he", "fa", "ur", "ar-EG", "he-IL"]) {
      expect(getDirection(locale)).toBe("rtl");
    }
  });

  it("handles region subtags and casing", () => {
    expect(getDirection("AR")).toBe("rtl");
    expect(getDirection("de-AT")).toBe("ltr");
    expect(getDirection("pt_BR")).toBe("ltr");
  });
});
