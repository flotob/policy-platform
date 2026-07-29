/**
 * Phase 0 acceptance: PDF → queue → worker → extracted text in the documents row.
 *
 * Usage: DATABASE_URL=... BLOB_DIR=./blobs pnpm tsx scripts/acceptance-extraction.ts <pdf>
 * Enqueues the extraction job; run the worker with --once, then verify with
 * the same script and --verify <document_id>.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import pg from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  const blobDir = process.env.BLOB_DIR ?? "./blobs";
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const [, , arg1, arg2] = process.argv;

  if (arg1 === "--verify") {
    const { rows } = await client.query(
      `SELECT d.filename, d.extraction_tool, length(d.extracted_text) AS chars,
              j.status AS job_status
       FROM documents d
       LEFT JOIN jobs j ON j.payload->>'document_id' = d.id::text
       WHERE d.id = $1`,
      [arg2],
    );
    console.log(rows[0]);
    const ok = rows[0]?.job_status === "done" && Number(rows[0]?.chars) > 0;
    await client.end();
    process.exit(ok ? 0 : 1);
  }

  const file = arg1;
  if (!file) throw new Error("usage: acceptance-extraction.ts <pdf> | --verify <id>");

  const content = readFileSync(file);
  const sha = createHash("sha256").update(content).digest("hex");
  const relPath = join(sha.slice(0, 2), `${sha}${extname(file).toLowerCase()}`);
  mkdirSync(join(blobDir, sha.slice(0, 2)), { recursive: true });
  copyFileSync(file, join(blobDir, relPath));

  const tenant = await client.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, 'Acceptance Tenant')
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`,
    ["acceptance"],
  );
  const tenantId = tenant.rows[0].id;

  const doc = await client.query(
    `INSERT INTO documents (tenant_id, filename, blob_path, sha256, size)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, basename(file), relPath, sha, content.length],
  );
  const documentId = doc.rows[0].id;

  await client.query(
    `INSERT INTO jobs (kind, payload) VALUES ('extract_document', $1)`,
    [
      JSON.stringify({
        document_id: documentId,
        blob_path: relPath,
        filename: basename(file),
      }),
    ],
  );
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id)
     VALUES ($1, 'system:acceptance', 'document.enqueue_extraction', 'document', $2)`,
    [tenantId, documentId],
  );

  console.log(`enqueued document ${documentId} (${relPath})`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
