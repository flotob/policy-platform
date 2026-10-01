/**
 * Import the documents of a harvester export bundle (documents.jsonl — the
 * bill, committee reports, hearing transcripts) into consultation_documents
 * of the matching consultation. The pipeline reads the measures from the
 * bill (propose-measures-bill.ts).
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/import-documents.ts <export-dir>
 *
 * Idempotent: documents key on (consultation, filename); text is refreshed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

interface HarvestDocument {
  kind: string;
  filename: string;
  source_url: string | null;
  extracted_text: string | null;
}

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) throw new Error("usage: import-documents.ts <export-dir>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const meta = JSON.parse(readFileSync(join(exportDir, "consultation.json"), "utf-8"));
  const cons = await client.query(
    `SELECT id, tenant_id, title FROM consultations WHERE source_system = $1 AND source_ref = $2`,
    [`harvester:${meta.source_system}`, String(meta.source_id)],
  );
  if (cons.rows.length === 0) throw new Error(`consultation ${meta.source_system}:${meta.source_id} not imported yet`);
  const { id: consultationId, tenant_id: tenantId, title } = cons.rows[0];

  const docs: HarvestDocument[] = readFileSync(join(exportDir, "documents.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let n = 0;
  for (const d of docs) {
    if (!d.extracted_text) continue;
    await client.query(
      `INSERT INTO consultation_documents (tenant_id, consultation_id, kind, filename, source_url, text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (consultation_id, filename) DO UPDATE SET kind = excluded.kind, text = excluded.text,
         source_url = excluded.source_url`,
      [tenantId, consultationId, d.kind, d.filename, d.source_url, d.extracted_text],
    );
    n++;
    console.log(`  ${d.kind.padEnd(40)} ${d.filename.padEnd(32)} ${d.extracted_text.length.toLocaleString("en")} chars`);
  }
  console.log(`${title}: ${n} documents imported`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
