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

import { BATCH_MATCH_SYSTEM, batchMatchPrompt } from "../src/prompts.ts";
import { batchMatchOutput, batchMatchJsonSchema } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

interface Decision {
  id: string;
  submission_id: string;
  candidate_label: string;
  candidate_summary: string | null;
  outcome: "matched" | "new";
  matched_point: string | null;
  method: string;
  chunk_index: number;
  created_at: string;
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

  const decRes = await db.execute(sql`
    SELECT id, submission_id, candidate_label, candidate_summary, outcome,
           matched_point, method,
           COALESCE((provenance->'chunk'->>'index')::int, 0) AS chunk_index,
           created_at
    FROM match_decisions
    WHERE consultation_id = ${consultationId}
    ORDER BY created_at ASC
  `);
  const decisions = decRes.rows as unknown as Decision[];

  // Group by submission, in decomposition order.
  const bySubmission = new Map<string, Decision[]>();
  for (const d of decisions) {
    if (!bySubmission.has(d.submission_id)) bySubmission.set(d.submission_id, []);
    bySubmission.get(d.submission_id)!.push(d);
  }

  const provider = new AgentSdkProvider();
  let agree = 0;
  let disagree = 0;
  let missing = 0;
  let bothMatched = 0;
  let samePoint = 0;
  const disagreements: string[] = [];

  let subCount = 0;
  for (const [submissionId, subDecisions] of bySubmission) {
    // The very first submission matched against an empty map — nothing to replay.
    if (subDecisions.every((d) => d.method === "auto:first-points")) continue;
    if (++subCount > limitSubs) break;

    const firstTs = subDecisions[0]!.created_at;

    // This submission's own new points, by label (via its point_sources rows).
    const ownRes = await db.execute(sql`
      SELECT DISTINCT p.id, p.label FROM points p
      JOIN point_sources ps ON ps.point_id = p.id
      WHERE ps.submission_id = ${submissionId}
    `);
    const ownIdsByLabel = new Map<string, string[]>();
    for (const r of ownRes.rows as { id: string; label: string }[]) {
      if (!ownIdsByLabel.has(r.label)) ownIdsByLabel.set(r.label, []);
      ownIdsByLabel.get(r.label)!.push(r.id);
    }
    const ownNewIds = new Set<string>();
    const newIdsByChunk = new Map<number, { id: string; label: string }[]>();
    for (const d of subDecisions) {
      if (d.outcome !== "new") continue;
      for (const id of ownIdsByLabel.get(d.candidate_label) ?? []) {
        ownNewIds.add(id);
        if (!newIdsByChunk.has(d.chunk_index)) newIdsByChunk.set(d.chunk_index, []);
        newIdsByChunk.get(d.chunk_index)!.push({ id, label: d.candidate_label });
      }
    }

    const baseRes = await db.execute(sql`
      SELECT id, label, summary FROM points
      WHERE consultation_id = ${consultationId}
        AND created_at < ${firstTs}
        AND created_by <> 'import:questionnaire'
      ORDER BY created_at ASC
    `);
    const base = (baseRes.rows as { id: string; label: string; summary: string | null }[])
      .filter((p) => !ownNewIds.has(p.id));

    const chunks = [...new Set(subDecisions.map((d) => d.chunk_index))].sort((a, b) => a - b);
    for (const chunkIdx of chunks) {
      const group = subDecisions.filter((d) => d.chunk_index === chunkIdx);
      const earlier = chunks
        .filter((c) => c < chunkIdx)
        .flatMap((c) => newIdsByChunk.get(c) ?? [])
        .map((p) => ({ id: p.id, label: p.label, summary: null as string | null }));
      const existing = [...base, ...earlier];
      if (existing.length === 0) continue;

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
