/**
 * Pipeline orchestrator: run the canonical stage chain for one consultation
 * with a single command. Every stage is idempotent and resumable, so this
 * stays thin — it just sequences the existing scripts and stops on the
 * first failure with a resume hint. Rerunning is always safe.
 *
 * Canonical order:
 *   decompose → ai-review points → generate-statements → ai-review
 *   statements → infer-stances → analyze → name-camps → cluster-themes
 *   → classify-cq → segment-measures → condense-map → diagnose-map →
 *   render-landkarte
 *
 * --jev (exp/jev): the Jev-first pipeline — LLM writes, Jev decides, code
 * calculates (TYPESAFE_API_KEY). Prerequisite once per consultation:
 * platform/scripts/import-documents.ts <export-dir> (the bill).
 *   extract (windows cut by Jev, LLM extraction in parallel with the whole
 *   submission as context, automatic repair) → canonicalize (Jev matching,
 *   LLM second opinion on possible duplicates) → measures (LLM reads the
 *   bill) → assign-measures (named § in code, Jev, LLM if unsure) →
 *   relations (Jev, across submissions) → condense (LLM writes Landkarten-
 *   Punkte per measure in parallel, Jev assigns) → map-quotes (Jev) →
 *   map-stances (Jev: every submission × every Landkarten-Punkt) → camps
 *   (Polis math on those votes) → name-camps (LLM) → diagnose (computed;
 *   Jev pre-screen + LLM for false bridges; LLM findings) → render → check
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/run-pipeline.ts --consultation <ref>
 *     [--limit 50]          decompose/statements/stances batch size (legacy chain)
 *     [--concurrency 5]     parallel LLM calls
 *     [--from <stage>]      resume from this stage (skip earlier ones)
 *     [--until <stage>]     stop after this stage
 *     [--only <a,b,...>]    run exactly these stages
 *     [--submissions <id|source_ref,...>]  --jev: extract/canonicalize only these (test runs)
 *     [--render-out <dir>]  --jev: write the Landkarten here instead of docs/landkarte
 *     [--jev]               judgment stages via Jev (see above)
 *     [--list]              print stage names and exit
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const pipelineDir = path.resolve(here, "..");
const platformDir = path.resolve(here, "../../..");
const tsx = path.join(platformDir, "node_modules", ".bin", "tsx");

interface Stage {
  name: string;
  cwd: string;
  script: string;
  args: string[];
}

function stages(consultation: string, limit: string, concurrency: string, jev: boolean): Stage[] {
  const c = ["--consultation", consultation];
  const p = (s: string) => path.join(pipelineDir, "scripts", s);
  const analyze = { name: "analyze", cwd: platformDir, script: path.join(platformDir, "scripts", "analyze.ts"), args: c };
  if (jev) {
    const subs = arg("submissions") ? ["--submissions", arg("submissions")!] : [];
    const out = arg("render-out") ? ["--out", arg("render-out")!] : [];
    return [
      { name: "extract", cwd: pipelineDir, script: p("extract.ts"), args: [...c, "--phase", "extract", "--concurrency", concurrency, ...subs] },
      { name: "canonicalize", cwd: pipelineDir, script: p("extract.ts"), args: [...c, "--phase", "canonicalize", ...subs] },
      { name: "measures", cwd: pipelineDir, script: p("propose-measures-bill.ts"), args: c },
      { name: "assign-measures", cwd: pipelineDir, script: p("assign-measures.ts"), args: c },
      { name: "relations", cwd: pipelineDir, script: p("relations.ts"), args: c },
      { name: "condense", cwd: pipelineDir, script: p("condense.ts"), args: c },
      { name: "map-quotes", cwd: pipelineDir, script: p("jev-quotes.ts"), args: [...c, "--what", "landkarte", "--apply"] },
      { name: "map-stances", cwd: pipelineDir, script: p("map-stances.ts"), args: c },
      { name: "camps", cwd: platformDir, script: path.join(platformDir, "scripts", "camps.ts"), args: c },
      { name: "name-camps", cwd: pipelineDir, script: p("name-camps.ts"), args: c },
      { name: "diagnose", cwd: pipelineDir, script: p("diagnose-map.ts"), args: [...c, "--concurrency", "6"] },
      { name: "render", cwd: pipelineDir, script: p("render-landkarte.ts"), args: [...c, ...out] },
      { name: "check", cwd: pipelineDir, script: p("check-run.ts"), args: c },
    ];
  }
  return [
    { name: "decompose", cwd: pipelineDir, script: p("decompose.ts"), args: [...c, "--limit", limit] },
    { name: "review-points", cwd: pipelineDir, script: p("ai-review.ts"), args: [...c, "--what", "points"] },
    { name: "statements", cwd: pipelineDir, script: p("generate-statements.ts"), args: [...c, "--limit", limit] },
    { name: "review-statements", cwd: pipelineDir, script: p("ai-review.ts"), args: [...c, "--what", "statements"] },
    { name: "infer-stances", cwd: pipelineDir, script: p("infer-stances.ts"), args: [...c, "--limit", limit, "--concurrency", concurrency] },
    analyze,
    { name: "name-camps", cwd: pipelineDir, script: p("name-camps.ts"), args: c },
    { name: "cluster-themes", cwd: pipelineDir, script: p("cluster-themes.ts"), args: c },
    { name: "classify-cq", cwd: pipelineDir, script: p("classify-cq.ts"), args: c },
    { name: "segment-measures", cwd: pipelineDir, script: p("segment-measures.ts"), args: c },
    { name: "condense-map", cwd: pipelineDir, script: p("condense-map.ts"), args: c },
    { name: "diagnose-map", cwd: pipelineDir, script: p("diagnose-map.ts"), args: [...c, "--concurrency", concurrency] },
    { name: "render-landkarte", cwd: pipelineDir, script: p("render-landkarte.ts"), args: c },
  ];
}

function main() {
  const consultation = arg("consultation");
  const limit = arg("limit") ?? "50";
  const concurrency = arg("concurrency") ?? "5";
  const jev = has("jev");
  if (jev && !has("list") && !process.env.TYPESAFE_API_KEY) throw new Error("--jev needs TYPESAFE_API_KEY");
  const all = stages(consultation ?? "<ref>", limit, concurrency, jev);

  if (has("list")) {
    for (const s of all) console.log(s.name);
    return;
  }
  if (!consultation) throw new Error("--consultation required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  let selected = all;
  const only = arg("only");
  const from = arg("from");
  if (only) {
    const names = only.split(",").map((s) => s.trim());
    const unknown = names.filter((n) => !all.some((s) => s.name === n));
    if (unknown.length) throw new Error(`unknown stage(s): ${unknown.join(", ")}`);
    selected = all.filter((s) => names.includes(s.name));
  } else if (from) {
    const idx = all.findIndex((s) => s.name === from);
    if (idx < 0) throw new Error(`unknown stage: ${from}`);
    selected = all.slice(idx);
  }
  const until = arg("until");
  if (until) {
    const idx = selected.findIndex((s) => s.name === until);
    if (idx < 0) throw new Error(`unknown stage: ${until}`);
    selected = selected.slice(0, idx + 1);
  }

  console.log(
    `pipeline for ${consultation}: ${selected.map((s) => s.name).join(" → ")} ` +
      `(limit ${limit}, concurrency ${concurrency})`,
  );
  const startedAll = Date.now();
  const timings: { name: string; mins: string }[] = [];
  for (const stage of selected) {
    console.log(`\n━━━ ${stage.name} ━━━`);
    const started = Date.now();
    const res = spawnSync(tsx, [stage.script, ...stage.args], {
      cwd: stage.cwd,
      stdio: "inherit",
      env: process.env,
    });
    const mins = ((Date.now() - started) / 60_000).toFixed(1);
    if (res.status !== 0) {
      console.error(
        `\n✗ ${stage.name} failed after ${mins} min. All stages are idempotent — ` +
          `resume with:\n  tsx scripts/run-pipeline.ts --consultation ${consultation} --from ${stage.name}${jev ? " --jev" : ""}` +
          `${arg("submissions") ? ` --submissions ${arg("submissions")}` : ""}${arg("render-out") ? ` --render-out ${arg("render-out")}` : ""}`,
      );
      process.exit(1);
    }
    console.log(`✓ ${stage.name} [${mins} min]`);
    timings.push({ name: stage.name, mins });
  }
  console.log(`\nall stages done [${((Date.now() - startedAll) / 60_000).toFixed(1)} min]`);
  for (const t of timings) console.log(`  ${t.name.padEnd(18)} ${t.mins} min`);
}

main();
