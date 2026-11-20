/**
 * Prints the report's binding sentences (R1) for one procedure, computed fresh from today's votes with
 * today's code, without the language model — to read the report's structure while working on it.
 * The camp names and descriptions are the ones last confirmed. Nothing is written.
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/bericht-saetze.mts <gemeinde> <verfahren> [--stored] [--text]
 *   --stored: use the stored result instead of computing it fresh
 *   --text:   also let the language model write the text (R2) and run the checks (R3), as the worker
 *             would — printed only, nothing stored (costs one model call per attempt and Jev reads)
 */
import { sql } from "@policy/db";
import { conclusions, headline, SECTIONS, smallHeadline, writeAndCheck, type SectionKey } from "@policy/pipeline/kern";

import { latestResult, liveResult } from "../src/lib/auswertung.ts";
import { namingOf } from "../src/lib/bericht.ts";
import { getCampaign } from "../src/lib/campaigns.ts";
import { getDb } from "../src/lib/db.ts";
import { kernDeps } from "../src/lib/kern.ts";
import { QUESTIONS } from "../src/lib/params.ts";

const [gemeinde, verfahren] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!gemeinde || !verfahren) throw new Error("usage: bericht-saetze.mts <gemeinde> <verfahren> [--stored]");
const db = getDb();
const [x] = (
  await db.execute(sql`SELECT c.id, c.tenant_id, t.name FROM campaigns c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = ${gemeinde} AND c.slug = ${verfahren}`)
).rows as Record<string, unknown>[];
if (!x) throw new Error("no such procedure");
const c = (await getCampaign(x.tenant_id as string, x.id as string))!;
const saved = await latestResult(c.id);
const naming = namingOf(saved?.campNames);
const r = process.argv.includes("--stored") && saved ? saved.result : await liveResult(c);
const sentences = conclusions(r, naming?.names ?? null, {
  town: String(x.name),
  measure: c.measure,
  questions: QUESTIONS.map((q) => ({ key: q.key, label: q.label })),
  fictional: c.fictional,
  editorialMode: c.params.editorialMode,
  resultVersion: saved?.version ?? 0,
  descriptions: naming?.descriptions ?? null,
});
const h = r.ready ? headline(r) : smallHeadline(r);
console.log(`Headline: ${h.lead} ${h.rest.map((s) => s.text).join("")}\n`);
for (const key of Object.keys(SECTIONS) as SectionKey[]) {
  const ss = sentences.filter((s) => s.section === key);
  if (!ss.length) continue;
  console.log(`## ${SECTIONS[key]}`);
  for (const s of ss) console.log(`${s.id}: ${s.text}`);
  console.log("");
}
if (process.argv.includes("--text")) {
  const deps = await kernDeps((m) => console.error(m));
  const { text, checks } = await writeAndCheck(deps, sentences, { town: String(x.name), measure: c.measure });
  console.log(`\n======== TEXT (${checks.passed ? "passed" : "FAILED"}, attempts ${checks.attempts}) ========\n`);
  let last = "";
  for (const a of text) {
    if (a.abschnitt !== last) console.log(`\n## ${SECTIONS[a.abschnitt]}`);
    last = a.abschnitt;
    console.log(`${a.text}   (${a.saetze.join(",")})\n`);
  }
  for (const i of checks.rules) console.log(`RULE: ${i.text}`);
  for (const x of checks.reader.filter((y) => !y.pass)) console.log(`READER: Absatz ${x.absatz} treu ${x.treu.toFixed(2)} richtung ${x.richtung.toFixed(2)} staerke ${x.staerke.toFixed(2)}`);
}
process.exit(0);
