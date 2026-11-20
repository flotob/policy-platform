/**
 * Makes the Musterstadt example "Neues Schwimmbad" a full procedure (the town is the fiction; this
 * script refuses any other town). Everything goes the way it would in a real procedure: the letters
 * through the town's upload and through door 3, read and sorted in by the machine; the voters and the
 * drawn residents are simulated like the Solarpflicht's (via = 'simulation', method 'simulation';
 * the report says how many). Three camps:
 *   A "Familien und Sport"       — build now, the tax is acceptable
 *   B "Gewerbe und Haushalt"     — a pool yes, paid by the Gewerbesteuer no
 *   C "Sanieren statt neu bauen" — renovate the 1978 pool in the Innenstadt, add a Lehrschwimmbecken
 *
 * Usage (from apps/beteiligung): set -a && source .env.local && set +a && tsx scripts/demo-schwimmbad.mts <step>
 *   upload               the 16 letters in demo/schwimmbad (manifest.json), queue the machine's reading
 *   voters [--n 520]     simulated voters on every released statement (replaces earlier ones)
 *   top-up               existing simulated voters vote on statements none of them has seen yet
 *   los [--drawn 140] [--letters 2500]   the cross-check by lot (replaces an earlier one)
 *   remove               simulated voters, their own points and the drawn residents
 *   status               what is there
 * Order: upload → (machine reads) → voters → demo-tuer2.mts --verfahren neues-schwimmbad --file … →
 * (machine sorts in) → open-demo.mts --verfahren neues-schwimmbad → top-up → los.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "@policy/db";
import { extractFileText } from "@policy/pipeline/kern";

import { getDb } from "../src/lib/db.ts";
import { enqueue } from "../src/lib/kern.ts";
import { trackingToken } from "../src/lib/tuer2.ts";

const TOWN = "musterstadt";
const SLUG = "neues-schwimmbad";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "schwimmbad");
const CAMPS = ["A", "B", "C"] as const;
type Camp = 0 | 1 | 2;

const step = process.argv[2];
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const db = getDb();
type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];

const [c] = await rows(sql`
  SELECT c.id, c.tenant_id, c.consultation_id, c.state FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
  WHERE t.slug = ${TOWN} AND c.slug = ${SLUG}`);
if (!c) throw new Error(`no procedure ${TOWN}/${SLUG}`);
const campaignId = c.id as string;
const tenantId = c.tenant_id as string;
const consultationId = c.consultation_id as string;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function hashNum(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

interface Node {
  id: string;
  rolle: string;
  typ: string;
  richtung: string | null;
  version: number;
  text: string;
}

/**
 * Probability of agreeing in camps A, B, C, from what the statement says — a stand-in for real opinion.
 * Topic rules first (the wording comes from the machine, so they look for word stems), then a default
 * from the statement's kind and direction. `drawn`: residents drawn by lot, who are not the engaged ones.
 */
function lean(n: Node, drawn = false): [number, number, number] {
  const t = n.text;
  const has = (re: RegExp) => re.test(t);
  const attack = n.richtung === "greift_an";
  if (n.rolle === "schluss") return [0.9, 0.22, 0.14];
  // The cross-check: those who came on their own like swimming; the drawn are less sure the spending is justified.
  if (has(/gerechtfertigt, wenn|Zugang für alle Kinder/i)) return drawn ? [0.84, 0.36, 0.4] : [0.92, 0.72, 0.72];
  // Apparent agreements: everyone wants the check and the time limit — for opposite reasons (the letters say which).
  if (has(/Wirtschaftlichkeitsprüfung|Wirtschaftlichkeitsuntersuchung/i)) return [0.78, 0.84, 0.92];
  if (has(/befrist/i)) return [0.7, 0.88, 0.72];
  // Common ground: children, schools, the teaching pool, access, prices.
  if (has(/schwimmen (zu )?(können|lernen)|Schwimmfähigkeit|sicher schwimmen|Nichtschwimmer|grundlegende Fähigkeit|überlebenswichtig/i) && !attack)
    return [0.93, 0.84, 0.88];
  if (has(/Lehrschwimmbecken|Hubboden/i) && !has(/Anbau|anbauen|Sanierung|saniert/i)) return [0.9, 0.8, 0.9];
  if (has(/Schulschwimm|Schulzeiten|Schwimmunterricht|Schwimmstunden|Wasserzeiten/i) && !has(/Sanierung|Bauzeit/i)) return [0.9, 0.78, 0.86];
  if (has(/barrierefrei|Aufzug|sozial|Eintritt|bezahlbar|Sozialpass|geringem Einkommen|Rehasport|Warteliste/i)) return [0.88, 0.72, 0.82];
  // Renovation instead of a new build (camp C), and the town's claims against it.
  if (has(/Sanierung würde keine|keine zusätzlichen (Schwimm|Wasser)fläche|Bauzeit|beste Möglichkeit/i)) return [0.86, 0.5, 0.1];
  if (has(/Sanierung|sanier|Anbau|anbauen|Innenstadt|zu Fuß|fußläufig|alten Standort|Mosaik|Sauna/i)) return [0.14, 0.42, 0.92];
  // The site at the Parkstraße.
  if (has(/Bäume|Baumbestand|Kaltluft|Stadtpark|Grünfläche|Verkehr|Autofahrten|Parkpl|Stellpl|Lärm|Sportzentrum Nord/i)) return [0.24, 0.4, 0.9];
  // Money: the cost estimates and the gap — B and C doubt them, A trusts the town.
  if (has(/Mehreinnahmen reichen|reichen .*aus, um die Finanzierungskosten/i)) return [0.8, 0.18, 0.12];
  if (has(/16 bis 22|Baukosten|Baupreis|Mehrkosten|teurer|Defizit|Betriebskosten|1,0 bis 1,4|300\.000|Lücke|nicht tragbar|nicht aufgeh|1,5 Millionen|2029/i))
    return attack ? [0.2, 0.84, 0.9] : [0.8, 0.3, 0.2];
  if (has(/Förder|Landesförder/i)) return attack ? [0.3, 0.8, 0.6] : [0.86, 0.6, 0.55];
  // Neighbours: cooperation instead of an own pool (B), and the town's claim that it would not suffice.
  if (has(/Nachbargemeinde|Beispielhausen|Zweckverband|Kooperation|Zusammenarbeit/i))
    return !attack && has(/nicht vollständig|nicht decken|keine verlässliche|ausgebucht/i) ? [0.86, 0.24, 0.5] : [0.22, 0.86, 0.5];
  // Business and the Gewerbesteuer (camp B).
  if (has(/abwander|Wegzug|verlässt|verlassen die Stadt|wegziehen/i)) return attack ? [0.12, 0.86, 0.42] : [0.88, 0.2, 0.5];
  if (has(/350 Euro|nicht repräsentativ|§ ?35|Anrechnung|Hinzurechnung|Personen(unternehmen|gesellschaft)|Handwerk|Betriebe|Unternehmen|Gewerbe|Hebesatz|Grundsteuer|Wettbewerbsdruck/i)) {
    if (attack) return [0.14, 0.9, 0.4];
    // Supporting: a value ("firms can carry it") splits like the core; a fact (the town's example) is mostly believed.
    return n.typ === "W" ? [0.9, 0.12, 0.38] : [0.84, 0.42, 0.62];
  }
  if (has(/freiwillige (Aufgabe|Leistung)|nicht leisten/i)) return [0.1, 0.86, 0.66];
  if (has(/Daseinsvorsorge|öffentliche Aufgabe|Pflichtaufgabe/i)) return [0.9, 0.2, 0.42];
  if (has(/Nutzen|überwiegt|zumutbar|Gemeinwohl|gesellschaftlichen Wert|lohnt/i)) return attack ? [0.1, 0.86, 0.62] : [0.92, 0.16, 0.36];
  // Smaller wishes from door 2 and the letters.
  if (has(/Freibad/i)) return [0.12, 0.46, 0.4];
  if (has(/Sponsor|Bistro|Fitness|Vereine .*zahlen|Bürgerentscheid/i)) return [0.4, 0.74, 0.62];
  if (has(/Rutsche|Jugend|Frühschwimm|Schicht|Frauen|Ganztag|Container|Öffnungszeit/i)) return [0.82, 0.5, 0.58];
  // Defaults from the kind of statement.
  if (n.typ === "W") return attack ? [0.14, 0.78, 0.66] : [0.88, 0.3, 0.4];
  if (n.typ === "verfahren") return attack ? [0.42, 0.76, 0.72] : [0.8, 0.66, 0.68];
  return attack ? [0.26, 0.72, 0.74] : [0.86, 0.64, 0.6];
}

const nodesNow = async () =>
  (
    await rows(sql`
      SELECT id, rolle, typ, richtung, version, text FROM map_points
      WHERE consultation_id = ${consultationId} AND rolle IS NOT NULL AND status = 'released' ORDER BY ord`)
  ).map((n) => ({ ...n, version: Number(n.version) }) as Node);

/** One person's vote on one statement: agree, pass, disagree or nothing (not everyone sees everything). */
function vote(r: () => number, pa: number): -1 | 0 | 1 {
  const x = r();
  return x < pa ? 1 : x < pa + (1 - pa) * 0.22 ? 0 : -1;
}

async function castVotes(pid: string, camp: Camp, nodes: Node[], seed: string, drawn: boolean) {
  const r = rng(hashNum(seed));
  const share = 0.55 + 0.45 * r();
  const values: string[] = [];
  for (const n of nodes) {
    const rn = rng(hashNum(`${seed}|${n.id}`));
    if (n.rolle !== "schluss" && rn() > share) continue;
    values.push(`('${tenantId}','${pid}','${n.id}',${n.version},${vote(rn, lean(n, drawn)[camp])},'simulation')`);
  }
  if (values.length)
    await db.execute(sql.raw(`INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, version, value, method) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`));
  return values.length;
}

const campOfRef = (ref: string): Camp => (ref.endsWith(":B") ? 1 : ref.endsWith(":C") ? 2 : 0);

async function removeVoters(withOwnPoints: boolean) {
  const sims = sql`SELECT id FROM participants WHERE consultation_id = ${consultationId} AND via = 'simulation' AND source_ref LIKE 'simulation:%'`;
  const own = (await rows(sql`SELECT id FROM submissions WHERE participant_id IN (${sims})`)).map((x) => x.id as string);
  if (own.length && !withOwnPoints) throw new Error(`simulated voters have sent ${own.length} own points — use top-up, or remove first`);
  if (own.length) {
    const ids = `{${own.join(",")}}`;
    await db.execute(sql`DELETE FROM moves WHERE submission_id = ANY(${ids}::uuid[])`);
    await db.execute(sql`DELETE FROM judgments WHERE subject_kind = 'submission' AND subject_id = ANY(${ids}::text[])`);
    await db.execute(sql`DELETE FROM extractions WHERE submission_id = ANY(${ids}::uuid[])`);
    await db.execute(sql`DELETE FROM campaign_jobs WHERE submission_id = ANY(${ids}::uuid[])`);
    await db.execute(sql`DELETE FROM submissions WHERE id = ANY(${ids}::uuid[])`);
  }
  await db.execute(sql`DELETE FROM map_point_votes WHERE participant_id IN (${sims})`);
  await db.execute(sql`DELETE FROM participants WHERE consultation_id = ${consultationId} AND via = 'simulation' AND source_ref LIKE 'simulation:%'`);
  return own.length;
}

async function removeDrawn() {
  const old = sql`SELECT id FROM participants WHERE consultation_id = ${consultationId} AND via = 'simulation' AND source_ref LIKE 'simulation-los:%'`;
  await db.execute(sql`DELETE FROM map_point_votes WHERE participant_id IN (${old})`);
  await db.execute(sql`DELETE FROM campaign_invites WHERE campaign_id = ${campaignId} AND kind = 'gelost'`);
  await db.execute(sql`DELETE FROM participants WHERE consultation_id = ${consultationId} AND via = 'simulation' AND source_ref LIKE 'simulation-los:%'`);
}

interface Letter {
  file: string;
  sender: string;
  senderType: string;
  door: "stadt" | "tuer3";
  lager: "A" | "B" | "C";
  datum: string;
}

async function upload() {
  const letters = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as Letter[];
  let n = 0;
  for (const l of letters) {
    const bytes = readFileSync(join(DIR, "stellungnahmen", l.file));
    const hash = sha(bytes);
    const there = await rows(sql`SELECT 1 FROM campaign_files WHERE campaign_id = ${campaignId} AND sha256 = ${hash}`);
    if (there.length) continue;
    const at = new Date(`${l.datum}T10:00:00Z`);
    const org = l.senderType === "privat" ? null : l.sender;
    if (l.door === "stadt") {
      // A letter the town received and uploads: the machine reads it from the file.
      const [f] = await rows(sql`
        INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, created_at)
        VALUES (${tenantId}, ${campaignId}, 'stellungnahme', ${l.file}, 'text/plain', ${bytes.length}, ${hash}, ${bytes}, ${org}, ${l.senderType}, ${at})
        RETURNING id`);
      await enqueue(tenantId, campaignId, "zerlegen", f!.id as string);
    } else {
      // Door 3, as the public form does it: a pseudonymous participant for the browser; an organisation is a
      // participant of its own; a tracking slip per file.
      const [p] = await rows(sql`
        INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via, created_at)
        VALUES (${tenantId}, ${consultationId}, ${`tuer:${sha(randomBytes(24))}`}, 'privat', 'de', 'tuer', ${at}) RETURNING id`);
      let participant = p!.id as string;
      if (org) {
        const [o] = await rows(sql`
          INSERT INTO participants (tenant_id, consultation_id, source_ref, author_org, author_type, language, via, created_at)
          VALUES (${tenantId}, ${consultationId}, ${`org:${org.toLowerCase().replace(/\s+/g, " ")}|${participant}`}, ${org}, ${l.senderType}, 'de', 'stellungnahme', ${at})
          RETURNING id`);
        participant = o!.id as string;
      }
      const text = await extractFileText(new Uint8Array(bytes), l.file, "text/plain");
      const [f] = await rows(sql`
        INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type, participant_id, created_at)
        VALUES (${tenantId}, ${campaignId}, 'stellungnahme', ${l.file}, 'text/plain', ${bytes.length}, ${hash}, ${bytes}, ${org}, ${org ? l.senderType : "privat"}, ${participant}, ${at})
        RETURNING id`);
      const [s] = await rows(sql`
        INSERT INTO submissions (tenant_id, consultation_id, door, author_org, author_type, language, source_system, source_ref, text,
                                 submitted_at, created_at, participant_id, tracking_token)
        VALUES (${tenantId}, ${consultationId}, 'document', ${org}, ${org ? l.senderType : "privat"}, 'de', 'beteiligung', ${f!.id as string}, ${text},
                ${at}, ${at}, ${participant}, ${trackingToken()}) RETURNING id`);
      await db.execute(sql`UPDATE campaign_files SET submission_id = ${s!.id as string} WHERE id = ${f!.id as string}`);
      await enqueue(tenantId, campaignId, "zerlegen", f!.id as string);
    }
    n++;
  }
  console.log(`${n} letters uploaded (${letters.length - n} were there already), reading queued`);
}

async function voters() {
  const N = Number(arg("n") ?? 520);
  const removed = await removeVoters(process.argv.includes("--remove-own"));
  const nodes = await nodesNow();
  const r = rng(1925);
  let votes = 0;
  for (let i = 0; i < N; i++) {
    const x = r();
    const camp: Camp = x < 0.46 ? 0 : x < 0.74 ? 1 : 2;
    const ref = `simulation:${String(i).padStart(3, "0")}:${CAMPS[camp]}`;
    // Spread over the weeks the procedure has been open, so the participation curve looks like one.
    const at = new Date(Date.parse("2026-10-26T08:00:00Z") + Math.floor(r() * 25 * 86400000));
    const [p] = await rows(sql`
      INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via, created_at)
      VALUES (${tenantId}, ${consultationId}, ${ref}, 'simulation', 'de', 'simulation', ${at}) RETURNING id`);
    votes += await castVotes(p!.id as string, camp, nodes, ref, false);
  }
  console.log(`${N} simulated voters (${removed ? `${removed} own points of the earlier ones removed, ` : ""}${votes} votes on ${nodes.length} statements)`);
}

async function topUp() {
  const nodes = await nodesNow();
  const people = await rows(sql`
    SELECT id, source_ref FROM participants WHERE consultation_id = ${consultationId} AND via = 'simulation' ORDER BY source_ref`);
  const seen = new Set(
    (
      await rows(sql`
        SELECT DISTINCT v.map_point_id, v.version FROM map_point_votes v JOIN participants p ON p.id = v.participant_id
        WHERE p.consultation_id = ${consultationId} AND p.via = 'simulation'`)
    ).map((x) => `${x.map_point_id as string}:${x.version as number}`),
  );
  const fresh = nodes.filter((n) => !seen.has(`${n.id}:${n.version}`));
  let votes = 0;
  for (const p of people) {
    const ref = p.source_ref as string;
    votes += await castVotes(p.id as string, campOfRef(ref), fresh, ref, ref.startsWith("simulation-los:"));
  }
  console.log(`top-up: ${votes} votes on ${fresh.length} new statements from ${people.length} simulated people`);
}

async function los() {
  const N = Number(arg("drawn") ?? 140);
  const LETTERS = Number(arg("letters") ?? 2500);
  await removeDrawn();
  const nodes = await nodesNow();
  const r = rng(2511);
  let votes = 0;
  for (let i = 0; i < N; i++) {
    // The drawn are the town, not the engaged: the camps are closer in size.
    const x = r();
    const camp: Camp = x < 0.38 ? 0 : x < 0.68 ? 1 : 2;
    const ref = `simulation-los:${String(i).padStart(3, "0")}:${CAMPS[camp]}`;
    const at = new Date(Date.parse("2026-11-06T08:00:00Z") + Math.floor(r() * 14 * 86400000));
    const [p] = await rows(sql`
      INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via, created_at)
      VALUES (${tenantId}, ${consultationId}, ${ref}, 'simulation', 'de', 'simulation', ${at}) RETURNING id`);
    await db.execute(sql`
      INSERT INTO campaign_invites (tenant_id, campaign_id, code_hash, kind, participant_id, used_at)
      VALUES (${tenantId}, ${campaignId}, ${sha(randomBytes(16))}, 'gelost', ${p!.id as string}, ${at})`);
    votes += await castVotes(p!.id as string, camp, nodes, ref, true);
  }
  // The letters nobody answered: their codes exist, unused.
  const unused = Array.from({ length: LETTERS - N }, () => `('${tenantId}','${campaignId}','${sha(randomBytes(16))}','gelost')`);
  for (let i = 0; i < unused.length; i += 500)
    await db.execute(sql.raw(`INSERT INTO campaign_invites (tenant_id, campaign_id, code_hash, kind) VALUES ${unused.slice(i, i + 500).join(",")}`));
  console.log(`${LETTERS} letters, ${N} drawn residents took part (simulated), ${votes} votes on ${nodes.length} statements`);
}

async function status() {
  const [x] = await rows(sql`
    SELECT
      (SELECT count(*) FROM campaign_files WHERE campaign_id = ${campaignId} AND role = 'stellungnahme')::int AS letters,
      (SELECT count(*) FROM campaign_jobs WHERE campaign_id = ${campaignId} AND state IN ('wartet', 'laeuft'))::int AS jobs,
      (SELECT count(*) FROM campaign_jobs WHERE campaign_id = ${campaignId} AND state = 'fehler')::int AS failed,
      (SELECT count(*) FROM map_points WHERE consultation_id = ${consultationId} AND status = 'released' AND rolle IS NOT NULL)::int AS released,
      (SELECT count(*) FROM map_points WHERE consultation_id = ${consultationId} AND status = 'draft')::int AS drafts,
      (SELECT count(*) FROM moves WHERE consultation_id = ${consultationId} AND state = 'vorgelegt')::int AS waiting,
      (SELECT count(*) FROM participants WHERE consultation_id = ${consultationId} AND source_ref LIKE 'simulation:%')::int AS sims,
      (SELECT count(*) FROM participants WHERE consultation_id = ${consultationId} AND source_ref LIKE 'simulation-los:%')::int AS drawn,
      (SELECT count(*) FROM submissions WHERE consultation_id = ${consultationId} AND door = 'statement')::int AS short`);
  console.log(`${c!.state as string}:`, x);
}

if (step === "upload") await upload();
else if (step === "voters") await voters();
else if (step === "top-up") await topUp();
else if (step === "los") await los();
else if (step === "remove") {
  const n = await removeVoters(true);
  await removeDrawn();
  console.log(`simulated voters and drawn residents removed (${n} own points with them)`);
} else if (step === "status") await status();
else throw new Error("step: upload | voters | top-up | los | remove | status");
process.exit(0);
