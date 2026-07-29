import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "de"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

/**
 * Writing direction for a locale. The platform must never assume LTR — every
 * layout derives `dir` from the active locale through this function, and the
 * RTL smoke test pins the behavior before any RTL locale ships.
 */
export function getDirection(locale: string): "ltr" | "rtl" {
  const rtlScripts = new Set(["ar", "fa", "he", "ur", "ckb", "dv", "ps", "yi"]);
  const lang = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  return rtlScripts.has(lang) ? "rtl" : "ltr";
}
