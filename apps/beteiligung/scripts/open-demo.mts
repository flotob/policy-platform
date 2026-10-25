/**
 * Opens the FICTIONAL demo for citizens: the start skeleton and the points
 * the machine recommends are released — recorded as "demo", not as a person
 * of the editorial team — so the doors can be tried at once. Points the
 * machine had doubts about stay in the queue. Run after seed-demo's jobs.
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/open-demo.mts
 */
import { createDb, sql } from "@policy/db";
import { releaseNode, syncDerivedVotes } from "@policy/pipeline/kern";

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
    AND (rolle <> 'beitrag' OR review->>'verdict' = 'release') ORDER BY ord`);
for (const n of nodes) await releaseNode(db, { tenantId: c.tenant_id as string, nodeId: n.id as string, actor: "demo" });
await syncDerivedVotes(db, c.consultation_id as string);
await db.execute(sql`UPDATE campaigns SET state = 'offen', updated_at = now() WHERE id = ${c.id as string}`);
const [left] = await rows(sql`SELECT count(*)::int AS n FROM map_points WHERE consultation_id = ${c.consultation_id as string} AND status = 'draft'`);
console.log(`demo open: ${nodes.length} points released, ${left!.n} left in the editorial queue`);
process.exit(0);
