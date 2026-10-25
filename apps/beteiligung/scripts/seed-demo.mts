/**
 * The demo campaign: Stephan's fictional "Solarpflicht für Neubauten" in
 * Musterstadt (his results page and Teilnehmeransicht), marked fictional
 * everywhere. Idempotent: updates the campaign if it exists.
 *
 * Usage (from apps/beteiligung):
 *   DATABASE_URL=… tsx scripts/seed-demo.mts [--member <email>] [--statements] [--reset-analysis]
 *     --member          make an existing staff account an initiator of Musterstadt
 *     --statements      upload the seven fictional statements in demo/stellungnahmen
 *                       and queue the machine's work (skeleton + one decomposition each)
 *     --reset-analysis  forget everything the machine and the editors did on the demo
 *                       (nodes, moves, jobs, texts) — the uploads stay
 *     --keep-texts      with --reset-analysis: keep the extracted texts and the cached
 *                       model outputs, so the rerun costs one skeleton call and the Jev judgments
 *   The reset also removes everything citizens did (votes, own points, uploads, invitation
 *   codes, simulated voters). Afterwards, once the machine is done: tsx scripts/open-demo.mts
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/** Fictional senders of the demo statements (file name prefix → sender, kind). */
const SENDERS: Record<string, [string, string]> = {
  "01": ["Stadtwerke Musterstadt GmbH", "unternehmen"],
  "02": ["Handwerkskammer Musterstadt-Land", "verband"],
  "03": ["Haus & Grund Musterstadt e. V.", "verband"],
  "04": ["Umweltverband Musterstadt e. V.", "verband"],
  "05": ["Mieterverein Musterstadt", "verband"],
  "06": ["Bürgerin aus der Weststadt", "privat"],
  "07": ["Bürger aus der Altstadt", "privat"],
};
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const TENANT = { slug: "musterstadt", name: "Stadt Musterstadt" };
const CAMPAIGN = {
  slug: "solarpflicht",
  title: "Solarpflicht für Neubauten",
  question: "Soll Musterstadt für Neubauten eine Solarpflicht einführen?",
  measure: "Die Stadt Musterstadt verpflichtet Bauherren, auf jedem Neubau eine Solaranlage zu errichten.",
  summary:
    "Jedes Jahr entstehen in Musterstadt rund 900 Neubauten. Die Stadt will, dass auf jedem davon eine Solaranlage steht, und fragt vor dem Beschluss im Rat, was die Bürgerinnen und Bürger davon halten: wo sie zustimmen, wo sie widersprechen und was in der Begründung fehlt.",
  justification:
    "Musterstadt verfehlt sein Klimaziel 2035 deutlich. Eine Solarpflicht für Neubauten liefert in einem Baujahr mehr Solarleistung als vier Jahre Förderung, senkt die Betriebskosten der Gebäude und ist mit Übergangsfristen und einer Härtefallklausel umsetzbar. Die Mehrkosten von 1,5 bis 2 Prozent der Bausumme sind angesichts von dreißig Jahren eigenem Strom zumutbar.",
  steps: {
    lage: "Musterstadt verfehlt sein Klimaziel 2035 deutlich. Jedes Jahr entstehen rund 900 Neubauten, deren Dächer ungenutzt bleiben. Die Netze haben Reserven, die Mehrkosten liegen bei 1,5 bis 2 Prozent der Bausumme.",
    wirkung: "Eine Pflicht liefert in einem einzigen Baujahr mehr Solarleistung als vier Jahre Förderung. Die Gebäude werden günstiger im Betrieb, die Stadt kommt ihrem Ziel messbar näher.",
    weg: "Die Pflicht ist umsetzbar: Das Handwerk kann planen, Härtefälle regelt die Satzung, Übergangsfristen geben Zeit. Freiwilligkeit und Ausschreibungen hatten zwanzig Jahre und haben nicht gereicht.",
    eingriff: "Zwei Prozent Mehrkosten für dreißig Jahre eigenen Strom sind Bauherren zumutbar. Der Eingriff ins Eigentum ist begrenzt, bezifferbar und durch das Gemeinwohlziel gerechtfertigt.",
  },
  params: {
    doors: { abstimmen: true, kurzaussage: true, stellungnahme: true },
    start: "2026-11-16",
    end: "2026-12-18",
    saturationWindow: 100,
    matchThreshold: 0.8,
    sampleRate: 0.1,
    bridgeThreshold: 0.6,
    minParticipants: 50,
    editorialMode: "mensch",
    access: "offen",
  },
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const memberIdx = process.argv.indexOf("--member");
const member = memberIdx > 0 ? process.argv[memberIdx + 1] : undefined;
const withStatements = process.argv.includes("--statements");
const resetAnalysis = process.argv.includes("--reset-analysis");
const keepTexts = process.argv.includes("--keep-texts");

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("BEGIN");
  const t = await db.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`,
    [TENANT.slug, TENANT.name],
  );
  const tenantId = t.rows[0].id as string;
  const existing = await db.query(`SELECT id, consultation_id FROM campaigns WHERE tenant_id = $1 AND slug = $2`, [tenantId, CAMPAIGN.slug]);
  let campaignId: string;
  if (existing.rows[0]) {
    campaignId = existing.rows[0].id;
    await db.query(
      `UPDATE campaigns SET title=$2, question=$3, measure=$4, summary=$5, justification=$6, steps=$7, params=$8, fictional=true, updated_at=now() WHERE id=$1`,
      [campaignId, CAMPAIGN.title, CAMPAIGN.question, CAMPAIGN.measure, CAMPAIGN.summary, CAMPAIGN.justification, JSON.stringify(CAMPAIGN.steps), JSON.stringify(CAMPAIGN.params)],
    );
  } else {
    const c = await db.query(
      `INSERT INTO consultations (tenant_id, title, status, source_system, source_ref) VALUES ($1, $2, 'draft', 'beteiligung', $3) RETURNING id`,
      [tenantId, CAMPAIGN.title, `${TENANT.slug}/${CAMPAIGN.slug}`],
    );
    const r = await db.query(
      `INSERT INTO campaigns (tenant_id, consultation_id, slug, title, question, measure, summary, justification, steps, params, state, fictional)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'vorbereitung',true) RETURNING id`,
      [tenantId, c.rows[0].id, CAMPAIGN.slug, CAMPAIGN.title, CAMPAIGN.question, CAMPAIGN.measure, CAMPAIGN.summary, CAMPAIGN.justification, JSON.stringify(CAMPAIGN.steps), JSON.stringify(CAMPAIGN.params)],
    );
    campaignId = r.rows[0].id;
  }
  if (member) {
    const u = await db.query(`SELECT id FROM auth_user WHERE email = $1`, [member]);
    if (!u.rows[0]) throw new Error(`no account with ${member} — register first`);
    await db.query(
      `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'initiator') ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'initiator'`,
      [u.rows[0].id, tenantId],
    );
  }
  const consultationId = (await db.query(`SELECT consultation_id FROM campaigns WHERE id = $1`, [campaignId])).rows[0].consultation_id as string;
  if (resetAnalysis) {
    // Only the fictional demo is ever reset (campaigns.fictional) — FK order: votes, judgments, moves, nodes,
    // what citizens sent (door 2/3) and who they were, the town's texts.
    await db.query(`DELETE FROM map_point_votes WHERE map_point_id IN (SELECT id FROM map_points WHERE consultation_id = $1)`, [consultationId]);
    await db.query(`DELETE FROM judgments WHERE consultation_id = $1`, [consultationId]);
    await db.query(`DELETE FROM moves WHERE consultation_id = $1`, [consultationId]);
    await db.query(`DELETE FROM campaign_invites WHERE campaign_id = $1`, [campaignId]);
    await db.query(`DELETE FROM campaign_jobs WHERE campaign_id = $1`, [campaignId]);
    const uploads = await db.query(`DELETE FROM campaign_files WHERE campaign_id = $1 AND participant_id IS NOT NULL RETURNING submission_id`, [campaignId]);
    const fromDoors = await db.query(
      `SELECT id FROM submissions WHERE consultation_id = $1 AND (door = 'statement' OR id = ANY($2::uuid[]))`,
      [consultationId, uploads.rows.map((r) => r.submission_id).filter(Boolean)],
    );
    const ids = fromDoors.rows.map((r) => r.id);
    await db.query(`DELETE FROM extractions WHERE submission_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM submissions WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(`UPDATE submissions SET participant_id = NULL WHERE consultation_id = $1`, [consultationId]);
    await db.query(`DELETE FROM participants WHERE consultation_id = $1`, [consultationId]);
    await db.query(`UPDATE map_points SET merged_into = NULL WHERE consultation_id = $1`, [consultationId]);
    await db.query(`DELETE FROM map_points WHERE consultation_id = $1`, [consultationId]);
    await db.query(`DELETE FROM campaign_jobs WHERE campaign_id = $1`, [campaignId]);
    if (!keepTexts) {
      await db.query(`UPDATE campaign_files SET submission_id = NULL WHERE campaign_id = $1`, [campaignId]);
      await db.query(`DELETE FROM extractions WHERE consultation_id = $1`, [consultationId]);
      await db.query(`DELETE FROM submissions WHERE consultation_id = $1`, [consultationId]);
    }
    await db.query(`UPDATE campaigns SET state = 'vorbereitung' WHERE id = $1 AND fictional`, [campaignId]);
  }
  let uploaded = 0;
  if (withStatements) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "stellungnahmen");
    for (const name of readdirSync(dir).sort()) {
      const [sender, kind] = SENDERS[name.slice(0, 2)] ?? [null, null];
      if (!sender) continue;
      const bytes = readFileSync(join(dir, name));
      const sha = createHash("sha256").update(bytes).digest("hex");
      const r = await db.query(
        `INSERT INTO campaign_files (tenant_id, campaign_id, role, filename, mime, size, sha256, content, sender, sender_type)
         VALUES ($1, $2, 'stellungnahme', $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (campaign_id, sha256) DO NOTHING RETURNING id`,
        [tenantId, campaignId, name, MIME[name.split(".").pop()!] ?? null, bytes.length, sha, bytes, sender, kind],
      );
      uploaded += r.rows.length;
    }
    // The machine's work, in order: the skeleton first, then every statement not yet read.
    await db.query(
      `INSERT INTO campaign_jobs (tenant_id, campaign_id, kind) SELECT $1, $2, 'skelett'
       WHERE NOT EXISTS (SELECT 1 FROM map_points WHERE consultation_id = $3 AND rolle = 'schluss' AND status IN ('draft', 'released'))
         AND NOT EXISTS (SELECT 1 FROM campaign_jobs WHERE campaign_id = $2 AND kind = 'skelett' AND state IN ('wartet', 'laeuft'))`,
      [tenantId, campaignId, consultationId],
    );
    await db.query(
      `INSERT INTO campaign_jobs (tenant_id, campaign_id, kind, file_id)
       SELECT $1, $2, 'zerlegen', f.id FROM campaign_files f
       WHERE f.campaign_id = $2 AND f.role = 'stellungnahme' AND (f.submission_id IS NULL OR $3)
         AND NOT EXISTS (SELECT 1 FROM campaign_jobs j WHERE j.file_id = f.id AND j.state IN ('wartet', 'laeuft'))
       ORDER BY f.filename`,
      [tenantId, campaignId, resetAnalysis],
    );
  }
  await db.query("COMMIT");
  console.log(
    `demo campaign ${TENANT.slug}/${CAMPAIGN.slug} → ${campaignId}${member ? ` · ${member} is initiator` : ""}` +
      `${resetAnalysis ? " · analysis reset" : ""}${withStatements ? ` · ${uploaded} statements uploaded, jobs queued` : ""}`,
  );
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
