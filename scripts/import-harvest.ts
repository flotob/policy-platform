/**
 * Import a harvester export bundle into the platform as a consultation with
 * submissions (door: document).
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/import-harvest.ts \
 *     <export-dir> --tenant <slug> [--title "..."]
 *
 * Idempotent: consultations key on (tenant, source_system, source_ref),
 * submissions on (consultation, source_system, source_ref).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

interface HarvestResponse {
  source_response_id: string;
  author_org: string | null;
  author_type: string | null;
  language: string | null;
  submitted_at: string | null;
  text: string | null;
  pii_status: string;
  attachments: { filename: string; extracted_text: string | null }[];
}

async function main() {
  const [, , exportDir, ...rest] = process.argv;
  if (!exportDir) throw new Error("usage: import-harvest.ts <export-dir> --tenant <slug>");
  const tenantSlug = rest[rest.indexOf("--tenant") + 1];
  if (!tenantSlug || tenantSlug.startsWith("--")) throw new Error("--tenant <slug> required");
  const titleIdx = rest.indexOf("--title");
  const titleOverride = titleIdx >= 0 ? rest[titleIdx + 1] : undefined;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const meta = JSON.parse(
    readFileSync(join(exportDir, "consultation.json"), "utf-8"),
  );
  const responses: HarvestResponse[] = readFileSync(
    join(exportDir, "responses.jsonl"),
    "utf-8",
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const tenant = await client.query("SELECT id FROM tenants WHERE slug = $1", [
    tenantSlug,
  ]);
  if (tenant.rows.length === 0) throw new Error(`no tenant with slug "${tenantSlug}"`);
  const tenantId = tenant.rows[0].id;

  const sourceSystem = `harvester:${meta.source_system}`;
  const sourceRef = String(meta.source_id);
  const title = titleOverride ?? meta.title ?? `${sourceSystem}:${sourceRef}`;

  const consultation = await client.query(
    `INSERT INTO consultations (tenant_id, title, status, source_system, source_ref)
     VALUES ($1, $2, 'imported', $3, $4)
     ON CONFLICT (tenant_id, source_system, source_ref)
       WHERE source_system IS NOT NULL
     DO UPDATE SET title = excluded.title
     RETURNING id`,
    [tenantId, title, sourceSystem, sourceRef],
  );
  const consultationId = consultation.rows[0].id;

  let imported = 0;
  let skippedEmpty = 0;
  for (const response of responses) {
    const attachmentTexts = (response.attachments ?? [])
      .map((a) => a.extracted_text)
      .filter((t): t is string => Boolean(t && t.trim()));
    const fullText = [response.text, ...attachmentTexts]
      .filter((t): t is string => Boolean(t && t.trim()))
      .join("\n\n");
    if (!fullText) {
      skippedEmpty++;
      continue;
    }
    await client.query(
      `INSERT INTO submissions
         (tenant_id, consultation_id, door, author_org, author_type, language,
          source_system, source_ref, text, submitted_at)
       VALUES ($1, $2, 'document', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (consultation_id, source_system, source_ref)
       DO UPDATE SET text = excluded.text, author_org = excluded.author_org`,
      [
        tenantId,
        consultationId,
        response.author_org,
        response.author_type,
        response.language?.toLowerCase() ?? null,
        sourceSystem,
        response.source_response_id,
        fullText,
        response.submitted_at ? new Date(response.submitted_at.replace(" ", "T")) : null,
      ],
    );
    imported++;
  }

  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
     VALUES ($1, 'system:import-harvest', 'consultation.import', 'consultation', $2, $3)`,
    [
      tenantId,
      consultationId,
      JSON.stringify({ sourceSystem, sourceRef, imported, skippedEmpty }),
    ],
  );

  console.log(
    `${sourceSystem}:${sourceRef} → consultation ${consultationId}: ` +
      `${imported} submissions imported, ${skippedEmpty} empty skipped`,
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
