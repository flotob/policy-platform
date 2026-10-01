/**
 * Name the camps of the latest analysis run: composition + most agreed /
 * most rejected statements per camp → short name + one-line summary,
 * written back into analysis_runs.result.campNames (presentation metadata;
 * the deterministic analysis itself stays untouched).
 *
 * Usage: DATABASE_URL=... tsx scripts/name-camps.ts --consultation <ref> [--language en]
 *
 * The output language defaults to the consultation's dominant submission
 * language — without the hint the model guesses from the bilingual
 * statement labels (the AI WP got German camp names that way).
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
      participantGroups: { group: number; authorType: string | null; authorOrg?: string | null }[];
    };
  };

  // Output language: explicit flag wins; otherwise the dominant language of
  // the consultation's submissions (values are free-form: 'de', 'EN', ...).
  let language = arg("language");
  if (!language) {
    const langRes = await db.execute(sql`
      SELECT s.language FROM submissions s
      JOIN consultations c ON c.id = s.consultation_id
      WHERE (c.id::text = ${consultation} OR c.source_ref = ${consultation})
        AND s.language IS NOT NULL
      GROUP BY s.language ORDER BY count(*) DESC LIMIT 1
    `);
    language = (langRes.rows[0] as { language: string } | undefined)?.language;
  }
  const languageLine = language
    ? `\n\nWrite ALL camp names and summaries in this language: ${language}.`
    : "";

  const groups = Object.keys(result.clustering.groupSizes).map(Number).sort();
  const lines: string[] = [];
  for (const g of groups) {
    const types = new Map<string, number>();
    for (const p of result.participantGroups) {
      if (p.group !== g) continue;
      const key = p.authorType ?? "unbekannt";
      types.set(key, (types.get(key) ?? 0) + 1);
    }
    // Small camps (inferred from organisations' submissions): the member
    // organisations say more than any statistic.
    const orgs = result.participantGroups.filter((p) => p.group === g && p.authorOrg).map((p) => p.authorOrg!);
    const composition =
      orgs.length > 0 && orgs.length <= 15
        ? orgs.join("; ")
        : [...types.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k}×${n}`)
            .join(", ");
    // Rank by what SEPARATES this camp from the others (agreement minus the
    // others' mean), not by raw agreement — with small camps the smoothed
    // top agreements are ties and the pick is noise.
    const scored = result.statements
      .map((s) => {
        const pg = s.perGroup.find((x) => x.group === g);
        const others = s.perGroup.filter((x) => x.group !== g && x.ns > 0);
        const otherPa = others.length ? others.reduce((t, x) => t + x.pa, 0) / others.length : 0.5;
        return { label: s.label, pg, diff: pg ? pg.pa - otherPa : 0 };
      })
      .filter((s) => s.pg && s.pg.ns >= 2);
    const top = [...scored].sort((a, b) => b.diff - a.diff).slice(0, 6);
    const bottom = [...scored].sort((a, b) => a.diff - b.diff).slice(0, 4);
    lines.push(
      `Camp ${g} (${result.clustering.groupSizes[g]} members; composition: ${composition}):\n` +
        `  agrees clearly MORE than the other camp(s):\n${top.map((s) => `    - ${s.label}`).join("\n")}\n` +
        `  agrees clearly LESS than the other camp(s):\n${bottom.map((s) => `    - ${s.label}`).join("\n")}`,
    );
  }

  const provider = new AgentSdkProvider();
  const generated = await provider.generateStructured({
    system: NAME_CAMPS_SYSTEM,
    prompt: `Consultation: ${title}\n\n${lines.join("\n\n")}\n\nName every camp (group index as given).${languageLine}`,
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
