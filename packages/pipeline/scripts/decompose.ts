/**
 * Run the decomposition pipeline over imported submissions.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @policy/pipeline decompose -- \
 *     --consultation <source_ref|uuid> [--limit 2] [--model claude-sonnet-5]
 *
 * Uses the Agent SDK provider (local Claude Code auth). Processes only
 * submissions without prior match decisions; sequential, politely paced.
 */

import { createDb, eq, sql, submissions } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { runForSubmission } from "../src/pipeline.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const limit = Number(arg("limit") ?? 3);
  const model = arg("model");

  const db = createDb(url);
  const rows = await db.execute(sql`
    SELECT s.id, s.author_org, length(s.text) AS chars
    FROM submissions s
    JOIN consultations c ON c.id = s.consultation_id
    WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
      AND s.text IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM match_decisions m WHERE m.submission_id = s.id)
    ORDER BY length(s.text) ASC
    LIMIT ${limit}
  `);

  const provider = new AgentSdkProvider();
  for (const row of rows.rows as { id: string; author_org: string; chars: number }[]) {
    console.log(`→ ${row.author_org ?? row.id} (${row.chars} chars)…`);
    const started = Date.now();
    const result = await runForSubmission(db, provider, row.id, model);
    console.log(
      `  ${result.candidates} candidates → ${result.created} new points, ` +
        `${result.matched} matched${result.truncated ? " (text truncated)" : ""} ` +
        `[${Math.round((Date.now() - started) / 1000)}s]`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
