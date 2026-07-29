/**
 * Integration tests for schema v0 guarantees: tenant isolation via RLS and
 * the append-only audit log. Require a migrated Postgres (DATABASE_URL);
 * skipped otherwise — the Phase 0 acceptance run executes them for real.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("schema v0 guarantees", () => {
  let client: pg.Client;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const res = await client.query(
      `INSERT INTO tenants (slug, name)
       VALUES (gen_random_uuid()::text, 'A'), (gen_random_uuid()::text, 'B')
       RETURNING id`,
    );
    tenantA = res.rows[0].id;
    tenantB = res.rows[1].id;
    await client.query(
      `INSERT INTO consultations (tenant_id, title) VALUES ($1, 'A-only'), ($2, 'B-only')`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it("RLS: a non-owner role sees only its tenant's consultations", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE policy_app");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const rows = (
        await client.query("SELECT title, tenant_id FROM consultations")
      ).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("RLS: without app.tenant_id set, a non-owner role sees nothing", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE policy_app");
      const rows = (await client.query("SELECT * FROM consultations")).rows;
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("RLS: an empty-string app.tenant_id fails closed, not with an error", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE policy_app");
      await client.query("SELECT set_config('app.tenant_id', '', true)");
      const rows = (await client.query("SELECT * FROM consultations")).rows;
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("RLS: inserting into a foreign tenant is rejected", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE policy_app");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(
        client.query(
          "INSERT INTO consultations (tenant_id, title) VALUES ($1, 'sneaky')",
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("audit log rejects UPDATE and DELETE", async () => {
    const { rows } = await client.query(
      `INSERT INTO audit_log (actor, action) VALUES ('test', 'tenant.create')
       RETURNING id`,
    );
    const id = rows[0].id;
    await expect(
      client.query("UPDATE audit_log SET action = 'tampered' WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.query("DELETE FROM audit_log WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only/);
  });
});
