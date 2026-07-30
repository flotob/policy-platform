/**
 * Turn a harvested OPC questionnaire into the argument-map + vote structure:
 * closed questions → released points+statements; respondents → participants;
 * answers → votes (agree/disagree/pass). The WHOLE dataset — every respondent,
 * every language; no filtering.
 *
 * Usage: DATABASE_URL=... tsx scripts/questionnaire-import.ts \
 *          <harvester-export-dir> --tenant <slug> --title "..."
 *
 * Answer mapping (documented, deterministic):
 *   Yes* / leading 4-5 / Much / Very much / Rather yes  → agree (1)
 *   No* / leading 1-2 / Not at all / Rather not         → disagree (-1)
 *   No opinion / I don't know / Neutral / leading 3 / blank → pass (0)
 * A question column becomes votable when ≥ 60% of its non-empty answers map;
 * skipped columns are logged (free text, multi-option categoricals).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

function mapAnswer(value: string): -1 | 0 | 1 | null {
  const v = value.trim().replace(/&apos;/g, "'");
  if (!v) return 0;
  const lower = v.toLowerCase();
  if (/^(no opinion|i don'?t know|don'?t know|neutral|3\b)/.test(lower)) return 0;
  if (/^(yes|much|very much|rather yes|agree|strongly agree)/.test(lower)) return 1;
  if (/^(no|not at all|rather not|disagree|strongly disagree)/.test(lower)) return -1;
  const likert = /^([1-5])\s*[-–]/.exec(v);
  if (likert) {
    const n = Number(likert[1]);
    return n >= 4 ? 1 : n <= 2 ? -1 : 0;
  }
  return null;
}

async function main() {
  const [, , exportDir, ...rest] = process.argv;
  const tenantSlug = rest[rest.indexOf("--tenant") + 1];
  const titleIdx = rest.indexOf("--title");
  const title = titleIdx >= 0 ? rest[titleIdx + 1] : undefined;
  if (!exportDir || !tenantSlug) {
    throw new Error("usage: questionnaire-import.ts <export-dir> --tenant <slug> [--title ...]");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const meta = JSON.parse(readFileSync(join(exportDir, "consultation.json"), "utf-8"));
  const responses = readFileSync(join(exportDir, "responses.jsonl"), "utf-8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.source_response_id?.startsWith("opc:") && r.answers);

  if (responses.length === 0) throw new Error("no OPC responses with answers in export");

  const tenant = await client.query("SELECT id FROM tenants WHERE slug = $1", [tenantSlug]);
  const tenantId = tenant.rows[0].id;
  const sourceSystem = `harvester:${meta.source_system}:opc`;
  const sourceRef = String(meta.source_id);

  const consultation = await client.query(
    `INSERT INTO consultations (tenant_id, title, status, source_system, source_ref)
     VALUES ($1, $2, 'imported', $3, $4)
     ON CONFLICT (tenant_id, source_system, source_ref) WHERE source_system IS NOT NULL
     DO UPDATE SET title = excluded.title RETURNING id`,
    [tenantId, title ?? meta.title, sourceSystem, sourceRef],
  );
  const consultationId = consultation.rows[0].id;

  // 1. Determine votable questions across the whole dataset.
  const questionStats = new Map<string, { mapped: number; total: number }>();
  for (const r of responses) {
    const answers: Record<string, string> = JSON.parse(r.answers);
    for (const [q, v] of Object.entries(answers)) {
      if (!v.trim()) continue;
      const s = questionStats.get(q) ?? { mapped: 0, total: 0 };
      s.total++;
      if (mapAnswer(v) !== null) s.mapped++;
      questionStats.set(q, s);
    }
  }
  const votable = [...questionStats.entries()]
    .filter(([, s]) => s.total >= 20 && s.mapped / s.total >= 0.6)
    .map(([q]) => q);
  const skipped = questionStats.size - votable.length;
  console.log(`questions: ${questionStats.size} total → ${votable.length} votable, ${skipped} skipped (free text / categorical)`);

  // 2. Points + statements for votable questions (released — they ARE the questionnaire).
  const statementIdByQuestion = new Map<string, string>();
  for (const q of votable) {
    const label = q.length > 110 ? q.slice(0, 107) + "…" : q;
    const point = await client.query(
      `INSERT INTO points (tenant_id, consultation_id, kind, slot, label, summary, status, created_by)
       VALUES ($1, $2, 'value', NULL, $3, $4, 'released', 'import:questionnaire')
       RETURNING id`,
      [tenantId, consultationId, label, q],
    );
    const statement = await client.query(
      `INSERT INTO statements (tenant_id, point_id, locale, text, status)
       VALUES ($1, $2, 'en', $3, 'released') RETURNING id`,
      [tenantId, point.rows[0].id, q],
    );
    statementIdByQuestion.set(q, statement.rows[0].id);
  }

  // 3. Participants + votes — every respondent, no filtering.
  let voteCount = 0;
  for (const r of responses) {
    const participant = await client.query(
      `INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, country, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (consultation_id, source_ref) DO UPDATE SET author_org = excluded.author_org
       RETURNING id`,
      [tenantId, consultationId, r.source_response_id, r.author_org, r.author_type, r.country, r.language],
    );
    const participantId = participant.rows[0].id;
    const answers: Record<string, string> = JSON.parse(r.answers);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const q of votable) {
      const statementId = statementIdByQuestion.get(q)!;
      const value = mapAnswer(answers[q] ?? "");
      if (value === null) continue; // unmappable individual answer on a votable question
      params.push(tenantId, participantId, statementId, value);
      values.push(`($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length})`);
    }
    if (values.length > 0) {
      await client.query(
        `INSERT INTO votes (tenant_id, participant_id, statement_id, value)
         VALUES ${values.join(", ")}
         ON CONFLICT (participant_id, statement_id) DO UPDATE SET value = excluded.value`,
        params,
      );
      voteCount += values.length;
    }
  }

  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
     VALUES ($1, 'system:questionnaire-import', 'consultation.import_questionnaire', 'consultation', $2, $3)`,
    [tenantId, consultationId, JSON.stringify({ participants: responses.length, votable: votable.length, votes: voteCount, skipped })],
  );

  console.log(`→ consultation ${consultationId}: ${responses.length} participants, ${votable.length} statements, ${voteCount} votes`);
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
