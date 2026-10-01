/**
 * exp/jev step 7 — evaluate the Jev questionnaire mapping against the regex
 * ladder on a harvester export (no DB). Reports votable-question decisions,
 * label mappings where both give a value, and labels only one can map.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... tsx scripts/jev-answers.ts <export-dir> [--concurrency 8]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { JevJudge } from "@policy/llm";

import { decideQuestion, mapQuestion, regexMapAnswer, type QuestionMapping } from "../src/jev-answers.ts";
import { runPool } from "../src/pool.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir || exportDir.startsWith("--")) throw new Error("usage: jev-answers.ts <export-dir>");
  const concurrency = Number(arg("concurrency") ?? 8);

  const responses = readFileSync(join(exportDir, "responses.jsonl"), "utf-8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.source_response_id?.startsWith("opc:") && r.answers);
  const labelCounts = new Map<string, Map<string, number>>();
  for (const r of responses) {
    for (const [q, v] of Object.entries(JSON.parse(r.answers) as Record<string, string>)) {
      if (!v.trim()) continue;
      const m = labelCounts.get(q) ?? new Map<string, number>();
      m.set(v.trim(), (m.get(v.trim()) ?? 0) + 1);
      labelCounts.set(q, m);
    }
  }
  const questions = [...labelCounts.entries()].filter(([, m]) => [...m.values()].reduce((s, x) => s + x, 0) >= 20);
  console.log(`${basename(exportDir)}: ${responses.length} OPC responses · ${questions.length} questions with >= 20 answers`);

  // Regex baseline: votable when >= 60 % of answers map.
  const regexVotable = new Map<string, boolean>();
  for (const [q, m] of questions) {
    let mapped = 0;
    let total = 0;
    for (const [label, n] of m) {
      total += n;
      if (regexMapAnswer(label) !== null) mapped += n;
    }
    regexVotable.set(q, mapped / total >= 0.6);
  }

  const judge = new JevJudge();
  const jev = new Map<string, QuestionMapping>();
  let tokens = 0;
  const started = Date.now();
  await runPool(
    questions,
    async ([q, m]) => {
      const t0 = Date.now();
      const { mapping } = await mapQuestion(judge, q, [...m.keys()]);
      jev.set(q, mapping);
      void t0;
    },
    concurrency,
  );
  void tokens;

  let votableAgree = 0;
  const votableDiff: unknown[] = [];
  let bothValued = 0;
  let sameValue = 0;
  let regexOnly = 0;
  let jevOnly = 0;
  const labelDiff: unknown[] = [];
  for (const [q, m] of questions) {
    const j = jev.get(q);
    if (!j) continue;
    const d = decideQuestion(m, j);
    const jv = d.votable;
    if (jv === regexVotable.get(q)) votableAgree++;
    else votableDiff.push({ question: q.slice(0, 160), regex: regexVotable.get(q), jev: d.reason, labels: [...m.keys()].slice(0, 8) });
    if (!jv) continue;
    for (const [label, n] of m) {
      const r = regexMapAnswer(label);
      const jl = d.values.get(label) ?? null;
      if (r !== null && jl !== null) {
        bothValued += n;
        if (r === jl) sameValue += n;
        else labelDiff.push({ question: q.slice(0, 100), label, regex: r, jev: jl, n });
      } else if (r !== null) regexOnly += n;
      else if (jl !== null) jevOnly += n;
    }
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`votable-question decision agreement: ${votableAgree}/${questions.length}`);
  console.log(`answers mapped by both: ${bothValued} · same value ${sameValue} (${((sameValue / Math.max(1, bothValued)) * 100).toFixed(1)}%)`);
  console.log(`answers only regex maps: ${regexOnly} · only Jev maps: ${jevOnly}`);

  const outDir = resolve(".eval");
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/jev-answers-${basename(exportDir)}.json`;
  writeFileSync(out, JSON.stringify({ votableDiff, labelDiff }, null, 2));
  console.log(`report → ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
