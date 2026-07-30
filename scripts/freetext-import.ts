/**
 * Import the FREE-TEXT side of a harvested OPC questionnaire as submissions,
 * attached to the already-imported consultation (the one holding the real
 * votes) — so decomposition can put argued points on the same map.
 *
 * Per respondent, the submission text is the top-level position text (if any)
 * plus every long free-text answer, each prefixed with its question. The
 * WHOLE dataset, every language; respondents below --min-chars carry no
 * decomposable argument and are skipped.
 *
 * Usage: DATABASE_URL=... tsx scripts/freetext-import.ts \
 *          <harvester-export-dir> --consultation <source_ref> [--min-chars 400]
 *
 * Idempotent: existing (consultation, source_ref) submissions are skipped.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const MIN_ANSWER_CHARS = 200;

/** OPC exports mix ISO timestamps with dd/mm/yyyy hh:mm — normalize or drop. */
function parseSubmittedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/.exec(value.trim());
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4]}:00Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const exportDir = process.argv[2];
  const consultation = arg("consultation");
  const minChars = Number(arg("min-chars") ?? 400);
  if (!exportDir || !consultation) {
    throw new Error("usage: freetext-import.ts <export-dir> --consultation <source_ref>");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cons = await client.query(
    `SELECT id, tenant_id FROM consultations
     WHERE id::text = $1 OR source_ref = $1 ORDER BY created_at DESC LIMIT 1`,
    [consultation],
  );
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId } = cons.rows[0];

  const responses = readFileSync(join(exportDir, "responses.jsonl"), "utf-8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  const existing = await client.query(
    `SELECT source_ref FROM submissions WHERE consultation_id = $1`,
    [consultationId],
  );
  const seen = new Set(existing.rows.map((r) => r.source_ref));

  let imported = 0;
  let skippedShort = 0;
  for (const r of responses) {
    if (!r.source_response_id || seen.has(r.source_response_id)) continue;

    const parts: string[] = [];
    if (typeof r.text === "string" && r.text.trim()) parts.push(r.text.trim());
    let answers: Record<string, unknown> = {};
    if (r.answers) {
      answers = typeof r.answers === "string" ? JSON.parse(r.answers) : r.answers;
    }
    for (const [question, value] of Object.entries(answers)) {
      if (typeof value !== "string" || value.trim().length < MIN_ANSWER_CHARS) continue;
      parts.push(`Frage/Question: ${question}\nAntwort/Answer: ${value.trim()}`);
    }
    const text = parts.join("\n\n");
    if (text.length < minChars) {
      skippedShort++;
      continue;
    }

    await client.query(
      `INSERT INTO submissions
         (tenant_id, consultation_id, door, author_org, author_type, language,
          source_system, source_ref, text, submitted_at)
       VALUES ($1, $2, 'statement', $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        consultationId,
        r.author_org,
        r.author_type,
        r.language,
        "harvester:hys:freetext",
        r.source_response_id,
        text,
        parseSubmittedAt(r.submitted_at),
      ],
    );
    imported++;
  }

  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
     VALUES ($1, 'system:freetext-import', 'consultation.import_freetext', 'consultation', $2, $3)`,
    [tenantId, consultationId, JSON.stringify({ responses: responses.length, imported, skippedShort })],
  );

  console.log(
    `→ ${imported} free-text submissions imported ` +
      `(${skippedShort} below ${minChars} chars, ${seen.size} already present, ${responses.length} responses total)`,
  );
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
