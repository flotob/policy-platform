/**
 * O1 acceptance gate: replay batch matching against the stored sequential
 * match_decisions baseline of a fully-decomposed consultation and measure
 * matched/new agreement. §6.6 requires ≥90 % before batch becomes the
 * default decompose path.
 *
 * The map state each chunk saw is reconstructed from timestamps: all points
 * created before the submission's first decision, minus this submission's
 * own new points (a candidate's point row lands milliseconds before its
 * decision row), plus the new points of this submission's EARLIER chunks —
 * exactly the sequential snapshot semantics. Reads only; writes nothing.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/replay-batch-match.ts \
 *     --consultation <source_ref|uuid> [--limit-submissions N]
 */

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { replayGroups } from "../src/match-replay.ts";
import { BATCH_MATCH_SYSTEM, batchMatchPrompt } from "../src/prompts.ts";
import { batchMatchOutput, batchMatchJsonSchema } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const limitSubs = Number(arg("limit-submissions") ?? 999);

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const consultationId = (cons.rows[0] as { id: string }).id;

  const provider = new AgentSdkProvider();
  let agree = 0;
  let disagree = 0;
  let missing = 0;
  let bothMatched = 0;
  let samePoint = 0;
  const disagreements: string[] = [];

  for await (const { decisions: group, existing } of replayGroups(db, consultationId, limitSubs)) {
    const candidates = group.map((d) => ({
      label: d.candidate_label,
      summary: d.candidate_summary ?? "",
    }));
    let verdicts: Map<number, { outcome: string; pointId: string | null }>;
    try {
      const batch = await provider.generateStructured({
        system: BATCH_MATCH_SYSTEM,
        prompt: batchMatchPrompt(candidates, existing),
        schema: batchMatchJsonSchema,
      });
      const parsed = batchMatchOutput.parse(batch.output);
      verdicts = new Map();
      for (const v of parsed.matches) {
        if (v.candidate_index >= group.length || verdicts.has(v.candidate_index)) continue;
        const valid =
          v.decision === "matched" &&
          v.matched_index !== null &&
          v.matched_index < existing.length;
        verdicts.set(v.candidate_index, {
          outcome: valid ? "matched" : "new",
          pointId: valid ? existing[v.matched_index!]!.id : null,
        });
      }
    } catch (err) {
      console.log(`  chunk call FAILED: ${err instanceof Error ? err.message : err}`);
      missing += group.length;
      continue;
    }

    for (let i = 0; i < group.length; i++) {
      const stored = group[i]!;
      const replayed = verdicts.get(i);
      if (!replayed) {
        missing++;
        continue;
      }
      if (replayed.outcome === stored.outcome) {
        agree++;
        if (stored.outcome === "matched") {
          bothMatched++;
          if (replayed.pointId === stored.matched_point) samePoint++;
        }
      } else {
        disagree++;
        if (disagreements.length < 15) {
          disagreements.push(
            `  seq=${stored.outcome} batch=${replayed.outcome}: ${stored.candidate_label}`,
          );
        }
      }
    }
    process.stdout.write(".");
  }

  const judged = agree + disagree;
  const pct = judged > 0 ? ((agree / judged) * 100).toFixed(1) : "n/a";
  console.log(`\n\nreplayed ${judged} verdicts (${missing} missing from batch output)`);
  console.log(`matched/new agreement: ${agree}/${judged} = ${pct}%`);
  if (bothMatched > 0) {
    console.log(
      `same-point when both matched: ${samePoint}/${bothMatched} = ` +
        `${((samePoint / bothMatched) * 100).toFixed(1)}%`,
    );
  }
  if (disagreements.length > 0) {
    console.log(`\ndisagreements (first ${disagreements.length}):`);
    for (const d of disagreements) console.log(d);
  }
  console.log(
    `\ngate (≥90%): ${judged > 0 && agree / judged >= 0.9 ? "PASS — batch may become the default" : "FAIL — keep per-candidate default"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
