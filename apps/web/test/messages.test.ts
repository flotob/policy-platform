import { describe, expect, it } from "vitest";

import de from "../messages/de.json";
import en from "../messages/en.json";

function keysOf(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("i18n discipline", () => {
  it("de and en message catalogs have identical keys", () => {
    expect(keysOf(de).sort()).toEqual(keysOf(en).sort());
  });

  it("no message is empty", () => {
    const all = [...keysOf(de), ...keysOf(en)];
    expect(all.length).toBeGreaterThan(0);
    const flat = (obj: Record<string, unknown>): string[] =>
      Object.values(obj).flatMap((v) =>
        typeof v === "object" && v !== null
          ? flat(v as Record<string, unknown>)
          : [String(v)],
      );
    for (const value of [...flat(de), ...flat(en)]) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
