/**
 * The demo campaign: Stephan's fictional "Solarpflicht für Neubauten" in
 * Musterstadt (his results page and Teilnehmeransicht), marked fictional
 * everywhere. Idempotent: updates the campaign if it exists.
 *
 * Usage (from apps/beteiligung):
 *   DATABASE_URL=… tsx scripts/seed-demo.mts [--member <email>]
 *     --member  make an existing staff account an initiator of Musterstadt
 */
import pg from "pg";

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
  await db.query("COMMIT");
  console.log(`demo campaign ${TENANT.slug}/${CAMPAIGN.slug} → ${campaignId}${member ? ` · ${member} is initiator` : ""}`);
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
