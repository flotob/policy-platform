/**
 * Simulated voters for the FICTIONAL demo only (campaigns.fictional): two
 * camps roughly like Stephan's results page ("Klima zuerst" 58 %, "Kosten &
 * Freiheit" 42 %), so the camp math, the live picture and the results page
 * can be tested before real people vote. Every simulated participant has
 * via = 'simulation' and every vote method = 'simulation'; the workspace
 * says so. Deterministic (seeded).
 *
 * Usage (from apps/beteiligung):
 *   set -a && source .env.local && set +a && tsx scripts/simulate.mts [--participants 300] [--remove] [--top-up]
 *
 *   --top-up  keep the simulated people, let them vote on statements none of them has voted on
 *             yet (new points from door 2) — needed once simulated citizens have sent their own points
 *   --remove  remove them, with the own points they sent (demo-tuer2.mts) and what grew from those
 *
 * Each simulated person's camp is kept in source_ref (simulation:<i>:A|B).
 */
import pg from "pg";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("participants") ?? 300);
const remove = process.argv.includes("--remove");
const topUp = process.argv.includes("--top-up");

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Probability of agreeing, per camp, from what the statement is — a rough
 * stand-in for real opinion, shaped like Stephan's example: the facts are
 * mostly shared, the values split, a few fact attacks stay disputed, the
 * skills shortage worries both camps, weak objections fail in both.
 */
function lean(n: { rolle: string; typ: string; richtung: string | null; text: string }): [number, number] {
  if (n.rolle === "schluss") return [0.86, 0.22];
  if (n.typ === "W") {
    if (n.rolle === "beitrag" && n.richtung === "greift_an") return /eigenen Dächer/i.test(n.text) ? [0.12, 0.35] : [0.16, 0.82];
    return [0.84, 0.22];
  }
  // Transition periods "as long as possible" are what camp B wants and camp A fears (Stephan's Fristen case).
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The camp a simulated person was drawn from: kept in source_ref; for older rows read off their votes on the measure and the town's values. */
async function campOf(p: { id: string; source_ref: string }): Promise<0 | 1> {
  const m = /:([AB])$/.exec(p.source_ref);
  if (m) return m[1] === "A" ? 0 : 1;
  const r = await db.query(
    `SELECT COALESCE(sum(v.value), 0)::int AS s FROM map_point_votes v JOIN map_points n ON n.id = v.map_point_id
     WHERE v.participant_id = $1 AND (n.rolle = 'schluss' OR (n.rolle = 'praemisse' AND n.typ = 'W'))`,
    [p.id],
  );
  return Number(r.rows[0].s) >= 0 ? 0 : 1;
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const c = (
    await db.query(`SELECT c.id, c.tenant_id, c.consultation_id FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
                    WHERE t.slug = 'musterstadt' AND c.slug = 'solarpflicht' AND c.fictional`)
  ).rows[0];
  if (!c) throw new Error("no fictional demo campaign");
  await db.query("BEGIN");
  const sims = `SELECT id FROM participants WHERE consultation_id = $1 AND via = 'simulation'`;
  const own = (await db.query(`SELECT id FROM submissions WHERE participant_id IN (${sims})`, [c.consultation_id])).rows.map((x) => x.id as string);
  if (topUp) {
    const nodes = (
      await db.query(
        `SELECT id, rolle, typ, richtung, version, text FROM map_points WHERE consultation_id = $1 AND rolle IS NOT NULL AND status = 'released' ORDER BY ord`,
        [c.consultation_id],
      )
    ).rows;
    // Only statements no simulated person has voted on yet: the new ones. Earlier skips stay skips.
    const seen = new Set(
      (
        await db.query(
          `SELECT DISTINCT v.map_point_id, v.version FROM map_point_votes v JOIN participants p ON p.id = v.participant_id
           WHERE p.consultation_id = $1 AND p.via = 'simulation'`,
          [c.consultation_id],
        )
      ).rows.map((x) => `${x.map_point_id}:${x.version}`),
    );
    const fresh = nodes.filter((n) => !seen.has(`${n.id}:${n.version}`));
    const people = (await db.query(`SELECT id, source_ref FROM participants WHERE consultation_id = $1 AND via = 'simulation' ORDER BY source_ref`, [c.consultation_id])).rows;
    let votes = 0;
    for (const p of people) {
      const camp = await campOf(p);
      const r = rng(hash(`${p.source_ref}`));
      const share = 0.6 + 0.4 * r();
      const mine = new Set(
        (await db.query(`SELECT map_point_id, version FROM map_point_votes WHERE participant_id = $1`, [p.id])).rows.map((x) => `${x.map_point_id}:${x.version}`),
      );
      for (const n of fresh) {
        if (mine.has(`${n.id}:${n.version}`)) continue;
        const rn = rng(hash(`${p.source_ref}|${n.id}`));
        if (rn() > share) continue;
        const pa = lean(n)[camp]!;
        const x = rn();
        const value = x < pa ? 1 : x < pa + (1 - pa) * 0.22 ? 0 : -1;
        await db.query(
          `INSERT INTO map_point_votes (tenant_id, participant_id, map_point_id, version, value, method) VALUES ($1, $2, $3, $4, $5, 'simulation')
           ON CONFLICT DO NOTHING`,
          [c.tenant_id, p.id, n.id, n.version, value],
        );
        votes++;
      }
    }
    console.log(`top-up: ${votes} votes on ${fresh.length} new statements from ${people.length} simulated participants`);
    await db.query("COMMIT");
    process.exit(0);
  }
  if (own.length && !remove) throw new Error(`simulated participants have sent ${own.length} own points — use --top-up, or --remove first`);
  if (own.length) {
    // Their own points and what grew from them: moves, the door-2 checks, the machine's jobs.
    await db.query(`DELETE FROM moves WHERE submission_id = ANY($1::uuid[])`, [own]);
    await db.query(`DELETE FROM judgments WHERE subject_kind = 'submission' AND subject_id = ANY($1::text[])`, [own]);
    await db.query(`DELETE FROM extractions WHERE submission_id = ANY($1::uuid[])`, [own]);
    await db.query(`DELETE FROM submissions WHERE id = ANY($1::uuid[])`, [own]);
    console.log(`removed ${own.length} own points of simulated participants (released points they brought stay, without these sources)`);
  }
  await db.query(`DELETE FROM map_point_votes WHERE participant_id IN (${sims})`, [c.consultation_id]);
  await db.query(`DELETE FROM participants WHERE consultation_id = $1 AND via = 'simulation'`, [c.consultation_id]);
  if (!remove) {
    const nodes = (
      await db.query(
        `SELECT id, rolle, typ, richtung, version, text FROM map_points WHERE consultation_id = $1 AND rolle IS NOT NULL AND status = 'released' ORDER BY ord`,
        [c.consultation_id],
      )
    ).rows;
    const r = rng(2026);
    let votes = 0;
    for (let i = 0; i < N; i++) {
      const camp = r() < 0.58 ? 0 : 1;
      const p = await db.query(
        `INSERT INTO participants (tenant_id, consultation_id, source_ref, author_type, language, via)
         VALUES ($1, $2, $3, 'simulation', 'de', 'simulation') RETURNING id`,
        [c.tenant_id, c.consultation_id, `simulation:${String(i).padStart(3, "0")}:${camp === 0 ? "A" : "B"}`],
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
    console.log(`${N} simulated participants, ${votes} votes on ${nodes.length} statements`);
  } else console.log("simulated participants removed");
  await db.query("COMMIT");
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
