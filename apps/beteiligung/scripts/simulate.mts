/**
 * Simulated voters for the FICTIONAL demo only (campaigns.fictional): two
 * camps roughly like Stephan's results page ("Klima zuerst" 58 %, "Kosten &
 * Freiheit" 42 %), so the camp math, the live picture and the results page
 * can be tested before real people vote. Every simulated participant has
 * via = 'simulation' and every vote method = 'simulation'; the workspace
 * says so. Deterministic (seeded).
 *
 * Usage (from apps/beteiligung):
 *   set -a && source .env.local && set +a && tsx scripts/simulate.mts [--participants 300] [--remove]
 */
import pg from "pg";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("participants") ?? 300);
const remove = process.argv.includes("--remove");

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
  if (n.typ === "verfahren") return n.richtung === "greift_an" ? [0.62, 0.8] : [0.8, 0.77];
  if (n.richtung === "greift_an") {
    if (/Handwerk|Fachkr|Personal|Betriebe|Wartezeit/i.test(n.text)) return [0.8, 0.79];
    if (/Denkmal|eigenen Dächer|Wartung/i.test(n.text)) return [0.14, 0.3];
    return [0.26, 0.7];
  }
  if (n.rolle === "praemisse" && /Mehrkosten|Eingriff/i.test(n.text)) return [0.8, 0.4];
  return [0.86, 0.72];
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
  await db.query(
    `DELETE FROM map_point_votes WHERE participant_id IN (SELECT id FROM participants WHERE consultation_id = $1 AND via = 'simulation')`,
    [c.consultation_id],
  );
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
        [c.tenant_id, c.consultation_id, `simulation:${i}`],
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
