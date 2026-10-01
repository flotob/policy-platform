/**
 * Relations across submissions (exp/jev): one Jev request per live point,
 * judging its closest neighbours (same measure + the bill as a whole, any
 * submission, lexical shortlist) — supports (either direction) / attacks
 * through one of the five doors / same direction / restates / unrelated. Writes point_edges (other → point) with
 * confidence; raw answers in judgments (relations.v1, subject = point).
 * Recomputes: existing jev edges of the consultation are replaced.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/relations.ts --consultation <ref> [--concurrency 8]
 */

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import { textSimilarity } from "../src/jev-match.ts";
import { decideRelation, RELATION_SHORTLIST, relationRequest, RELATIONS_FAMILY } from "../src/jev-relations.ts";
import { judgeAll, resolveConsultation, saveJudgment, statsLine } from "../src/jev-stage.ts";
import { WHOLE } from "../src/measures.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

interface P {
  id: string;
  label: string;
  summary: string | null;
  measure: string | null;
  subs: string[];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const res = await db.execute(sql`
    SELECT p.id, p.label, p.summary, p.measure,
      COALESCE((SELECT array_agg(DISTINCT ps.submission_id::text) FROM point_sources ps WHERE ps.point_id = p.id), '{}') AS subs
    FROM points p
    WHERE p.consultation_id = ${cons.id} AND p.status IN ('draft','released') AND p.created_by <> 'import:questionnaire'
  `);
  const pts = res.rows as unknown as P[];
  const neighbours = (p: P) =>
    pts
      .filter((o) => o.id !== p.id && (!p.measure || o.measure === p.measure || o.measure === WHOLE || p.measure === WHOLE))
      .map((o) => ({ o, sim: textSimilarity(`${p.label} ${p.summary ?? ""}`, `${o.label} ${o.summary ?? ""}`) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, RELATION_SHORTLIST)
      .map((x) => x.o);
  console.log(`${pts.length} points · up to ${RELATION_SHORTLIST} neighbours each`);

  const edges: { from: string; to: string; kind: string; p: number }[] = [];
  const kinds = new Map<string, number>();
  let crossSubmission = 0;
  const stats = await judgeAll(
    new JevJudge(),
    pts,
    (p) => {
      const others = neighbours(p);
      return others.length ? relationRequest(cons.title, { label: p.label, summary: p.summary }, others) : null;
    },
    async (p, answers, provenance) => {
      const others = neighbours(p);
      const decided = others.map((o, i) => {
        const d = decideRelation(answers[`o${i + 1}`] as { choice: string; probabilities: Record<string, number> });
        kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
        if (d.edge) {
          const [from, to] = d.edge.reverse ? [p.id, o.id] : [o.id, p.id];
          edges.push({ from, to, kind: d.edge.kind, p: d.p });
          if (!o.subs.some((s) => p.subs.includes(s))) crossSubmission++;
        }
        return { other: o.id, ...d };
      });
      await saveJudgment(db, {
        tenantId: cons.tenantId,
        consultationId: cons.id,
        subjectKind: "point",
        subjectId: p.id,
        family: RELATIONS_FAMILY,
        provenance,
        answers,
        decided,
      });
    },
    Number(arg("concurrency") ?? 8),
  );

  // The same edge can come from both points' requests — keep the stronger.
  const best = new Map<string, (typeof edges)[number]>();
  for (const e of edges) {
    const k = `${e.from}>${e.to}>${e.kind}`;
    if (!best.has(k) || best.get(k)!.p < e.p) best.set(k, e);
  }
  edges.splice(0, edges.length, ...best.values());
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM point_edges WHERE created_by = 'jev:relations'
        AND to_point IN (SELECT id FROM points WHERE consultation_id = ${cons.id})
    `);
    for (const e of edges) {
      await tx.execute(sql`
        INSERT INTO point_edges (tenant_id, from_point, to_point, kind, confidence, created_by)
        VALUES (${cons.tenantId}, ${e.from}, ${e.to}, ${e.kind}, ${e.p}, 'jev:relations')
        ON CONFLICT (from_point, to_point, kind) DO UPDATE SET confidence = excluded.confidence, created_by = excluded.created_by
      `);
    }
  });
  console.log(`\n${statsLine(stats)}`);
  console.log(`judged pairs: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`edges written: ${edges.length} (${crossSubmission} between points without a shared submission)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
