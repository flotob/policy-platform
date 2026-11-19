/**
 * The cross-check by lot for the FICTIONAL demo only (Musterstadt, Solarpflicht): the town "sent"
 * 2,000 letters to residents drawn from its register; 120 took part. They are simulated like the
 * 300 others (via = 'simulation', every vote method = 'simulation'; the pages say so), each came
 * with a code marked 'gelost'. They vote like the two camps, with one difference that makes the
 * cross-check visible: the drawn residents of camp B doubt that the local trades can carry the
 * obligation (the town's premise "Das Handwerk in Musterstadt kann die Solarpflicht planen") —
 * a bridge among those who came on their own, not among the drawn.
 *
 * Usage (from apps/beteiligung); then demo-auswerten.mts evaluates again:
 *   set -a && source .env.local && set +a && tsx scripts/demo-los.mts [--drawn 120] [--letters 2000] [--remove]
 */
import { createHash, randomBytes } from "node:crypto";

import pg from "pg";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("drawn") ?? 120);
const LETTERS = Number(arg("letters") ?? 2000);
const remove = process.argv.includes("--remove");

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** As in simulate.mts: the probability of agreeing per camp, from what the statement is. */
function lean(n: { rolle: string; typ: string; richtung: string | null; text: string }): [number, number] {
  // The one difference: drawn residents of camp B do not believe the trades can do it.
  if (/Handwerk in Musterstadt kann/i.test(n.text)) return [0.84, 0.45];
  if (n.rolle === "schluss") return [0.86, 0.22];
  if (n.typ === "W") {
    if (n.rolle === "beitrag" && n.richtung === "greift_an") return /eigenen Dächer/i.test(n.text) ? [0.12, 0.35] : [0.16, 0.82];
    return [0.84, 0.22];
  }
  if (/möglichst lang|je länger/i.test(n.text)) return [0.18, 0.82];
  if (n.typ === "verfahren") return n.richtung === "greift_an" ? [0.62, 0.8] : [0.8, 0.77];
  if (n.richtung === "greift_an") {
    if (/Handwerk|Fachkr|Personal|Betriebe|Wartezeit/i.test(n.text)) return [0.8, 0.79];
    if (/Denkmal|eigenen Dächer|Wartung/i.test(n.text)) return [0.14, 0.3];
    return [0.26, 0.7];
  }
  if (n.rolle === "praemisse" && /Mehrkosten|Eingriff/i.test(n.text)) return [0.8, 0.4];
  return [0.86, 0.72];
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const code = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join("");
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const c = (
    await db.query(`SELECT c.id, c.tenant_id, c.consultation_id, c.state FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
                    WHERE t.slug = 'musterstadt' AND c.slug = 'solarpflicht' AND c.fictional`)
  ).rows[0];
  if (!c) throw new Error("no fictional demo campaign");
  await db.query("BEGIN");
  const old = `SELECT id FROM participants WHERE consultation_id = $1 AND via = 'simulation' AND source_ref LIKE 'simulation-los:%'`;
  await db.query(`DELETE FROM map_point_votes WHERE participant_id IN (${old})`, [c.consultation_id]);
  await db.query(`DELETE FROM campaign_invites WHERE campaign_id = $1 AND kind = 'gelost'`, [c.id]);
  await db.query(`DELETE FROM participants WHERE consultation_id = $1 AND via = 'simulation' AND source_ref LIKE 'simulation-los:%'`, [c.consultation_id]);
  if (remove) {
    await db.query("COMMIT");
    console.log("drawn group removed");
    process.exit(0);
  }
  const nodes = (
    await db.query(
      `SELECT id, rolle, typ, richtung, version, text FROM map_points WHERE consultation_id = $1 AND rolle IS NOT NULL AND status = 'released' ORDER BY ord`,
      [c.consultation_id],
    )
  ).rows;
  const r = rng(1125);
  let votes = 0;
  for (let i = 0; i < N; i++) {
    // The drawn are not the self-selected: the cost-minded half is as large as the eager one.
    const camp = r() < 0.5 ? 0 : 1;
    const p = await db.query(
      `INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via)
       VALUES ($1, $2, $3, 'simulation', 'de', 'simulation') RETURNING id`,
      [c.tenant_id, c.consultation_id, `simulation-los:${String(i).padStart(3, "0")}:${camp === 0 ? "A" : "B"}`],
    );
    await db.query(
      `INSERT INTO campaign_invites (tenant_id, campaign_id, code_hash, kind, participant_id, used_at) VALUES ($1, $2, $3, 'gelost', $4, now())`,
      [c.tenant_id, c.id, hash(code()), p.rows[0].id],
    );
    const share = 0.6 + 0.4 * r();
    for (const n of nodes) {
      if (n.rolle !== "schluss" && r() > share) continue;
      const pa = lean(n)[camp]!;
      const x = r();
      const value = x < pa ? 1 : x < pa + (1 - pa) * 0.22 ? 0 : -1;
      await db.query(
        `INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, version, value, method) VALUES ($1, $2, $3, $4, $5, 'simulation')`,
        [c.tenant_id, p.rows[0].id, n.id, n.version, value],
      );
      votes++;
    }
  }
  // The letters nobody answered: their codes exist, unused.
  for (let i = N; i < LETTERS; i++) {
    await db.query(`INSERT INTO campaign_invites (tenant_id, campaign_id, code_hash, kind) VALUES ($1, $2, $3, 'gelost')`, [c.tenant_id, c.id, hash(code())]);
  }
  await db.query("COMMIT");
  console.log(`${LETTERS} letters, ${N} drawn residents took part (simulated), ${votes} votes on ${nodes.length} statements`);
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
