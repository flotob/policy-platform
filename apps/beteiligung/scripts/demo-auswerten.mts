/**
 * Evaluates the FICTIONAL demo (Musterstadt, Solarpflicht) once more on the current code, from an
 * open participation to a published report, as the town would by button — recorded as actor
 * "demo": close (B13) and store the result (W9), keep the camp names the editors confirmed last
 * time (if the camps are the same number), write the report (R1, then R2/R3 with the language
 * model and Jev), release (R4) and publish (R5). A council decision, if one was entered, is
 * dropped: it belonged to the old result (demo-beschluss.mts writes it again).
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/demo-auswerten.mts
 * Needs the language model and Jev (the report). A closed or published demo is opened again first.
 */
import { sql } from "@policy/db";

import { saveResult, setCampNames } from "../src/lib/auswertung.ts";
import { getReport, namingOf, startReport } from "../src/lib/bericht.ts";
import { getCampaign } from "../src/lib/campaigns.ts";
import { getDb } from "../src/lib/db.ts";
import { enqueue } from "../src/lib/kern.ts";
import { drain } from "../src/lib/worker.ts";

const db = getDb();
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];
const audit = (tenant: string, action: string, kind: string, id: string, payload: unknown) =>
  db.execute(sql`INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload) VALUES (${tenant}, 'demo', ${action}, ${kind}, ${id}, ${JSON.stringify(payload)})`);

const [x] = await rows(sql`
  SELECT c.id, c.tenant_id, t.name FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
  WHERE t.slug = 'musterstadt' AND c.slug = 'solarpflicht' AND c.fictional`);
if (!x) throw new Error("no fictional demo campaign");
const c = (await getCampaign(x.tenant_id as string, x.id as string))!;
const busy = await rows(sql`SELECT 1 FROM campaign_jobs WHERE campaign_id = ${c.id} AND state IN ('wartet', 'laeuft')`);
if (busy.length) throw new Error("the machine is still working on the demo — wait until its jobs are done");

// The names the editors confirmed for the last result: kept when the camps are the same number.
const [prev] = await rows(sql`
  SELECT r.camp_names FROM campaign_results r WHERE r.campaign_id = ${c.id} AND r.camp_names IS NOT NULL ORDER BY r.version DESC LIMIT 1`);
const prevNaming = namingOf(prev?.camp_names);

// Closed or published: open again. The old result, its reports and the council decision go — they belong to the old votes.
if (c.state !== "offen") {
  await db.execute(sql`DELETE FROM campaign_reports WHERE campaign_id = ${c.id}`);
  await db.execute(sql`DELETE FROM campaign_results WHERE campaign_id = ${c.id}`);
  await db.execute(sql`UPDATE campaigns SET state = 'offen', updated_at = now() WHERE id = ${c.id}`);
  await audit(c.tenantId, "campaign.state", "campaign", c.id, { from: c.state, to: "offen" });
}
await db.execute(sql`DELETE FROM point_decisions WHERE campaign_id = ${c.id}`);
await db.execute(sql`DELETE FROM campaign_decisions WHERE campaign_id = ${c.id}`);
await db.execute(sql`UPDATE campaigns SET state = 'auswertung', updated_at = now() WHERE id = ${c.id}`);
const saved = await saveResult({ ...c, state: "auswertung" }, "demo");
await audit(c.tenantId, "campaign.state", "campaign", c.id, { from: "offen", to: "auswertung", result: saved.id, version: saved.version, matrix: saved.result.matrixHash });
const r = saved.result;
console.log(`result v${saved.version}: ${r.participation.voters} voters (${r.participation.drawn ?? 0} drawn), camps ${JSON.stringify(r.camps)}`);
const bridges = r.statements.filter((s) => s.category === "bruecke");
console.log(
  `bridges ${bridges.length}: fragile ${bridges.filter((s) => s.check && !s.check.robust).map((s) => s.nr).join(",") || "-"}; ` +
    `lot faellt ${bridges.filter((s) => s.check?.lot?.status === "faellt").map((s) => s.nr).join(",") || "-"}; ` +
    `lot zu_wenige ${bridges.filter((s) => s.check?.lot?.status === "zu_wenige").map((s) => s.nr).join(",") || "-"}`,
);

if (r.camps) {
  const old = prevNaming;
  if (old && old.names.length === r.camps.k) {
    await setCampNames(saved.id, { names: old.names, descriptions: old.descriptions, proposal: old.proposal ?? null, confirmedBy: "demo", confirmedAt: new Date().toISOString() });
    console.log(`camp names kept: ${old.names.join(" / ")}`);
  } else {
    await enqueue(c.tenantId, c.id, "lagernamen", null, null, { resultId: saved.id });
    await drain();
    const [n] = await rows(sql`SELECT camp_names FROM campaign_results WHERE id = ${saved.id}`);
    const proposal = namingOf(n?.camp_names)?.proposal;
    if (!proposal) throw new Error("the machine proposed no camp names");
    await setCampNames(saved.id, { names: proposal.names, descriptions: proposal.descriptions, proposal, confirmedBy: "demo", confirmedAt: new Date().toISOString() });
    console.log(`camp names proposed and taken: ${proposal.names.join(" / ")}`);
  }
}

const fresh = (await rows(sql`SELECT * FROM campaign_results WHERE id = ${saved.id}`))[0]!;
let report = await startReport(c, { ...saved, campNames: fresh.camp_names }, x.name as string);
await db.execute(sql`UPDATE campaigns SET state = 'bericht', updated_at = now() WHERE id = ${c.id}`);
await audit(c.tenantId, "report.created", "campaign_report", report.id, { version: report.version, result: saved.id, sentences: report.sentences.length });
for (let attempt = 0; attempt < 3; attempt++) {
  await drain();
  report = (await getReport(c.id, report.id))!;
  console.log(`report v${report.version}: ${report.state}`);
  if (report.state === "geprueft") break;
  if (report.state === "durchgefallen") await enqueue(c.tenantId, c.id, "bericht", null, null, { reportId: report.id });
}
if (report.state !== "geprueft") throw new Error(`the report did not pass its checks (${report.state}) — look at it in the workspace`);
await db.execute(sql`UPDATE campaign_reports SET state = 'freigegeben', decided_by = 'demo', decided_at = now(), updated_at = now() WHERE id = ${report.id}`);
await audit(c.tenantId, "report.freigegeben", "campaign_report", report.id, { version: report.version });
await db.execute(sql`UPDATE campaign_reports SET state = 'veroeffentlicht', updated_at = now() WHERE id = ${report.id}`);
await db.execute(sql`UPDATE campaigns SET state = 'veroeffentlicht', updated_at = now() WHERE id = ${c.id}`);
await audit(c.tenantId, "report.veroeffentlicht", "campaign_report", report.id, { version: report.version, result: saved.id });
await audit(c.tenantId, "campaign.state", "campaign", c.id, { from: "bericht", to: "veroeffentlicht" });
console.log("published");
process.exit(0);
