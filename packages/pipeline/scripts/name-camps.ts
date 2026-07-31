/**
 * Name the camps of the latest analysis run: composition + most agreed /
 * most rejected statements per camp → short name + one-line summary,
 * written back into analysis_runs.result.campNames (presentation metadata;
 * the deterministic analysis itself stays untouched).
 *
 * Usage: DATABASE_URL=... tsx scripts/name-camps.ts --consultation <ref>
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { NAME_CAMPS_SYSTEM } from "../src/prompts.ts";
import { campNamesJsonSchema, campNamesOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

interface StoredStatement {
  pointId: string;
  label: string;
  perGroup: { group: number; pa: number; ns: number }[];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");

  const db = createDb(url);
  const runRes = await db.execute(sql`
    SELECT ar.id, ar.result, c.title FROM analysis_runs ar
    JOIN consultations c ON c.id = ar.consultation_id
    WHERE c.id::text = ${consultation} OR c.source_ref = ${consultation}
    ORDER BY ar.created_at DESC LIMIT 1
  `);
  if (runRes.rows.length === 0) throw new Error("no analysis run found");
  const { id: runId, result, title } = runRes.rows[0] as {
    id: string;
    title: string;
    result: {
      clustering: { groupSizes: Record<string, number> };
      statements: StoredStatement[];
      participantGroups: { group: number; authorType: string | null }[];
    };
  };

  const groups = Object.keys(result.clustering.groupSizes).map(Number).sort();
  const lines: string[] = [];
  for (const g of groups) {
    const types = new Map<string, number>();
    for (const p of result.participantGroups) {
      if (p.group !== g) continue;
      const key = p.authorType ?? "unbekannt";
      types.set(key, (types.get(key) ?? 0) + 1);
    }
    const composition = [...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(", ");
    const scored = result.statements
      .map((s) => ({ label: s.label, pg: s.perGroup.find((x) => x.group === g) }))
      .filter((s) => s.pg && s.pg.ns >= 2);
    const top = [...scored].sort((a, b) => b.pg!.pa - a.pg!.pa).slice(0, 6);
    const bottom = [...scored].sort((a, b) => a.pg!.pa - b.pg!.pa).slice(0, 4);
    lines.push(
      `Camp ${g} (${result.clustering.groupSizes[g]} members; composition: ${composition}):\n` +
        `  agrees most:\n${top.map((s) => `    - ${s.label}`).join("\n")}\n` +
        `  rejects most:\n${bottom.map((s) => `    - ${s.label}`).join("\n")}`,
    );
  }

  const provider = new AgentSdkProvider();
  const generated = await provider.generateStructured({
    system: NAME_CAMPS_SYSTEM,
    prompt: `Consultation: ${title}\n\n${lines.join("\n\n")}\n\nName every camp (group index as given).`,
    schema: campNamesJsonSchema,
  });
  const parsed = campNamesOutput.parse(generated.output);

  const campNames: Record<string, { name: string; summary: string }> = {};
  for (const c of parsed.camps) {
    campNames[String(c.group)] = { name: c.name, summary: c.summary };
  }
  await db.execute(sql`
    UPDATE analysis_runs
    SET result = jsonb_set(result, '{campNames}', ${JSON.stringify(campNames)}::jsonb)
    WHERE id = ${runId}
  `);
  for (const [g, c] of Object.entries(campNames)) {
    console.log(`G${g} → ${c.name} — ${c.summary}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
