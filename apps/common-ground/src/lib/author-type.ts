/**
 * Submission author types arrive in two vocabularies (enum-style
 * "BUSINESS_ASSOCIATION" and prose "Business Association", typos included) —
 * normalize to one key set that the message catalogs can label.
 */
export function normalizeAuthorType(raw: string): string {
  const s = raw.toUpperCase();
  if (s.includes("ACADEMIC")) return "academic";
  if (s.includes("ASSOCIATION") && s.includes("BUSINESS")) return "business_association";
  if (s.includes("COMPANY") || s.includes("BUSINESS")) return "company";
  if (s.includes("CONSUMER")) return "consumer";
  if (s.includes("ENVIRONMENTAL")) return "environmental";
  if (s.includes("NON-EU") || s.includes("NON_EU")) return "non_eu_citizen";
  if (s.includes("CITIZEN")) return "eu_citizen";
  if (s.includes("EXPERT")) return "expert";
  if (s.includes("NGO")) return "ngo";
  if (s.includes("PUBLIC")) return "public_authority";
  if (s.includes("TRADE") || s.includes("UNION")) return "trade_union";
  return "other";
}
