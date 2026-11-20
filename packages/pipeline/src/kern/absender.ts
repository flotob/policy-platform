/**
 * Senders of statements the town brings in: one sender is one participant, however many files it sent.
 * Names are compared loosely ("Stadtwerke  musterstadt " = "Stadtwerke Musterstadt"); private persons
 * are never matched by name (we keep none to match on), only files uploaded together share one.
 */
export const senderKey = (name: string): string => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de");

/** The spelling of an earlier sender with the same name, if there is one: later files take it over. */
export function sameSender(name: string, known: (string | null | undefined)[]): string | null {
  const key = senderKey(name);
  if (!key) return null;
  return known.find((k) => !!k && senderKey(k) === key) ?? null;
}
