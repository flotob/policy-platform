/**
 * The machine's background work: one job at a time, in this server process
 * (started from instrumentation.ts). One at a time on purpose — the language
 * model runs on a subscription with a session limit, and a municipal
 * procedure has a handful of statements, not thousands.
 *
 * Jobs survive restarts: a job left "laeuft" by a crashed process is picked
 * up again after STALE_MIN; every step of the core loop is resumable (cached
 * model outputs, stored moves are skipped).
 */

import { sql } from "@policy/db";
import { audit, decomposeFile, decomposeShort, machineDecides, proposeCampNames, proposeSkeleton, syncDerivedVotes, writeAndCheck } from "@policy/pipeline/kern";

import { getResult, setCampNames } from "./auswertung";
import { getReport, namingOf } from "./bericht";
import { getCampaign } from "./campaigns";
import { getDb } from "./db";
import { kernCampaign, kernDeps } from "./kern";

const POLL_MS = 3000;
const STALE_MIN = 20;
const MAX_ATTEMPTS = 3;

type Row = Record<string, unknown>;

const log = (m: string) => console.log(`[kern] ${m}`);

async function claim(): Promise<Row | null> {
  const db = getDb();
  await db.execute(sql`
    UPDATE campaign_jobs SET state = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'fehler' ELSE 'wartet' END,
      error = COALESCE(error, 'unterbrochen')
    WHERE state = 'laeuft' AND started_at < now() - make_interval(mins => ${STALE_MIN})`);
  const r = await db.execute(sql`
    UPDATE campaign_jobs SET state = 'laeuft', attempts = attempts + 1, started_at = now(), error = NULL
    WHERE id = (SELECT id FROM campaign_jobs WHERE state = 'wartet' ORDER BY created_at, kind <> 'skelett' FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`);
  return (r.rows[0] as Row | undefined) ?? null;
}

/** One job, start to finish. Exported for scripts that drain the queue without the server. */
export async function runJob(job: Row): Promise<void> {
  const db = getDb();
  const t = await db.execute(sql`SELECT name FROM tenants WHERE id = ${job.tenant_id as string}`);
  const campaign = await getCampaign(job.tenant_id as string, job.campaign_id as string);
  if (!campaign) throw new Error("Das Verfahren gibt es nicht mehr.");
  const c = kernCampaign(campaign, (t.rows[0] as Row).name as string);
  const deps = await kernDeps(log);
  let result: unknown;
  if (job.kind === "skelett") {
    result = await proposeSkeleton(deps, c);
  } else if (job.kind === "lagernamen") {
    // The machine proposes; the editors confirm. A confirmed naming is never overwritten.
    const saved = await getResult(campaign.id, job.result_id as string);
    if (!saved) throw Object.assign(new Error("Das Ergebnis gibt es nicht mehr."), { fatal: true });
    const proposal = await proposeCampNames(deps.llm, saved.result, campaign.measure);
    const current = namingOf(saved.campNames);
    await setCampNames(saved.id, current?.confirmedBy ? { ...current, proposal } : { ...proposal, proposal, confirmedBy: null, confirmedAt: null });
    await audit(db, { tenantId: campaign.tenantId, actor: "ki:lagernamen", action: "result.camp_names_proposed", subjectKind: "campaign_result", subjectId: saved.id, payload: proposal });
    result = proposal;
  } else if (job.kind === "bericht") {
    // R2 → R3, once more with the objections if the check fails (writeAndCheck).
    const report = await getReport(campaign.id, job.report_id as string);
    if (!report) throw Object.assign(new Error("Den Bericht gibt es nicht mehr."), { fatal: true });
    if (report.state !== "liste" && report.state !== "durchgefallen") throw Object.assign(new Error("Diese Fassung ist schon geprüft."), { fatal: true });
    const { text, checks } = await writeAndCheck(deps, report.sentences, { town: c.context.town, measure: campaign.measure }, report.feedback ? [`Die Redaktion: ${report.feedback}`] : []);
    const state = checks.passed ? "geprueft" : "durchgefallen";
    await db.execute(sql`
      UPDATE campaign_reports SET text = ${JSON.stringify(text)}, checks = ${JSON.stringify(checks)}, state = ${state}, updated_at = now() WHERE id = ${report.id}`);
    await audit(db, { tenantId: campaign.tenantId, actor: "ki:bericht", action: `report.${state}`, subjectKind: "campaign_report", subjectId: report.id, payload: { attempts: checks.attempts, rules: checks.rules.length, flagged: checks.reader.filter((x) => !x.pass).length } });
    result = { state, attempts: checks.attempts, paragraphs: text.length };
  } else {
    result =
      job.kind === "kurzaussage" ? await decomposeShort(deps, c, job.submission_id as string) : await decomposeFile(deps, c, job.file_id as string);
    const decided = await machineDecides(deps, c);
    if (c.params.editorialMode === "ki") result = { ...(result as object), machine: decided };
    // Automatic attachments and the machine's decisions count as votes of the senders (assumption 3).
    await syncDerivedVotes(db, c.consultationId);
  }
  await db.execute(sql`
    UPDATE campaign_jobs SET state = 'fertig', result = ${JSON.stringify(result)}, finished_at = now() WHERE id = ${job.id as string}`);
  log(`${job.kind} ${job.id} done`);
}

async function tick(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  try {
    await runJob(job);
  } catch (e) {
    const err = e as Error & { fatal?: boolean };
    log(`${job.kind} ${job.id} failed: ${err.message}`);
    // Unreadable files and refused skeletons do not get better by retrying.
    const final = err.fatal || err.name === "UnreadableFile" || /freigegeben/.test(err.message) || Number(job.attempts) >= MAX_ATTEMPTS;
    await getDb().execute(sql`
      UPDATE campaign_jobs SET state = ${final ? "fehler" : "wartet"}, error = ${err.message.slice(0, 500)}, finished_at = ${final ? new Date().toISOString() : null}
      WHERE id = ${job.id as string}`);
  }
  return true;
}

let running = false;

export function startWorker(): void {
  if (running) return;
  running = true;
  log("worker started");
  void (async () => {
    for (;;) {
      try {
        if (!(await tick())) await new Promise((r) => setTimeout(r, POLL_MS));
      } catch (e) {
        // The database is away (Docker asleep): wait and try again.
        log(`worker: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, POLL_MS * 5));
      }
    }
  })();
}

/** Drain the queue once (scripts, tests). */
export async function drain(): Promise<number> {
  let n = 0;
  while (await tick()) n++;
  return n;
}

