/**
 * Opens the FICTIONAL demo for citizens: the start skeleton and the points
 * the machine recommends are released — recorded as "demo", not as a person
 * of the editorial team — so the doors can be tried at once. Points the
 * machine had doubts about stay in the queue. Run after seed-demo's jobs.
 * Opening again after an evaluation drops the demo's results and reports
 * (milestone 4), so it can be closed, evaluated and reported once more.
 * While open it also clears what the machine is sure about after door-2
 * points came in (demo-tuer2.mts): the editors' one-click default — release
 * or reject a new point as recommended, confirm an assignment the machine
 * proposed. Anything with personal data or a "please check" stays in the
 * queue for a person.
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/open-demo.mts
 */
import { createDb, sql } from "@policy/db";
import { confirmMove, rejectNode, releaseNode, syncDerivedVotes } from "@policy/pipeline/kern";

const db = createDb(process.env.DATABASE_URL!);
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];

const [c] = await rows(sql`
  SELECT c.id, c.tenant_id, c.consultation_id FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
  WHERE t.slug = 'musterstadt' AND c.slug = 'solarpflicht' AND c.fictional`);
if (!c) throw new Error("no fictional demo campaign");
const busy = await rows(sql`SELECT 1 FROM campaign_jobs WHERE campaign_id = ${c.id as string} AND state IN ('wartet', 'laeuft')`);
if (busy.length) throw new Error("the machine is still working on the demo — wait until its jobs are done");
const nodes = await rows(sql`
  SELECT id FROM map_points WHERE consultation_id = ${c.consultation_id as string} AND status = 'draft'
    AND (rolle <> 'beitrag' OR (review->>'verdict' = 'release' AND NOT (review->'flags') ? 'personal_data')) ORDER BY ord`);
for (const n of nodes) await releaseNode(db, { tenantId: c.tenant_id as string, nodeId: n.id as string, actor: "demo" });
const rejects = await rows(sql`
  SELECT id FROM map_points WHERE consultation_id = ${c.consultation_id as string} AND status = 'draft' AND rolle = 'beitrag'
    AND review->>'verdict' = 'reject' AND NOT (review->'flags') ? 'personal_data'`);
for (const n of rejects) await rejectNode(db, { tenantId: c.tenant_id as string, nodeId: n.id as string, actor: "demo", reason: "kein_argument" });
const waiting = await rows(sql`
  SELECT m.id FROM moves m JOIN map_points p ON p.id = m.map_point_id
  WHERE m.consultation_id = ${c.consultation_id as string} AND m.state = 'vorgelegt' AND p.status = 'released'
    AND m.route IN ('unsicher', 'gegenteil') AND NOT COALESCE((m.decision->>'einspruch')::boolean, false)`);
for (const m of waiting) await confirmMove(db, { tenantId: c.tenant_id as string, moveId: m.id as string, actor: "demo" });
await syncDerivedVotes(db, c.consultation_id as string);
await db.execute(sql`DELETE FROM campaign_reports WHERE campaign_id = ${c.id as string}`);
await db.execute(sql`DELETE FROM campaign_results WHERE campaign_id = ${c.id as string}`);
const [prev] = await rows(sql`SELECT state FROM campaigns WHERE id = ${c.id as string}`);
await db.execute(sql`UPDATE campaigns SET state = 'offen', updated_at = now() WHERE id = ${c.id as string}`);
await db.execute(sql`
  INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
  VALUES (${c.tenant_id as string}, 'demo', 'campaign.state', 'campaign', ${c.id as string}, ${JSON.stringify({ from: prev!.state, to: "offen" })})`);
const [left] = await rows(sql`SELECT count(*)::int AS n FROM map_points WHERE consultation_id = ${c.consultation_id as string} AND status = 'draft'`);
console.log(`demo open: ${nodes.length} points released, ${rejects.length} rejected, ${waiting.length} assignments confirmed, ${left!.n} points left in the editorial queue`);
process.exit(0);
