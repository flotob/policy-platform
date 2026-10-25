/**
 * Own points through door 2 for the FICTIONAL demo (demo/kurzaussagen.json):
 * Stephan's short quotes from his results page, word for word, plus points
 * written for the example. Each goes the way a typed one goes — Jev's check
 * while the citizen waits, stored with it (src/lib/tuer2.ts) — from a
 * simulated person of the matching camp. The citizen's answer is played
 * from the file: "Ja, das meine ich" when the machine offers the point the
 * person means, otherwise "Nein" (to the editors); no argument → left there.
 * Marked: the people are simulated, the submissions carry source_system
 * 'simulation'.
 *
 * Usage (from apps/beteiligung, server running for the machine's jobs):
 *   set -a && source .env.local && set +a && tsx scripts/demo-tuer2.mts --phase 1|2 [--dry]
 *   --dry  only Jev's check and the answer it would lead to; nothing is stored
 */
import { readFileSync } from "node:fs";

import { sql } from "@policy/db";

import { getPublicCampaign } from "../src/lib/campaigns.ts";
import { getDb } from "../src/lib/db.ts";
import { releasedNodes } from "../src/lib/kern.ts";
import { answerShort, runShortCheck, storeShort } from "../src/lib/tuer2.ts";

interface Punkt {
  phase: number;
  lager: "A" | "B";
  quelle: string;
  t: string;
  ziel: string[] | "neu" | "kein";
}

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const phase = Number(arg("phase") ?? 1);
const dry = process.argv.includes("--dry");

const file = JSON.parse(readFileSync(new URL("../demo/kurzaussagen.json", import.meta.url), "utf8")) as { punkte: Punkt[] };
const punkte = file.punkte.filter((p) => p.phase === phase);

const c = await getPublicCampaign("musterstadt", "solarpflicht");
if (!c || !c.fictional) throw new Error("no fictional demo campaign");
if (!dry && c.state !== "offen") throw new Error(`the demo is "${c.state}" — open it first (scripts/open-demo.mts)`);
const db = getDb();
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];

// Simulated people by camp, as simulate.mts drew them; those who already sent a point are not used again.
const people = await rows(sql`
  SELECT p.id, p.source_ref,
    (SELECT COALESCE(sum(v.value), 0) FROM map_point_votes v JOIN map_points n ON n.id = v.map_point_id
     WHERE v.participant_id = p.id AND (n.rolle = 'schluss' OR (n.rolle = 'praemisse' AND n.typ = 'W')))::int AS lean,
    EXISTS (SELECT 1 FROM submissions s WHERE s.participant_id = p.id) AS used
  FROM participants p WHERE p.consultation_id = ${c.consultationId} AND p.via = 'simulation' ORDER BY p.source_ref`);
const campOf = (p: Record<string, unknown>): "A" | "B" => {
  const m = /:([AB])$/.exec(p.source_ref as string);
  return m ? (m[1] as "A" | "B") : Number(p.lean) >= 0 ? "A" : "B";
};
const used = new Set(people.filter((p) => p.used).map((p) => p.id as string));

async function person(lager: "A" | "B", node: string | null, stance: number): Promise<string> {
  const free = people.filter((p) => campOf(p) === lager && !used.has(p.id as string));
  if (!free.length) throw new Error(`no simulated person left in camp ${lager}`);
  // Someone whose own vote on that point fits what they now say, if there is one.
  let pick = free[0]!;
  if (node) {
    const fit = await rows(sql`
      SELECT participant_id FROM map_point_votes WHERE map_point_id = ${node} AND value = ${stance}
        AND participant_id = ANY(${`{${free.map((p) => p.id).join(",")}}`}::uuid[])`);
    const ids = new Set(fit.map((x) => x.participant_id as string));
    pick = free.find((p) => ids.has(p.id as string)) ?? pick;
  }
  used.add(pick.id as string);
  return pick.id as string;
}

const nodes = await releasedNodes(c.consultationId);
const text = new Map(nodes.map((n) => [n.id, n.text]));
const tally: Record<string, number> = {};
for (const [i, p] of punkte.entries()) {
  const run = await runShortCheck(c, p.t, nodes);
  const k = run.check;
  const offered = k.node ? (text.get(k.node) ?? "") : "";
  const means = Array.isArray(p.ziel) && !!k.node && p.ziel.some((w) => offered.includes(w));
  let answer: "ja" | "nein" | null;
  if (k.outcome === "kein_argument") answer = p.ziel === "kein" ? null : "nein";
  else if (k.outcome === "neu") answer = null;
  else answer = means ? "ja" : "nein";
  const what = `${k.outcome}${k.node ? ` ${k.stance === -1 ? "≠" : "="} „${offered.slice(0, 60)}…“` : ""} · Ziel ${String(p.ziel).slice(0, 30)} · Zweck ${k.aim ?? "?"} → ${answer ?? "–"}`;
  console.log(`${String(i + 1).padStart(2)} [${p.lager}] ${p.t.slice(0, 60)}\n     ${what}`);
  const key = `${k.outcome}/${answer ?? "-"}`;
  tally[key] = (tally[key] ?? 0) + 1;
  if (dry) continue;
  const pid = await person(p.lager, answer === "ja" ? k.node : null, k.stance);
  const { submissionId } = await storeShort(c, pid, p.t, run, { sourceSystem: "simulation" });
  if (answer) {
    const [s] = await rows(sql`
      SELECT s.id, s.text, j.decided FROM submissions s LEFT JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text
      AND j.family LIKE 'kern-short.%' WHERE s.id = ${submissionId}`);
    await answerShort(c, s!, answer);
  }
}
console.log(`\n${dry ? "dry run — nothing stored. " : ""}${punkte.length} points, phase ${phase}:`, tally);
process.exit(0);
