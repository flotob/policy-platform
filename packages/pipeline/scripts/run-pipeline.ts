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
 *
 * Every run gets a folder .eval/runs/<consultation>-<timestamp>/ with
 *   run.log   every line of every stage, timestamped and tagged by stage
 *   run.json  code version (git commit, uncommitted changes), models,
 *             options, database, and per stage: start, end, minutes, exit
 * plus audit entries pipeline.run_start / pipeline.run_end. In --jev mode
 * check-run --quiet runs after every stage; a violated invariant stops the
 * run right there. Ctrl-C stops the running stage and records the run as
 * interrupted (every stage resumes cleanly).
 */

import { execSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createDb, sql } from "@policy/db";

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

interface StageRecord {
  name: string;
  startedAt: string;
  endedAt?: string;
  mins?: number;
  exit?: number | null;
  check?: "ok" | "failed" | "skipped";
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
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

  // ——— Run folder, identity, and log ————————————————————————————————————
  const startedAt = new Date();
  const runId = `${consultation}-${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  const runDir = path.join(pipelineDir, ".eval", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const logFile = path.join(runDir, "run.log");
  const log = (line: string, tag = "run") => {
    const out = `${stamp()} [${tag}] ${line}`;
    console.log(out);
    appendFileSync(logFile, out + "\n");
  };
  const git = (cmd: string) => {
    try {
      return execSync(`git -C ${JSON.stringify(platformDir)} ${cmd}`, { encoding: "utf-8" }).trim();
    } catch {
      return null;
    }
  };
  const dbUrl = new URL(process.env.DATABASE_URL);
  const run = {
    runId,
    consultation,
    database: `${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`,
    code: { commit: git("rev-parse HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), uncommittedChanges: (git("status --porcelain") ?? "") !== "" },
    models: { llm: process.env.LLM_MODEL ?? "claude-sonnet-5-5", jev: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest", jevConcurrency: Number(process.env.JEV_CONCURRENCY ?? 16) },
    options: { jev, concurrency, limit, submissions: arg("submissions") ?? null, from: from ?? null, until: until ?? null, only: only ?? null, renderOut: arg("render-out") ?? null },
    node: process.version,
    startedAt: startedAt.toISOString(),
    endedAt: null as string | null,
    status: "running" as "running" | "done" | "failed" | "interrupted",
    stages: [] as StageRecord[],
  };
  const save = () => writeFileSync(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
  save();

  // Audit entries mark the run in the database next to everything it wrote.
  const db = createDb(process.env.DATABASE_URL);
  const cons = (await db.execute(sql`
    SELECT id, tenant_id FROM consultations WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1`)).rows[0] as { id: string; tenant_id: string } | undefined;
  if (!cons) throw new Error(`consultation ${consultation} not found`);
  const audit = async (action: string) =>
    db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${cons.tenant_id}, 'pipeline:orchestrator', ${action}, 'consultation', ${cons.id}, ${JSON.stringify(run)})`);
  await audit("pipeline.run_start");

  log(`run ${runId} · ${selected.map((s) => s.name).join(" → ")}`);
  log(`log: ${logFile}`);
  log(`code ${run.code.commit?.slice(0, 7)} (${run.code.branch})${run.code.uncommittedChanges ? " WITH UNCOMMITTED CHANGES" : ""} · llm ${run.models.llm} · jev ${run.models.jev} · db ${run.database}`);

  // ——— Stages ———————————————————————————————————————————————————————————
  let child: ReturnType<typeof spawn> | null = null;
  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
    log("interrupt received — stopping the running stage (resume with --from)");
    child?.kill("SIGINT");
  });

  const runChild = (script: string, args: string[], cwd: string, tag: string): Promise<number | null> =>
    new Promise((resolve) => {
      child = spawn(tsx, [script, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of [child.stdout!, child.stderr!]) {
        createInterface({ input: stream }).on("line", (line) => log(line, tag));
      }
      child.on("close", (code) => {
        child = null;
        resolve(code);
      });
    });

  const resumeHint = (stage: string) =>
    `tsx scripts/run-pipeline.ts --consultation ${consultation} --from ${stage}${jev ? " --jev" : ""}` +
    `${arg("submissions") ? ` --submissions ${arg("submissions")}` : ""}${arg("render-out") ? ` --render-out ${arg("render-out")}` : ""}`;

  const finish = async (status: typeof run.status, code: number) => {
    run.status = status;
    run.endedAt = new Date().toISOString();
    save();
    await audit("pipeline.run_end");
    log(`run ${status} after ${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min · ${path.join(runDir, "run.json")}`);
    process.exit(code);
  };

  for (const stage of selected) {
    log(`━━━ ${stage.name} ━━━`);
    const rec: StageRecord = { name: stage.name, startedAt: new Date().toISOString() };
    run.stages.push(rec);
    save();
    const t0 = Date.now();
    const code = await runChild(stage.script, stage.args, stage.cwd, stage.name);
    rec.endedAt = new Date().toISOString();
    rec.mins = Number(((Date.now() - t0) / 60_000).toFixed(2));
    rec.exit = code;
    save();
    if (interrupted) {
      log(`✗ ${stage.name} interrupted after ${rec.mins} min — resume with:\n  ${resumeHint(stage.name)}`);
      await finish("interrupted", 130);
    }
    if (code !== 0) {
      log(`✗ ${stage.name} failed after ${rec.mins} min (exit ${code}). All stages are idempotent — resume with:\n  ${resumeHint(stage.name)}`);
      await finish("failed", 1);
    }
    log(`✓ ${stage.name} [${rec.mins} min]`);
    // Invariants after every stage: a broken state stops the run here, not
    // 30 minutes later.
    if (jev && stage.name !== "check") {
      const c = await runChild(path.join(pipelineDir, "scripts", "check-run.ts"), ["--consultation", consultation, "--quiet"], pipelineDir, `check:${stage.name}`);
      rec.check = c === 0 ? "ok" : "failed";
      save();
      if (c !== 0) {
        log(`✗ invariant check failed after ${stage.name} — stopped. Inspect, fix, then resume with:\n  ${resumeHint(selected[selected.indexOf(stage) + 1]?.name ?? stage.name)}`);
        await finish("failed", 1);
      }
    }
  }
  log(`all stages done [${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min]`);
  for (const r of run.stages) log(`  ${r.name.padEnd(18)} ${r.mins} min${r.check ? ` · check ${r.check}` : ""}`);
  await finish("done", 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
