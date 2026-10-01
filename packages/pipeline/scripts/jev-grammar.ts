/**
 * exp/jev step 2 — the paper's grammar as calibrated judgments.
 *
 *   points:     fact/value + P1–P4/conclusion recognition tests → kind, slot,
 *               mixed-claim flag (family grammar.v1)
 *   map points: fact/value for T/W canonical points → typ; district derived
 *               in code from the members' critical questions (evidence.v1)
 *
 * Writes raw judgments always. Canonical columns: slots are filled only on a
 * consultation where no point has a slot yet (otherwise an empty slot is a
 * decision); kind/slot/typ/bezirk are replaced only with --overwrite (then
 * re-run diagnose-map + analyze, since diagnoses depend on them).
 * Without --overwrite this is a comparison run against the LLM labels.
 *
 * Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/jev-grammar.ts \
 *     --consultation <ref> [--what points|map|both] [--concurrency 8] [--overwrite]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, sql } from "@policy/db";
import { JevJudge } from "@policy/llm";

import {
  EVIDENCE_FAMILY,
  GRAMMAR_FAMILY,
  decideEvidence,
  decideGrammar,
  deriveBezirk,
  evidenceQuestions,
  grammarQuestions,
  type GrammarDecision,
} from "../src/jev-grammar.ts";
import {
  agreementReport,
  judgeAll,
  resolveConsultation,
  saveJudgment,
  statsLine,
} from "../src/jev-stage.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const what = arg("what") ?? "both";
  const concurrency = Number(arg("concurrency") ?? 8);
  const overwrite = process.argv.includes("--overwrite");

  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);
  const judge = new JevJudge();
  const report: Record<string, unknown> = { consultation: ref, overwrite };

  if (what === "points" || what === "both") {
    const res = await db.execute(sql`
      SELECT id, kind, slot, label, summary,
        (cq IS NULL AND COALESCE(cardinality(answers_cq), 0) = 0) AS grammar_claim
      FROM points
      WHERE consultation_id = ${cons.id}
        AND status IN ('draft', 'released')
        AND kind IN ('fact', 'value')
        AND created_by <> 'import:questionnaire'
    `);
    const pts = res.rows as {
      id: string; kind: string; slot: string | null; label: string; summary: string | null; grammar_claim: boolean;
    }[];
    console.log(
      `grammar: ${pts.length} fact/value points (${pts.filter((p) => p.grammar_claim).length} grammar claims get the slot tests; objections only fact/value)`,
    );
    const slotsAssigned = pts.some((p) => p.slot !== null);
    const decided = new Map<string, GrammarDecision | (ReturnType<typeof decideEvidence> & { slot: null; demand: false })>();
    let filled = 0;
    let replaced = 0;
    const stats = await judgeAll(
      judge,
      pts,
      (p) => ({
        state: { consultation: cons.title, point: { label: p.label, summary: p.summary } },
        questions: p.grammar_claim ? grammarQuestions() : evidenceQuestions(),
      }),
      async (p, answers, provenance) => {
        const a = answers as Record<string, { noul: number }>;
        const d = p.grammar_claim
          ? decideGrammar(a)
          : { ...decideEvidence(a), slot: null, demand: false as const };
        decided.set(p.id, d);
        await saveJudgment(db, {
          tenantId: cons.tenantId,
          consultationId: cons.id,
          subjectKind: "point",
          subjectId: p.id,
          family: GRAMMAR_FAMILY,
          provenance,
          answers,
          decided: d,
        });
        if (!p.grammar_claim) {
          if (overwrite && p.kind !== d.kind) {
            await db.execute(sql`UPDATE points SET kind = ${d.kind} WHERE id = ${p.id}`);
            replaced++;
          }
        } else if (!slotsAssigned && d.slot) {
          await db.execute(sql`UPDATE points SET slot = ${d.slot} WHERE id = ${p.id}`);
          filled++;
        } else if (overwrite && (p.kind !== d.kind || (d.slot && p.slot !== d.slot))) {
          await db.execute(sql`
            UPDATE points SET kind = ${d.kind}, slot = COALESCE(${d.slot}, slot) WHERE id = ${p.id}
          `);
          replaced++;
        }
      },
      concurrency,
    );
    console.log(`\n${statsLine(stats)}`);
    const pairsKind = pts.filter((p) => decided.has(p.id)).map((p) => ({ existing: p.kind, jev: decided.get(p.id)!.kind }));
    const pairsSlot = pts
      .filter((p) => decided.has(p.id) && p.slot && p.grammar_claim)
      .map((p) => ({ existing: p.slot, jev: decided.get(p.id)!.slot ?? "unclear" }));
    const mixed = [...decided.values()].filter((d) => d.mixed).length;
    const demands = [...decided.values()].filter((d) => d.demand).length;
    console.log(agreementReport(pairsKind, "fact/value vs LLM kind"));
    console.log(agreementReport(pairsSlot, "slot vs LLM slot (grammar claims)"));
    console.log(
      `mixed claims (P(evidence) in 0.3–0.7): ${mixed}/${decided.size} · design demands filed as claims: ${demands} · slots filled ${filled} · replaced ${replaced}`,
    );
    report.points = {
      stats: { ...stats, latencies: undefined },
      mixed,
      disagreements: pts
        .filter((p) => decided.has(p.id))
        .filter(
          (p) =>
            p.kind !== decided.get(p.id)!.kind ||
            (p.grammar_claim && p.slot && p.slot !== (decided.get(p.id)!.slot ?? "unclear")),
        )
        .map((p) => ({
          label: p.label,
          llm: { kind: p.kind, slot: p.slot },
          jev: {
            kind: decided.get(p.id)!.kind,
            slot: decided.get(p.id)!.slot,
            pEvidence: Number(decided.get(p.id)!.pEvidence.toFixed(3)),
            mixed: decided.get(p.id)!.mixed,
            demand: decided.get(p.id)!.demand,
          },
          grammarClaim: p.grammar_claim,
        })),
    };
  }

  if (what === "map" || what === "both") {
    const res = await db.execute(sql`
      SELECT mp.id, mp.typ, mp.bezirk, mp.text, mp.label, mp.scope,
        COALESCE((SELECT array_agg(p.cq) FROM points p WHERE p.map_point_id = mp.id), '{}') AS doors
      FROM map_points mp
      WHERE mp.consultation_id = ${cons.id} AND mp.typ IN ('T', 'W')
    `);
    const mps = res.rows as {
      id: string; typ: "T" | "W"; bezirk: string; text: string; label: string; scope: string; doors: (string | null)[];
    }[];
    console.log(`\nmap points: ${mps.length} T/W canonical points`);
    const decided = new Map<string, { typ: "T" | "W"; bezirk: string; pEvidence: number; mixed: boolean }>();
    let replaced = 0;
    const stats = await judgeAll(
      judge,
      mps,
      (m) => ({
        state: { consultation: cons.title, measure: m.scope, point: { label: m.label, summary: m.text } },
        questions: evidenceQuestions(),
      }),
      async (m, answers, provenance) => {
        const e = decideEvidence(answers as Record<string, { noul: number }>);
        const typ = e.kind === "fact" ? ("T" as const) : ("W" as const);
        const bezirk = deriveBezirk(typ, m.doors, m.bezirk);
        const d = { typ, bezirk, pEvidence: e.pEvidence, mixed: e.mixed };
        decided.set(m.id, d);
        await saveJudgment(db, {
          tenantId: cons.tenantId,
          consultationId: cons.id,
          subjectKind: "map_point",
          subjectId: m.id,
          family: EVIDENCE_FAMILY,
          provenance,
          answers,
          decided: d,
        });
        if (overwrite && (m.typ !== typ || m.bezirk !== bezirk)) {
          await db.execute(sql`UPDATE map_points SET typ = ${typ}, bezirk = ${bezirk} WHERE id = ${m.id}`);
          replaced++;
        }
      },
      concurrency,
    );
    console.log(`\n${statsLine(stats)}`);
    console.log(agreementReport(mps.filter((m) => decided.has(m.id)).map((m) => ({ existing: m.typ, jev: decided.get(m.id)!.typ })), "typ vs LLM typ"));
    console.log(agreementReport(mps.filter((m) => decided.has(m.id)).map((m) => ({ existing: m.bezirk, jev: decided.get(m.id)!.bezirk })), "bezirk (derived) vs stored"));
    const mixed = [...decided.values()].filter((d) => d.mixed).length;
    console.log(`mixed map points: ${mixed}/${decided.size} · replaced ${replaced}${replaced ? " — re-run diagnose-map + render-landkarte" : ""}`);
    report.map = {
      stats: { ...stats, latencies: undefined },
      mixed,
      disagreements: mps
        .filter((m) => decided.has(m.id))
        .filter((m) => m.typ !== decided.get(m.id)!.typ || m.bezirk !== decided.get(m.id)!.bezirk)
        .map((m) => ({ scope: m.scope, label: m.label, text: m.text, llm: { typ: m.typ, bezirk: m.bezirk }, jev: decided.get(m.id) })),
    };
  }

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-grammar-${ref}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
