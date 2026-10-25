/** URL slugs from German names: "Stadt Müllheim (Baden)" → "stadt-muellheim-baden". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** First path segments the app itself uses: no municipality may take them. */
export const RESERVED = new Set(["anmelden", "registrieren", "abmelden", "verwaltung", "api", "beispiel", "impressum", "datenschutz", "_next"]);
