/**
 * Integration test of the decomposition pipeline against real Postgres
 * (skipped without DATABASE_URL) using the FakeProvider — verifies the
 * database effects: draft points, provenance spans, match decisions,
 * audit entries, and the match flow across two submissions.
 */

import { createDb, type Db } from "@policy/db";
import { FakeProvider } from "@policy/llm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runForSubmission } from "../src/pipeline.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("decomposition pipeline (db-backed)", () => {
  let db: Db;
  let raw: pg.Client;
  let consultationId: string;
  let sub1: string;
  let sub2: string;

  beforeAll(async () => {
    db = createDb(url!);
    raw = new pg.Client({ connectionString: url });
    await raw.connect();
    const tenant = await raw.query(
      `INSERT INTO tenants (slug, name) VALUES (gen_random_uuid()::text, 'PipeTest')
       RETURNING id`,
    );
    const tenantId = tenant.rows[0].id;
    const consultation = await raw.query(
      `INSERT INTO consultations (tenant_id, title) VALUES ($1, 'Pipeline Test')
       RETURNING id`,
      [tenantId],
    );
    consultationId = consultation.rows[0].id;
    const subs = await raw.query(
      `INSERT INTO submissions (tenant_id, consultation_id, door, text, language)
       VALUES ($1, $2, 'document', 'Die Netzkapazität reicht aus. Und der Eingriff ins Eigentum ist nicht hinnehmbar.', 'de'),
              ($1, $2, 'document', 'Unsere Messungen zeigen: die Netze halten das aus. Außerdem fehlen Fachkräfte.', 'de')
       RETURNING id`,
      [tenantId, consultationId],
    );
    sub1 = subs.rows[0].id;
    sub2 = subs.rows[1].id;
  });

  afterAll(async () => {
    await raw.end();
  });

  it("first submission: all candidates become new draft points", async () => {
    const provider = new FakeProvider();
    provider.enqueue({
      points: [
        {
          label: "Netzkapazität reicht aus",
          summary: "Die Verteilnetze können den zusätzlichen Strom aufnehmen.",
          kind: "fact",
          slot: "P2",
          quote: "Die Netzkapazität reicht aus.",
        },
        {
          label: "Eigentumseingriff nicht hinnehmbar",
          summary: "Der Eingriff in das Eigentum ist nicht zu rechtfertigen.",
          kind: "value",
          slot: "P4",
          quote: "der Eingriff ins Eigentum ist nicht hinnehmbar",
        },
      ],
    });

    const result = await runForSubmission(db, provider, sub1);
    expect(result).toMatchObject({ candidates: 2, created: 2, matched: 0 });

    const pts = await raw.query(
      "SELECT kind, slot, status, created_by FROM points WHERE consultation_id = $1 ORDER BY created_at",
      [consultationId],
    );
    expect(pts.rows).toHaveLength(2);
    expect(pts.rows[0]).toMatchObject({ kind: "fact", slot: "P2", status: "draft" });
    expect(pts.rows[0].created_by).toContain("fake");

    const sources = await raw.query(
      "SELECT span_start, span_end, quote FROM point_sources WHERE submission_id = $1 ORDER BY created_at",
      [sub1],
    );
    expect(sources.rows).toHaveLength(2);
    expect(sources.rows[0].span_start).toBe(0); // verbatim quote located
  });

  it("second submission: match folds into existing point, new one created", async () => {
    const provider = new FakeProvider();
    provider.enqueue(
      {
        points: [
          {
            label: "Netze halten Einspeisung aus",
            summary: "Messdaten zeigen ausreichende Netzkapazität.",
            kind: "fact",
            slot: "P2",
            quote: "die Netze halten das aus",
          },
          {
            label: "Fachkräftemangel",
            summary: "Es fehlen Fachkräfte für die Umsetzung.",
            kind: "fact",
            slot: null,
            quote: "Außerdem fehlen Fachkräfte.",
          },
        ],
      },
      // match call for candidate 1 → same as existing point 0
      { decision: "matched", matched_index: 0, confidence: 0.92 },
      // match call for candidate 2 → new
      { decision: "new", matched_index: null, confidence: 0.85 },
    );

    const result = await runForSubmission(db, provider, sub2);
    expect(result).toMatchObject({ candidates: 2, created: 1, matched: 1 });

    const pts = await raw.query(
      "SELECT count(*)::int AS n FROM points WHERE consultation_id = $1",
      [consultationId],
    );
    expect(pts.rows[0].n).toBe(3); // 2 + 1 new, not 4

    const decisions = await raw.query(
      `SELECT outcome, confidence, matched_point IS NOT NULL AS has_match
       FROM match_decisions WHERE submission_id = $1 ORDER BY created_at`,
      [sub2],
    );
    expect(decisions.rows[0]).toMatchObject({ outcome: "matched", has_match: true });
    expect(decisions.rows[1]).toMatchObject({ outcome: "new", has_match: false });

    // the matched point now has sources from BOTH submissions
    const shared = await raw.query(
      `SELECT count(DISTINCT submission_id)::int AS n FROM point_sources
       WHERE point_id = (SELECT matched_point FROM match_decisions
                         WHERE submission_id = $1 AND outcome = 'matched')`,
      [sub2],
    );
    expect(shared.rows[0].n).toBe(2);
  });

  it("audit log records the decomposition runs", async () => {
    const entries = await raw.query(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE action = 'submission.decompose' AND subject_id IN ($1, $2)`,
      [sub1, sub2],
    );
    expect(entries.rows[0].n).toBe(2);
  });
});
