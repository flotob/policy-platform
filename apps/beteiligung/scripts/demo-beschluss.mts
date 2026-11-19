/**
 * The council's decision for the FICTIONAL demo only (Musterstadt, Solarpflicht) — invented, like
 * everything in this example, and marked as such on every page. It follows the published result:
 * the value questions are decided, the fact disputes go to a study, the doubts of the drawn
 * residents about the trades lead to a staggered start. Run after demo-auswerten.mts.
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/demo-beschluss.mts [--date 2026-11-24]
 */
import { sql } from "@policy/db";

import { publishedBundle } from "../src/lib/bericht.ts";
import { getCampaign } from "../src/lib/campaigns.ts";
import { getDb } from "../src/lib/db.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DATE = arg("date") ?? "2026-11-24";

const SUMMARY =
  "Der Gemeinderat hat die Solarpflicht für Neubauten mit 21 zu 14 Stimmen beschlossen. Sie gilt ab 2028, im ersten Jahr nur für Vorhaben ab drei Wohnungen. Eine Härtefallklausel und ein Zuschuss für junge Familien federn die Mehrkosten ab; wie die Kosten auf Mieten und Kaufpreise durchschlagen, klärt ein Gutachten bis Mitte 2027.";

/** Statement (found by its words) → how the council handled it, and one sentence. */
const POINTS: [RegExp, string, string | null][] = [
  [/Zwei Prozent Mehrkosten für dreißig Jahre/i, "abgefedert", "Die Mehrkosten bleiben, ein Zuschuss von bis zu 3.000 Euro für Familien unter der Einkommensgrenze des Landes fängt sie ab"],
  [/junge Familien an der Finanzierungsgrenze/i, "abgefedert", "Zuschuss für junge Familien, zusammen mit der Pflicht beschlossen"],
  [/Eingriff ins Eigentum ist durch das Gemeinwohlziel/i, "uebernommen", "Der Rat folgt der Abwägung der Stadt; sie steht in der Begründung der Satzung"],
  [/Klimaschutz rechtfertigt Pflichten/i, "uebernommen", "Mehrheit im Rat; die Minderheit wollte bei Anreizen bleiben"],
  [/Ausbau der Solarenergie in Musterstadt sollte beschleunigt/i, "uebernommen", null],
  [/zuerst ihre eigenen Dächer/i, "zurueckgestellt", "Die Pflicht wartet nicht auf die Stadt; die letzten 14 städtischen Dächer werden aber bis Ende 2027 belegt"],
  [/Übergangsfristen für die Solarpflicht in Musterstadt sollten mögli/i, "zurueckgestellt", "Die Frist endet am 31. Dezember 2027; eine längere hätte das Klimaziel 2035 verfehlt"],
  [/Mehrkosten einer Solarpflicht liegen bei einem kleinen Einfamilien/i, "gutachten", "Das Gutachten zu den Kostenfolgen klärt die Zahlen bis Mitte 2027"],
  [/Erstvermietungsmiete/i, "gutachten", "Teil des Gutachtens zu Mieten und Kaufpreisen"],
  [/Es fehlt bisher eine Untersuchung/i, "uebernommen", "Das Gutachten ist beauftragt"],
  [/Untersuchung zum Durchschlag der Mehrkosten/i, "uebernommen", "Beauftragt beim Institut für Wohnungswirtschaft, Ergebnis bis Juni 2027"],
  [/Mehrkosten einer Solaranlage auf dem Neubau liegen bei 1,5 bis 2/i, "gutachten", "Wird im Gutachten zu den Kostenfolgen geprüft"],
  [/Eingriff ins Eigentum ist begrenzt und bezifferbar/i, "gutachten", "Wird im Gutachten zu den Kostenfolgen beziffert"],
  [/Denkmalschutz verhindert/i, "gutachten", "Die Denkmalbehörde hat Stellung genommen: Ausnahmen sind im Einzelfall möglich, die Satzung nimmt Baudenkmäler aus"],
  [/ohne sauber geregelte Ausnahmen/i, "uebernommen", "Die Satzung regelt Ausnahmen für Baudenkmäler, starke Verschattung und Härtefälle ausdrücklich"],
  [/im ersten Jahr nur für Bauvorhaben ab drei Wohn/i, "uebernommen", "Gilt 2028 für Vorhaben ab drei Wohneinheiten, ab 2029 für alle Neubauten"],
  [/Härtefallklausel für kleine Bau/i, "uebernommen", null],
  [/parallel zur Solarpflicht die verbliebenen/i, "uebernommen", "Die letzten 14 städtischen Dächer werden bis Ende 2027 belegt"],
  [/kostenlose Erstberatu/i, "uebernommen", "Die Energieagentur berät ab Januar 2027 jeden Bauherrn kostenlos"],
  [/bereits eine Wärmepumpe/i, "zurueckgestellt", "Eine Befreiung hätte die Pflicht für die meisten Neubauten aufgehoben; der Rat berät das bei der Überprüfung 2030 erneut"],
  [/nicht so lang sein, dass/i, "uebernommen", null],
  [/auch gelten, wenn ein bestehendes/i, "nicht_beruecksichtigt", "Die Pflicht gilt nur für Neubauten; Anbauten bleiben ausgenommen, damit die Satzung einfach bleibt"],
  [/Handwerk in Musterstadt kann die Solarpflicht planen/i, "abgefedert", "Weil die Ausgelosten daran zweifeln, startet die Pflicht gestaffelt; die Handwerkskammer berichtet dem Rat 2028 über Wartezeiten"],
  [/Übergangsfristen geben Bauherren und Handwerk/i, "uebernommen", null],
];

const db = getDb();
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];
const [x] = await rows(sql`
  SELECT c.id, c.tenant_id FROM campaigns c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'musterstadt' AND c.slug = 'solarpflicht' AND c.fictional`);
if (!x) throw new Error("no fictional demo campaign");
const c = (await getCampaign(x.tenant_id as string, x.id as string))!;
const bundle = await publishedBundle(c);
if (!bundle) throw new Error("the demo has no published result — run demo-auswerten.mts first");

const chosen: { id: string; nr: number; outcome: string; reason: string | null }[] = [];
for (const [re, outcome, reason] of POINTS) {
  const s = bundle.result.statements.find((x) => re.test(x.text));
  if (!s) {
    console.warn(`no statement matches ${re}`);
    continue;
  }
  chosen.push({ id: s.id, nr: s.nr, outcome, reason: reason ?? null });
}
await db.transaction(async (tx) => {
  await tx.execute(sql`DELETE FROM point_decisions WHERE campaign_id = ${c.id}`);
  await tx.execute(sql`
    INSERT INTO campaign_decisions (campaign_id, tenant_id, gremium, datum, summary, state, published_at, published_by, updated_by)
    VALUES (${c.id}, ${c.tenantId}, 'Gemeinderat', ${DATE}, ${SUMMARY}, 'veroeffentlicht', now(), 'demo', 'demo')
    ON CONFLICT (campaign_id) DO UPDATE SET gremium = EXCLUDED.gremium, datum = EXCLUDED.datum, summary = EXCLUDED.summary,
      state = 'veroeffentlicht', published_at = now(), published_by = 'demo', updated_by = 'demo', updated_at = now()`);
  for (const p of chosen) {
    await tx.execute(sql`
      INSERT INTO point_decisions (campaign_id, map_point_id, tenant_id, outcome, reason, decided_by)
      VALUES (${c.id}, ${p.id}, ${c.tenantId}, ${p.outcome}, ${p.reason}, 'demo')`);
  }
  await tx.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${c.tenantId}, 'demo', 'decision.published', 'campaign', ${c.id}, ${JSON.stringify({ gremium: "Gemeinderat", datum: DATE, points: chosen.length, published: true })})`);
});
console.log(`decision of ${DATE} published, ${chosen.length} statements noted: ${chosen.map((p) => `${p.nr} ${p.outcome}`).join(", ")}`);
process.exit(0);
