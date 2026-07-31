/**
 * Theme clustering — the map's zoom level. Two passes: propose 5–12 theme
 * names from a sample of point labels, then assign every point to one theme
 * (batched). Stored in points.theme; NULL/unassigned renders as "Weitere".
 *
 * Usage: DATABASE_URL=... tsx scripts/cluster-themes.ts --consultation <ref>
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { THEMES_ASSIGN_SYSTEM, THEMES_PROPOSE_SYSTEM } from "../src/prompts.ts";
import {
  themeAssignJsonSchema,
  themeAssignOutput,
  themesJsonSchema,
  themesOutput,
} from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const batchSize = Number(arg("batch") ?? 40);

  const db = createDb(url);
  const res = await db.execute(sql`
    SELECT p.id, p.kind, p.label FROM points p
    JOIN consultations c ON c.id = p.consultation_id
    WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
      AND p.status IN ('draft', 'released')
      AND p.created_by <> 'import:questionnaire'
    ORDER BY p.created_at
  `);
  const points = res.rows as { id: string; kind: string; label: string }[];
  if (points.length < 10) throw new Error("too few points to theme");
  console.log(`${points.length} points`);

  const provider = new AgentSdkProvider();

  // Pass 1: propose themes from an evenly spread sample.
  const sampleStep = Math.max(1, Math.floor(points.length / 200));
  const sample = points.filter((_, i) => i % sampleStep === 0).slice(0, 200);
  const proposed = await provider.generateStructured({
    system: THEMES_PROPOSE_SYSTEM,
    prompt: sample.map((p) => `- ${p.label}`).join("\n"),
    schema: themesJsonSchema,
  });
  const { themes } = themesOutput.parse(proposed.output);
  console.log(`themes: ${themes.join(" · ")}`);

  // Pass 2: assign every point.
  const themeList = themes.map((t, i) => `${i}. ${t}`).join("\n");
  let assigned = 0;
  for (let offset = 0; offset < points.length; offset += batchSize) {
    const batch = points.slice(offset, offset + batchSize);
    try {
      const generated = await provider.generateStructured({
        system: THEMES_ASSIGN_SYSTEM,
        prompt:
          `Themes:\n${themeList}\n\nPoints:\n` +
          batch.map((p, i) => `${i}. [${p.kind}] ${p.label}`).join("\n") +
          `\n\nAssign every point (0 to ${batch.length - 1}).`,
        schema: themeAssignJsonSchema,
      });
      const parsed = themeAssignOutput.parse(generated.output);
      for (const a of parsed.assignments) {
        const point = batch[a.index];
        const theme = a.theme >= 0 ? themes[a.theme] : null;
        if (!point || theme === undefined) continue;
        await db.execute(sql`UPDATE points SET theme = ${theme} WHERE id = ${point.id}`);
        assigned++;
      }
      console.log(`  batch ${offset / batchSize + 1}: ${parsed.assignments.length} assigned`);
    } catch (err) {
      console.log(`  batch FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${assigned} points themed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
