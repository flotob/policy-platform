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
 * interrupted (every stage resumes cleanly; a second Ctrl-C kills at once).
 * Resume hints keep this invocation's boundaries (--until, --only,
 * options). With PIPELINE_SNAPSHOT_CONTAINER=<postgres container>, a
 * failed or interrupted run keeps a pg_dump of its database in the folder.
 */

import { execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
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

interface ChildResult {
  code: number | null;
  signal: string | null;
  error?: string;
}

interface StageRecord {
  name: string;
  argv: string[];
  startedAt: string;
  endedAt?: string;
  mins?: number;
  exit?: number | null;
  signal?: string | null;
  check?: { status: "ok" | "failed" | "interrupted"; startedAt: string; endedAt?: string; exit?: number | null; signal?: string | null };
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

/** Last line of defence: no secret value or credential-bearing URL reaches console or disk. */
function makeSanitizer(): (line: string) => string {
  const secrets = ["TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]
    .map((k) => process.env[k])
    .filter((v): v is string => !!v && v.length >= 8);
  return (line) => {
    let out = line.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, "$1***@");
    for (const v of secrets) out = out.split(v).join("***");
    return out;
  };
}

const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a));

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
  let dbUrl: URL;
  try {
    dbUrl = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL (value not shown)");
  }

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

  // ——— Run folder (unique), log, manifest ———————————————————————————————
  const startedAt = new Date();
  const runId = `${consultation}-${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const runsDir = path.join(pipelineDir, ".eval", "runs");
  mkdirSync(runsDir, { recursive: true });
  const runDir = path.join(runsDir, runId);
  mkdirSync(runDir); // exclusive: a second run never shares a folder
  const logFile = path.join(runDir, "run.log");
  const sanitize = makeSanitizer();
  let lastOutput = Date.now();
  const log = (line: string, tag = "run") => {
    const out = sanitize(`${stamp()} [${tag}] ${line}`);
    console.log(out);
    appendFileSync(logFile, out + "\n");
  };
  const git = (cmd: string) => {
    try {
      return execSync(`git -C ${JSON.stringify(platformDir)} ${cmd}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const dirty = (git("status --porcelain") ?? "") !== "";
  const run = {
    runId,
    argv: process.argv.slice(2),
    consultation,
    database: `${dbUrl.hostname}:${dbUrl.port}${dbUrl.pathname}`,
    code: { commit: git("rev-parse HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), uncommittedChanges: dirty },
    models: { llm: process.env.LLM_MODEL ?? "claude-sonnet-5-5", jev: process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest", jevConcurrency: Number(process.env.JEV_CONCURRENCY ?? 16) },
    options: { jev, concurrency, limit, submissions: arg("submissions") ?? null, from: from ?? null, until: until ?? null, only: only ?? null, renderOut: arg("render-out") ?? null },
    node: process.version,
    startedAt: startedAt.toISOString(),
    endedAt: null as string | null,
    status: "running" as "running" | "done" | "failed" | "interrupted",
    error: null as string | null,
    auditErrors: [] as string[],
    stages: [] as StageRecord[],
  };
  // Atomic: an interruption during a write never leaves broken JSON.
  const save = () => {
    const tmp = path.join(runDir, "run.json.tmp");
    writeFileSync(tmp, JSON.stringify(run, null, 2));
    renameSync(tmp, path.join(runDir, "run.json"));
  };
  save();
  // The exact source of a dirty run is kept with it.
  if (dirty) {
    try {
      writeFileSync(path.join(runDir, "uncommitted.diff"), execSync(`git -C ${JSON.stringify(platformDir)} diff HEAD`, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }));
    } catch {
      /* best effort */
    }
  }

  // ——— Cancellation ————————————————————————————————————————————————————
  let cancelled = false;
  let child: ReturnType<typeof spawn> | null = null;
  const killGroup = (sig: NodeJS.Signals) => {
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, sig); // the whole process group: tsx + node + its children
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };
  let escalation: NodeJS.Timeout | null = null;
  const onSignal = () => {
    if (cancelled) {
      log("second interrupt — killing the running stage now");
      killGroup("SIGKILL");
      return;
    }
    cancelled = true;
    log("interrupt received — stopping the running stage (Ctrl-C again to kill at once)");
    killGroup("SIGINT");
    escalation = setTimeout(() => {
      log("stage still running 20 s after interrupt — terminating");
      killGroup("SIGTERM");
      escalation = setTimeout(() => killGroup("SIGKILL"), 10_000);
    }, 20_000);
  };
  // Stages run in their own process group: every way of stopping the
  // orchestrator must reach them, or they would run on orphaned.
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);

  const runChild = (script: string, args: string[], cwd: string, tag: string): Promise<ChildResult> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (r: ChildResult) => {
        if (settled) return;
        settled = true;
        child = null;
        resolve(r);
      };
      try {
        child = spawn(tsx, [script, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
      } catch (err) {
        done({ code: null, signal: null, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      lastOutput = Date.now();
      for (const stream of [child.stdout!, child.stderr!]) {
        createInterface({ input: stream }).on("line", (line) => {
          lastOutput = Date.now();
          log(line, tag);
        });
      }
      child.on("error", (err) => done({ code: null, signal: null, error: err.message }));
      child.on("close", (code, signal) => done({ code, signal }));
    });

  // ——— Audit (best effort, bounded — a dead DB must not hang the run) ————
  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
  const db = createDb(process.env.DATABASE_URL);
  let cons: { id: string; tenant_id: string } | undefined;
  const audit = async (action: string) => {
    if (!cons) return;
    try {
      await withTimeout(
        db.execute(sql`
          INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
          VALUES (${cons.tenant_id}, 'pipeline:orchestrator', ${action}, 'consultation', ${cons.id}, ${JSON.stringify(run)})`),
        10_000,
      );
    } catch (err) {
      const msg = `${action}: ${err instanceof Error ? err.message : err}`;
      run.auditErrors.push(sanitize(msg));
      log(`audit entry failed (run continues) — ${msg}`);
    }
  };

  // Resume instructions keep every boundary of THIS invocation (--until,
  // --only, options) and restart at the given stage.
  const resumeHint = (stage: string) => {
    const keep: string[] = [];
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--from" || argv[i] === "--only") {
        i++;
        continue;
      }
      keep.push(argv[i]!);
    }
    const rest = selected.slice(selected.findIndex((s) => s.name === stage)).map((s) => s.name);
    const scope = only ? ["--only", rest.join(",")] : ["--from", stage];
    return `tsx scripts/run-pipeline.ts ${[...keep, ...scope].map(quote).join(" ")}`;
  };

  const heartbeat = setInterval(() => {
    const current = run.stages.at(-1);
    if (!child || !current) return;
    const quiet = Math.round((Date.now() - lastOutput) / 1000);
    if (quiet >= 60) {
      log(`♥ ${current.name} running ${((Date.now() - Date.parse(current.startedAt)) / 60_000).toFixed(1)} min, no output for ${quiet} s`);
    }
  }, 60_000);

  // Evidence before a retry overwrites it (judgments are upserted per
  // subject): with PIPELINE_SNAPSHOT_CONTAINER set, a failed or interrupted
  // run dumps its database into the run folder.
  const snapshot = () => {
    const container = process.env.PIPELINE_SNAPSHOT_CONTAINER;
    if (!container) return;
    const file = path.join(runDir, "db-snapshot.dump");
    try {
      execSync(
        `docker exec ${JSON.stringify(container)} pg_dump -Fc -U ${JSON.stringify(decodeURIComponent(dbUrl.username || "policy"))} ${JSON.stringify(dbUrl.pathname.slice(1))} > ${JSON.stringify(file)}`,
        { stdio: ["ignore", "ignore", "pipe"], timeout: 180_000, shell: "/bin/sh" },
      );
      log(`database snapshot kept: ${file}`);
    } catch (err) {
      log(`database snapshot failed — ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  };

  const finish = async (status: typeof run.status, code: number, error?: string) => {
    clearInterval(heartbeat);
    if (escalation) clearTimeout(escalation);
    run.status = status;
    run.error = error ? sanitize(error) : null;
    run.endedAt = new Date().toISOString();
    save();
    if (error) log(`ERROR ${error}`);
    if (status !== "done") snapshot();
    await audit("pipeline.run_end");
    save();
    log(`run ${status} after ${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min · ${path.join(runDir, "run.json")}`);
    process.exit(code);
  };

  try {
    cons = (await withTimeout(
      db.execute(sql`
        SELECT id, tenant_id FROM consultations WHERE id::text = ${consultation} OR source_ref = ${consultation}
        ORDER BY created_at DESC LIMIT 1`),
      15_000,
    )).rows[0] as { id: string; tenant_id: string } | undefined;
    if (!cons) throw new Error(`consultation ${consultation} not found`);
    await audit("pipeline.run_start");

    log(`run ${runId} · ${selected.map((s) => s.name).join(" → ")}`);
    log(`log: ${logFile}`);
    log(`code ${run.code.commit?.slice(0, 7)} (${run.code.branch})${dirty ? " WITH UNCOMMITTED CHANGES (diff kept in the run folder)" : ""} · llm ${run.models.llm} · jev ${run.models.jev} · db ${run.database}`);

    for (const stage of selected) {
      if (cancelled) return await finish("interrupted", 130, `interrupted before ${stage.name}`);
      log(`━━━ ${stage.name} ━━━`);
      const rec: StageRecord = { name: stage.name, argv: [stage.script, ...stage.args], startedAt: new Date().toISOString() };
      run.stages.push(rec);
      save();
      const t0 = Date.now();
      const r = await runChild(stage.script, stage.args, stage.cwd, stage.name);
      rec.endedAt = new Date().toISOString();
      rec.mins = Number(((Date.now() - t0) / 60_000).toFixed(2));
      rec.exit = r.code;
      rec.signal = r.signal;
      save();
      if (cancelled) {
        log(`✗ ${stage.name} interrupted after ${rec.mins} min — resume with:\n  ${resumeHint(stage.name)}`);
        return await finish("interrupted", 130);
      }
      if (r.error || r.code !== 0) {
        log(
          `✗ ${stage.name} failed after ${rec.mins} min (${r.error ? `launch error: ${r.error}` : r.signal ? `signal ${r.signal}` : `exit ${r.code}`}). ` +
            `All stages are idempotent — resume with:\n  ${resumeHint(stage.name)}`,
        );
        return await finish("failed", 1);
      }
      log(`✓ ${stage.name} [${rec.mins} min]`);
      // Invariants after every stage: a broken state stops the run right here.
      if (jev && stage.name !== "check") {
        rec.check = { status: "ok", startedAt: new Date().toISOString() };
        const c = await runChild(path.join(pipelineDir, "scripts", "check-run.ts"), ["--consultation", consultation, "--quiet"], pipelineDir, `check:${stage.name}`);
        rec.check.endedAt = new Date().toISOString();
        rec.check.exit = c.code;
        rec.check.signal = c.signal;
        if (cancelled) {
          rec.check.status = "interrupted";
          save();
          log(`✗ interrupted during the check after ${stage.name} — resume (re-runs ${stage.name}, then its check) with:\n  ${resumeHint(stage.name)}`);
          return await finish("interrupted", 130);
        }
        if (c.error || c.code !== 0) {
          rec.check.status = "failed";
          save();
          // Point back to the producing stage: its check must pass before anything later runs.
          log(`✗ invariant check failed after ${stage.name} — stopped. Inspect and fix, then re-run ${stage.name} and its check with:\n  ${resumeHint(stage.name)}`);
          return await finish("failed", 1);
        }
        save();
      }
    }
    log(`all stages done [${((Date.now() - startedAt.getTime()) / 60_000).toFixed(1)} min]`);
    for (const r of run.stages) log(`  ${r.name.padEnd(18)} ${r.mins} min${r.check ? ` · check ${r.check.status}` : ""}`);
    await finish("done", 0);
  } catch (err) {
    await finish("failed", 1, `orchestrator error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
