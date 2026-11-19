/**
 * News by e-mail, voluntary (Stephan, paper v10: "Wer beim Abstimmen eine E-Mail-Adresse
 * hinterlegt hat, bekommt diese Nachricht"). Two messages at most: when the result is out, and
 * when the council has decided — with what became of the person's own points.
 *
 * The address is confirmed by a link first (nobody can sign up a stranger), every mail carries a
 * one-click unsubscribe, and the address is stored apart from the votes: only with the tracking-
 * slip links of the points the person sent, so the message can point to them.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "@policy/db";

import { publishedBundle } from "./bericht";
import { decisionDate, outcomeSentence, type Outcome } from "./beschluss-words";
import { getDecision } from "./beschluss";
import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { townShort } from "./ergebnis-seite";
import { appUrl, sendMail } from "./mail";

type Row = Record<string, unknown>;
type Public = Campaign & { tenant: { name: string; slug: string } };

const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];
export const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;
/** New addresses per connection and hour, per campaign. */
const PER_ORIGIN_HOUR = 5;

function sign(id: string, purpose: "bestaetigen" | "abmelden"): string {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`folgen|${purpose}|${id}`).digest("base64url").slice(0, 32);
}

export function checkSignature(id: string, purpose: "bestaetigen" | "abmelden", token: string): boolean {
  const want = Buffer.from(sign(id, purpose));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

const link = (id: string, purpose: "bestaetigen" | "abmelden") => appUrl(`/nachricht?id=${id}&a=${purpose}&t=${sign(id, purpose)}`);

async function townOf(tenantId: string): Promise<{ name: string; slug: string }> {
  const [t] = await rows(sql`SELECT name, slug FROM tenants WHERE id = ${tenantId}`);
  return { name: (t?.name as string) ?? "", slug: (t?.slug as string) ?? "" };
}

export type FollowResult = { ok: true; already: boolean } | { ok: false; error: string };

/** Signs up an address for this campaign (or adds tracking slips to it) and sends the confirmation link. */
export async function follow(c: Public, raw: string, laufzettel: string[], origin: string): Promise<FollowResult> {
  const email = raw.trim().toLowerCase();
  if (email.length > 200 || !EMAIL.test(email)) return { ok: false, error: "Diese E-Mail-Adresse sieht nicht vollständig aus." };
  const [recent] = await rows(sql`
    SELECT count(*)::int AS n FROM campaign_followers WHERE campaign_id = ${c.id} AND origin_hash = ${origin} AND created_at > now() - interval '1 hour'`);
  if (Number(recent?.n ?? 0) >= PER_ORIGIN_HOUR) return { ok: false, error: "Von diesem Anschluss kamen gerade viele Adressen. Bitte versuch es später noch einmal." };
  const [f] = await rows(sql`
    INSERT INTO campaign_followers (tenant_id, campaign_id, email, laufzettel, origin_hash)
    VALUES (${c.tenantId}, ${c.id}, ${email}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(laufzettel)}::jsonb)), ${origin})
    ON CONFLICT (campaign_id, email) DO UPDATE SET
      laufzettel = ARRAY(SELECT DISTINCT unnest(campaign_followers.laufzettel || EXCLUDED.laufzettel)),
      -- Unsubscribed and back: confirm again.
      confirmed_at = CASE WHEN campaign_followers.unsubscribed_at IS NULL THEN campaign_followers.confirmed_at END,
      unsubscribed_at = NULL
    RETURNING id, confirmed_at, confirm_sent_at`);
  if (!f) return { ok: false, error: "Das hat nicht geklappt. Bitte versuch es noch einmal." };
  if (f.confirmed_at) return { ok: true, already: true };
  // One confirmation mail per ten minutes is enough, however often the form is sent.
  if (f.confirm_sent_at && Date.now() - new Date(String(f.confirm_sent_at)).getTime() < 10 * 60 * 1000) return { ok: true, already: false };
  const town = c.tenant.name;
  const sent = await sendMail({
    to: email,
    subject: `Bitte bestätigen: Nachricht zu „${c.title}“`,
    text: `Hallo,

du hast auf streit.bar gebeten, Nachricht zu bekommen, wie es mit der Beteiligung „${c.question}“ (${townShort(town)}) weitergeht: wenn das Ergebnis da ist und wenn der Gemeinderat entschieden hat.

Bitte bestätige das mit diesem Link:
${link(f.id as string, "bestaetigen")}

Warst du das nicht, dann ignoriere diese E-Mail. Ohne Bestätigung schreiben wir dir nie wieder und löschen die Adresse nach sieben Tagen.

streit.bar`,
  });
  if (sent.ok) await getDb().execute(sql`UPDATE campaign_followers SET confirm_sent_at = now() WHERE id = ${f.id as string}`);
  else if (sent.reason !== "not_configured") return { ok: false, error: "Die Bestätigungs-E-Mail ließ sich gerade nicht senden. Bitte versuch es später noch einmal." };
  return { ok: true, already: false };
}

export interface FollowerView {
  id: string;
  campaign: { title: string; question: string; url: string };
  confirmed: boolean;
  unsubscribed: boolean;
}

export async function followerById(id: string): Promise<FollowerView | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [f] = await rows(sql`
    SELECT f.id, f.confirmed_at, f.unsubscribed_at, c.title, c.question, c.slug, t.slug AS town
    FROM campaign_followers f JOIN campaigns c ON c.id = f.campaign_id JOIN tenants t ON t.id = c.tenant_id WHERE f.id = ${id}`);
  if (!f) return null;
  return {
    id: f.id as string,
    campaign: { title: f.title as string, question: f.question as string, url: `/${f.town as string}/${f.slug as string}` },
    confirmed: !!f.confirmed_at,
    unsubscribed: !!f.unsubscribed_at,
  };
}

/** The link in the confirmation mail. What already happened is not sent again: the page links to it. */
export async function confirmFollower(id: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE campaign_followers f SET confirmed_at = COALESCE(f.confirmed_at, now()),
      ergebnis_sent_at = COALESCE(f.ergebnis_sent_at, CASE WHEN c.state = 'veroeffentlicht' THEN now() END),
      beschluss_sent_at = COALESCE(f.beschluss_sent_at,
        CASE WHEN EXISTS (SELECT 1 FROM campaign_decisions d WHERE d.campaign_id = c.id AND d.state = 'veroeffentlicht') THEN now() END)
    FROM campaigns c WHERE c.id = f.campaign_id AND f.id = ${id} AND f.unsubscribed_at IS NULL`);
}

/** One click, no questions. The address itself goes too: there is nothing left to send it. */
export async function unsubscribe(id: string): Promise<void> {
  await getDb().execute(sql`UPDATE campaign_followers SET unsubscribed_at = now(), email = 'abgemeldet:' || id::text, laufzettel = '{}' WHERE id = ${id}`);
}

/** An address nobody confirmed within seven days goes (the worker runs this every hour). */
export async function forgetUnconfirmed(): Promise<number> {
  const r = await getDb().execute(sql`
    DELETE FROM campaign_followers WHERE confirmed_at IS NULL AND created_at < now() - interval '7 days' RETURNING id`);
  return r.rows.length;
}

/** The confirmed followers of a campaign — the workspace shows the number. */
export async function countFollowers(campaignId: string): Promise<number> {
  const [r] = await rows(sql`
    SELECT count(*)::int AS n FROM campaign_followers WHERE campaign_id = ${campaignId} AND confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`);
  return Number(r?.n ?? 0);
}

/** The person's own points behind their tracking slips, with the council's decision on each. */
async function ownPoints(campaignId: string, tokens: string[], nrOf: Map<string, number>) {
  if (!tokens.length) return [];
  const r = await rows(sql`
    SELECT DISTINCT ON (p.id) s.tracking_token, p.id, p.ord, p.text, d.outcome, d.reason
    FROM submissions s JOIN moves m ON m.submission_id = s.id AND m.state = 'verknuepft'
    JOIN map_points p ON p.id = m.map_point_id AND p.status = 'released'
    LEFT JOIN point_decisions d ON d.campaign_id = ${campaignId} AND d.map_point_id = p.id
    WHERE s.tracking_token IN (SELECT jsonb_array_elements_text(${JSON.stringify(tokens)}::jsonb)) ORDER BY p.id, s.created_at`);
  return r.map((x) => ({
    token: x.tracking_token as string,
    ord: nrOf.get(x.id as string) ?? Number(x.ord),
    text: x.text as string,
    decision: x.outcome ? { outcome: x.outcome as Outcome, reason: (x.reason as string | null) ?? null } : null,
  }));
}

const sending = new Set<string>();

/**
 * Sends one of the two messages to everyone who confirmed and has not had it yet. Runs in the
 * background, one mail after the other (Resend allows two a second); each is marked when sent, so
 * a restart picks up where it stopped. Returns how many are due.
 */
export async function notifyFollowers(c: Campaign, kind: "ergebnis" | "beschluss"): Promise<number> {
  const column = kind === "ergebnis" ? sql.raw("ergebnis_sent_at") : sql.raw("beschluss_sent_at");
  const due = await rows(sql`
    SELECT id, email, laufzettel FROM campaign_followers
    WHERE campaign_id = ${c.id} AND confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND ${column} IS NULL`);
  const key = `${c.id}:${kind}`;
  if (!due.length || sending.has(key)) return due.length;
  sending.add(key);
  void (async () => {
    try {
      const town = await townOf(c.tenantId);
      const base = appUrl(`/${town.slug}/${c.slug}`);
      const decision = kind === "beschluss" ? await getDecision(c.id) : null;
      const bundle = await publishedBundle(c);
      if (!bundle) return;
      const nrOf = new Map(bundle.result.statements.map((s) => [s.id, s.nr]));
      if (kind === "beschluss" && decision?.state !== "veroeffentlicht") return;
      for (const f of due) {
        const tokens = (f.laufzettel as string[] | null) ?? [];
        const own = await ownPoints(c.id, tokens, nrOf);
        const slips = [...new Set(own.map((p) => p.token))];
        let subject: string;
        let body: string;
        if (kind === "ergebnis") {
          subject = `Das Ergebnis ist da: ${c.title}`;
          body = `Hallo,

die Beteiligung „${c.question}“ in ${townShort(town.name)} ist ausgewertet. Worüber gestritten wird, wo sich alle einig sind und was der Gemeinderat entscheiden muss, steht hier:
${base}/ergebnis

Der ganze Bericht:
${base}/bericht
${slips.length ? `\nWas aus ${slips.length === 1 && own.length === 1 ? "deinem Punkt" : "deinen Punkten"} geworden ist, zeigt dein Laufzettel:\n${slips.map((t) => `${base}/laufzettel/${t}`).join("\n")}\n` : ""}
Sobald der Gemeinderat entschieden hat, schreiben wir dir noch einmal.`;
        } else {
          const d = decision!;
          const when = decisionDate(d.datum);
          subject = `Der ${d.gremium} hat entschieden: ${c.title}`;
          const mine = own.map((p) =>
            p.decision
              ? `Dein Punkt „${p.text}“ (Aussage ${p.ord}) lag dem ${d.gremium}${when ? ` am ${when}` : ""} vor. ${outcomeSentence(p.decision)}`
              : `Zu deinem Punkt „${p.text}“ (Aussage ${p.ord}) hat die Verwaltung nichts Eigenes vermerkt.`,
          );
          body = `Hallo,

der ${d.gremium} von ${townShort(town.name)} hat${when ? ` am ${when}` : ""} über „${c.title}“ entschieden.${d.summary ? `\n\n${d.summary}` : ""}
${mine.length ? `\n${mine.join("\n\n")}\n` : ""}
Jede Aussage der Beteiligung mit dem, was aus ihr geworden ist:
${base}/ergebnis
${slips.length ? `\nDein Laufzettel:\n${slips.map((t) => `${base}/laufzettel/${t}`).join("\n")}\n` : ""}
Das war unsere letzte Nachricht zu diesem Verfahren.`;
        }
        const res = await sendMail({
          to: f.email as string,
          subject,
          text: `${body}

Keine Nachrichten mehr: ${link(f.id as string, "abmelden")}

streit.bar`,
        });
        if (res.ok) await getDb().execute(sql`UPDATE campaign_followers SET ${column} = now() WHERE id = ${f.id as string}`);
        else console.error(`[folgen] ${kind} to follower ${f.id as string} failed: ${res.reason}`);
        await new Promise((r) => setTimeout(r, 600));
      }
    } catch (e) {
      console.error(`[folgen] sending ${kind} for campaign ${c.id} failed:`, e);
    } finally {
      sending.delete(key);
    }
  })();
  return due.length;
}
