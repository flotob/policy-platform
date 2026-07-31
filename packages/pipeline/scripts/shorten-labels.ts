/**
 * Shorten overlong point labels (raw questionnaire questions etc.) to
 * display length. The full original stays in summary; only label changes.
 *
 * Usage: DATABASE_URL=... tsx scripts/shorten-labels.ts \
 *          --consultation <ref> [--min-chars 90] [--batch 25]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { SHORTEN_LABELS_SYSTEM } from "../src/prompts.ts";
import { shortLabelsJsonSchema, shortLabelsOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const minChars = Number(arg("min-chars") ?? 90);
  const batchSize = Number(arg("batch") ?? 25);

  const db = createDb(url);
  const res = await db.execute(sql`
    SELECT p.id, p.label, p.tenant_id FROM points p
    JOIN consultations c ON c.id = p.consultation_id
    WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
      AND length(p.label) > ${minChars}
      AND p.status IN ('draft', 'released')
    ORDER BY p.created_at
  `);
  const items = res.rows as { id: string; label: string; tenant_id: string }[];
  console.log(`${items.length} labels longer than ${minChars} chars`);

  const provider = new AgentSdkProvider();
  let updated = 0;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    try {
      const generated = await provider.generateStructured({
        system: SHORTEN_LABELS_SYSTEM,
        prompt:
          batch.map((p, i) => `${i}. ${p.label}`).join("\n") +
          `\n\nShorten every item (0 to ${batch.length - 1}).`,
        schema: shortLabelsJsonSchema,
      });
      const parsed = shortLabelsOutput.parse(generated.output);
      for (const v of parsed.labels) {
        const item = batch[v.index];
        if (!item) continue;
        // The original stays retrievable: summary keeps it (questionnaire
        // imports store the full question there already).
        await db.execute(sql`
          UPDATE points SET summary = COALESCE(summary, label), label = ${v.short}
          WHERE id = ${item.id}
        `);
        await db.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
          VALUES (${item.tenant_id}, ${"ai-editor:" + generated.provenance.model},
                  'point.shorten_label', 'point', ${item.id},
                  ${JSON.stringify({ from: item.label, to: v.short })})
        `);
        updated++;
      }
      console.log(`  batch ${offset / batchSize + 1}: ${parsed.labels.length} shortened`);
    } catch (err) {
      console.log(`  batch FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${updated} labels updated`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
