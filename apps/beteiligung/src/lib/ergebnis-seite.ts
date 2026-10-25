/** What the results page says around the numbers: the town, the period, how it was made. */

import { sql } from "@policy/db";
import type { Ergebnis } from "@policy/pipeline/kern";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { QUESTIONS } from "./params";

/** "Stadt Musterstadt" → "Musterstadt" */
export const townShort = (name: string) => name.replace(/^(Stadt|Gemeinde|Markt|Kreisstadt|Hansestadt|Landkreis)\s+/i, "");

export const questionLabels = QUESTIONS.map((q) => ({ key: q.key, label: q.label }));

const day = (d: Date) => d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });

/** "zwischen dem 12. Mai und dem 26. Juni 2026": from opening to closing, as the audit log has them (null when unknown). */
export async function periodOf(c: Campaign): Promise<string | null> {
  const r = await getDb().execute(sql`
    SELECT min(created_at) FILTER (WHERE payload->>'to' = 'offen') AS opened,
           max(created_at) FILTER (WHERE payload->>'to' = 'auswertung') AS closed
    FROM audit_log WHERE subject_kind = 'campaign' AND subject_id = ${c.id} AND action = 'campaign.state'`);
  const x = r.rows[0] as { opened: string | null; closed: string | null } | undefined;
  // What happened, not what was planned: the participation may close early (saturation) or late.
  const from = x?.opened ? new Date(x.opened) : null;
  const to = x?.closed ? new Date(x.closed) : null;
  if (!from || !to || to < from) return null;
  return day(from) === day(to) ? `am ${day(from)}` : `zwischen dem ${day(from)} und dem ${day(to)}`;
}

/** "Wie diese Seite entstanden ist" — true for this campaign, not for an ideal one. */
export function methodParagraphs(c: Campaign, r: Ergebnis): string[] {
  const made = {
    mensch: "Jede Eingabe wurde in einzelne Aussagen zerlegt, von einem Sprachmodell vorgeschlagen und von der Redaktion einzeln freigegeben.",
    assistiert: "Jede Eingabe wurde in einzelne Aussagen zerlegt; ein Sprachmodell hat vorgeschlagen und vorläufig entschieden, die Redaktion hat jede Entscheidung bestätigt oder korrigiert.",
    ki: "Jede Eingabe wurde in einzelne Aussagen zerlegt; neue Punkte hat die Maschine ohne menschliche Freigabe entschieden, die Redaktion hat Stichproben geprüft. Die Behauptungen der Stadt hat die Redaktion selbst freigegeben.",
  }[c.params.editorialMode];
  const out = [
    made,
    "Die Lager und die Zustimmungswerte sind aus der Abstimmungsmatrix berechnet, nach dem Verfahren von Polis. Die Einordnung jeder Aussage folgt aus zwei Zahlen und ihrem Typ, nicht aus einer Meinung der Maschine. Beim Lesen dieser Seite rechnet keine KI mehr.",
  ];
  if (r.participation.senders) out.push("Stellungnahmen zählen als Stimmen ihrer Absender: Wer einen Punkt stützt, stimmt ihm zu; wer ihm widerspricht, lehnt ihn ab.");
  const fictional = c.fictional
    ? ` Alle Inhalte dieses Beispiels sind erfunden${r.participation.simulated ? `, ${r.participation.simulated.toLocaleString("de-DE")} der ${r.participation.voters.toLocaleString("de-DE")} Teilnehmenden sind simuliert` : ""}; es zeigt, wie ein echter Anhang aussähe.`
    : "";
  out.push(`Wertungsfragen wurden zu keinem Zeitpunkt maschinell entschieden.${fictional}`);
  return out;
}
