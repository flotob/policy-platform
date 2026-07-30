/**
 * Generate votable statements (de + en drafts) for released points that
 * don't have any yet.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @policy/pipeline statements -- \
 *     --consultation <source_ref|uuid> [--limit 20] [--model claude-sonnet-5]
 *
 * Uses the Agent SDK provider (local Claude Code auth); sequential with
 * per-point fault tolerance — reruns are cheap, done points are skipped.
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { generateStatementsForPoint } from "../src/statements.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const limit = Number(arg("limit") ?? 20);
  const model = arg("model");

  const db = createDb(url);
  const rows = await db.execute(sql`
    SELECT p.id, p.label
    FROM points p
    JOIN consultations c ON c.id = p.consultation_id
    WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
      AND p.status = 'released'
      AND NOT EXISTS (SELECT 1 FROM statements st WHERE st.point_id = p.id)
    ORDER BY p.created_at ASC
    LIMIT ${limit}
  `);
  console.log(`${rows.rows.length} released points without statements`);

  const provider = new AgentSdkProvider();
  let ok = 0;
  let failed = 0;
  for (const row of rows.rows as { id: string; label: string }[]) {
    console.log(`→ ${row.label.slice(0, 80)}…`);
    const started = Date.now();
    try {
      await generateStatementsForPoint(db, provider, row.id, model);
      ok++;
      console.log(`  de+en drafted [${Math.round((Date.now() - started) / 1000)}s]`);
    } catch (err) {
      failed++;
      console.log(`  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${ok} points drafted, ${failed} failed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
