/**
 * AI editor: reviews drafts in batches and releases/rejects them, replacing
 * the manual editorial gate for demo mode. Every verdict is audit-logged
 * with actor "ai-editor:<model>"; humans can still override in /review.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/ai-review.ts \
 *     --consultation <source_ref|uuid> [--what points|statements] [--batch 25]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import {
  AI_REVIEW_POINTS_SYSTEM,
  AI_REVIEW_STATEMENTS_SYSTEM,
  aiReviewPrompt,
} from "../src/prompts.ts";
import { aiReviewJsonSchema, aiReviewOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const what = (arg("what") ?? "points") as "points" | "statements";
  const batchSize = Number(arg("batch") ?? 25);

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, tenant_id, title FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId, title } = cons.rows[0] as {
    id: string; tenant_id: string; title: string;
  };

  let items: { id: string; rendered: string }[];
  if (what === "points") {
    const res = await db.execute(sql`
      SELECT p.id, p.kind, p.slot, p.label, p.summary
      FROM points p
      WHERE p.consultation_id = ${consultationId} AND p.status = 'draft'
        AND p.created_by <> 'import:questionnaire'
      ORDER BY p.created_at
    `);
    items = (res.rows as {
      id: string; kind: string; slot: string | null; label: string; summary: string | null;
    }[]).map((p) => ({
      id: p.id,
      rendered: `[${p.kind}${p.slot ? `/${p.slot}` : ""}] ${p.label} — ${p.summary ?? ""}`,
    }));
  } else {
    const res = await db.execute(sql`
      SELECT p.id, p.label,
        json_agg(json_build_object('locale', st.locale, 'text', st.text)
                 ORDER BY st.locale) AS versions
      FROM statements st JOIN points p ON p.id = st.point_id
      WHERE p.consultation_id = ${consultationId} AND st.status = 'draft'
      GROUP BY p.id, p.label ORDER BY min(st.created_at)
    `);
    items = (res.rows as {
      id: string; label: string; versions: { locale: string; text: string }[];
    }[]).map((p) => ({
      id: p.id,
      rendered:
        `Point: ${p.label}\n` +
        p.versions.map((v) => `   ${v.locale}: ${v.text}`).join("\n"),
    }));
  }
  console.log(`${items.length} draft ${what} to review — ${title}`);

  const provider = new AgentSdkProvider();
  let released = 0;
  let rejected = 0;
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    const started = Date.now();
    try {
      const result = await provider.generateStructured({
        system: what === "points" ? AI_REVIEW_POINTS_SYSTEM : AI_REVIEW_STATEMENTS_SYSTEM,
        prompt: aiReviewPrompt(title, batch.map((b) => b.rendered)),
        schema: aiReviewJsonSchema,
      });
      const parsed = aiReviewOutput.parse(result.output);
      const method = `ai-editor:${result.provenance.model}`;
      for (const v of parsed.verdicts) {
        const item = batch[v.index];
        if (!item) continue;
        const status = v.decision === "release" ? "released" : "rejected";
        if (what === "points") {
          await db.execute(sql`UPDATE points SET status = ${status} WHERE id = ${item.id} AND status = 'draft'`);
        } else {
          await db.execute(sql`UPDATE statements SET status = ${status} WHERE point_id = ${item.id} AND status = 'draft'`);
        }
        await db.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, reason)
          VALUES (${tenantId}, ${method},
                  ${`${what === "points" ? "point" : "statement"}.${v.decision === "release" ? "release" : "reject"}`},
                  'point', ${item.id}, ${v.reason})
        `);
        if (v.decision === "release") released++;
        else rejected++;
      }
      console.log(
        `  batch ${offset / batchSize + 1}: ${parsed.verdicts.length} verdicts ` +
          `[${Math.round((Date.now() - started) / 1000)}s]`,
      );
    } catch (err) {
      console.log(`  batch FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${released} released, ${rejected} rejected`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
