/**
 * The possible-duplicate pass against real Postgres (Codex review finding 1):
 * merge chains must end on the LIVE root, never strand evidence on a point
 * that is already merged. Runs only with PIPELINE_TEST_DATABASE_URL — point it
 * at the disposable probe copy (policy_probe), never at the dev database.
 */

import { createDb, sql, type Db } from "@policy/db";
import { FakeProvider } from "@policy/llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePossibleDuplicates } from "../src/canonicalize.ts";

const url = process.env.PIPELINE_TEST_DATABASE_URL;

describe.skipIf(!url)("resolvePossibleDuplicates (DB)", () => {
  let db: Db;
  let tenantId: string;
  const consultations: string[] = [];

  /** A fresh consultation with points A, B, C (one source each) and the chain B→A, C→B. */
  async function fixture(): Promise<{ consultationId: string; ids: Record<string, string> }> {
    const consultationId = ((await db.execute(sql`
      INSERT INTO consultations (tenant_id, title) VALUES (${tenantId}, 'dup-test') RETURNING id`)).rows[0] as { id: string }).id;
    consultations.push(consultationId);
    const sub = ((await db.execute(sql`
      INSERT INTO submissions (tenant_id, consultation_id, door, text) VALUES (${tenantId}, ${consultationId}, 'document', 'Text')
      RETURNING id`)).rows[0] as { id: string }).id;
    const ids: Record<string, string> = {};
    for (const name of ["A", "B", "C"]) {
      ids[name] = ((await db.execute(sql`
        INSERT INTO points (tenant_id, consultation_id, kind, label, summary, status, created_by)
        VALUES (${tenantId}, ${consultationId}, 'fact', ${`Punkt ${name}`}, ${`Zusammenfassung ${name}`}, 'released', 'test')
        RETURNING id`)).rows[0] as { id: string }).id;
      await db.execute(sql`
        INSERT INTO point_sources (tenant_id, point_id, submission_id, quote)
        VALUES (${tenantId}, ${ids[name]}, ${sub}, ${`Zitat ${name}`})`);
    }
    for (const [from, to, at] of [["B", "A", "2026-01-01T00:00:00Z"], ["C", "B", "2026-01-01T00:00:01Z"]] as const) {
      await db.execute(sql`
        INSERT INTO match_decisions (tenant_id, consultation_id, submission_id, candidate_label, outcome, method, provenance, created_at)
        VALUES (${tenantId}, ${consultationId}, ${sub}, ${`Punkt ${from}`}, 'new', 'test',
                ${JSON.stringify({ review: "possible_duplicate", createdPoint: ids[from], match: { reviewCandidate: ids[to] } })},
                ${at})`);
    }
    return { consultationId, ids };
  }

  async function expectAllOnA(consultationId: string, ids: Record<string, string>) {
    const pts = (await db.execute(sql`SELECT id, status, merged_into FROM points WHERE consultation_id = ${consultationId}`))
      .rows as { id: string; status: string; merged_into: string | null }[];
    const byId = new Map(pts.map((p) => [p.id, p]));
    expect(byId.get(ids.A!)!.status).toBe("released");
    expect(byId.get(ids.B!)!).toMatchObject({ status: "merged", merged_into: ids.A });
    expect(byId.get(ids.C!)!).toMatchObject({ status: "merged", merged_into: ids.A });
    const onA = (await db.execute(sql`SELECT quote FROM point_sources WHERE point_id = ${ids.A}`)).rows
      .map((x) => (x as { quote: string }).quote)
      .sort();
    expect(onA).toEqual(["Zitat A", "Zitat B", "Zitat C"]);
  }

  const same = { decision: "matched", matched_index: 0, confidence: 0.9 };

  beforeAll(async () => {
    db = createDb(url!);
    const tag = `dup-test-${Date.now()}`;
    tenantId = ((await db.execute(sql`INSERT INTO tenants (slug, name) VALUES (${tag}, ${tag}) RETURNING id`)).rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    // audit_log is append-only: the test tenant's audit rows stay (probe copy only).
    for (const c of consultations) {
      await db.execute(sql`DELETE FROM match_decisions WHERE consultation_id = ${c}`);
      await db.execute(sql`DELETE FROM point_sources WHERE point_id IN (SELECT id FROM points WHERE consultation_id = ${c})`);
      await db.execute(sql`UPDATE points SET merged_into = NULL WHERE consultation_id = ${c}`);
      await db.execute(sql`DELETE FROM points WHERE consultation_id = ${c}`);
      await db.execute(sql`DELETE FROM submissions WHERE consultation_id = ${c}`);
    }
  });

  it("merges a chain onto the live root and moves every unique source there", async () => {
    const { consultationId, ids } = await fixture();
    const llm = new FakeProvider();
    llm.enqueue(same, same);
    const r = await resolvePossibleDuplicates(db, llm, { id: consultationId, tenantId }, 2, () => {});
    expect(r).toMatchObject({ checked: 2, merged: 2, failed: 0 });
    await expectAllOnA(consultationId, ids);
  });

  it("resumes a check whose target was merged in the meantime", async () => {
    const { consultationId, ids } = await fixture();
    // Run 1: B→A succeeds, the call for C→B fails (empty fake queue).
    const first = new FakeProvider();
    first.enqueue(same);
    const r1 = await resolvePossibleDuplicates(db, first, { id: consultationId, tenantId }, 1, () => {});
    expect(r1).toMatchObject({ merged: 1, failed: 1 });
    // Run 2: C→B is still pending although B is merged now — it lands on A.
    const second = new FakeProvider();
    second.enqueue(same);
    const r2 = await resolvePossibleDuplicates(db, second, { id: consultationId, tenantId }, 1, () => {});
    expect(r2).toMatchObject({ checked: 1, merged: 1, failed: 0 });
    await expectAllOnA(consultationId, ids);
  });
});
