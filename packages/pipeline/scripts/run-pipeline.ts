/**
 * Pipeline orchestrator: run the canonical stage chain for one consultation
 * with a single command. Every stage is idempotent and resumable, so this
 * stays thin — it just sequences the existing scripts and stops on the
 * first failure with a resume hint. Rerunning is always safe.
 *
 * Canonical order:
 *   decompose → ai-review points → generate-statements → ai-review
 *   statements → infer-stances → analyze → name-camps → cluster-themes
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/run-pipeline.ts --consultation <ref>
 *     [--limit 50]          decompose/statements/stances batch size
 *     [--concurrency 5]     infer-stances pool width
 *     [--from <stage>]      resume from this stage (skip earlier ones)
 *     [--only <a,b,...>]    run exactly these stages
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

function stages(consultation: string, limit: string, concurrency: string): Stage[] {
  const c = ["--consultation", consultation];
  const p = (s: string) => path.join(pipelineDir, "scripts", s);
  return [
    { name: "decompose", cwd: pipelineDir, script: p("decompose.ts"), args: [...c, "--limit", limit] },
    { name: "review-points", cwd: pipelineDir, script: p("ai-review.ts"), args: [...c, "--what", "points"] },
    { name: "statements", cwd: pipelineDir, script: p("generate-statements.ts"), args: [...c, "--limit", limit] },
    { name: "review-statements", cwd: pipelineDir, script: p("ai-review.ts"), args: [...c, "--what", "statements"] },
    { name: "infer-stances", cwd: pipelineDir, script: p("infer-stances.ts"), args: [...c, "--limit", limit, "--concurrency", concurrency] },
    { name: "analyze", cwd: platformDir, script: path.join(platformDir, "scripts", "analyze.ts"), args: c },
    { name: "name-camps", cwd: pipelineDir, script: p("name-camps.ts"), args: c },
    { name: "cluster-themes", cwd: pipelineDir, script: p("cluster-themes.ts"), args: c },
  ];
}

function main() {
  const consultation = arg("consultation");
  const limit = arg("limit") ?? "50";
  const concurrency = arg("concurrency") ?? "5";
  const all = stages(consultation ?? "<ref>", limit, concurrency);

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

  console.log(
    `pipeline for ${consultation}: ${selected.map((s) => s.name).join(" → ")} ` +
      `(limit ${limit}, concurrency ${concurrency})`,
  );
  const startedAll = Date.now();
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
          `resume with:\n  tsx scripts/run-pipeline.ts --consultation ${consultation} --from ${stage.name}`,
      );
      process.exit(1);
    }
    console.log(`✓ ${stage.name} [${mins} min]`);
  }
  console.log(`\nall stages done [${((Date.now() - startedAll) / 60_000).toFixed(1)} min]`);
}

main();
