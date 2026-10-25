import { sql } from "@policy/db";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { getDb } from "@/lib/db";
import { STATES, type CampaignState } from "@/lib/params";
import { RESERVED } from "@/lib/slug";

import "./public.css";

/** A municipality's public page: its campaigns that are no longer drafts. */
export default async function Gemeinde({ params }: { params: Promise<{ gemeinde: string }> }) {
  const { gemeinde } = await params;
  if (RESERVED.has(gemeinde)) notFound();
  const db = getDb();
  const t = (await db.execute(sql`SELECT id, name, slug FROM tenants WHERE slug = ${gemeinde}`)).rows[0] as { id: string; name: string; slug: string } | undefined;
  if (!t) notFound();
  const campaigns = (
    await db.execute(sql`
      SELECT slug, title, question, state FROM campaigns WHERE tenant_id = ${t.id} AND state <> 'entwurf' ORDER BY updated_at DESC`)
  ).rows as { slug: string; title: string; question: string; state: CampaignState }[];
  return (
    <PublicFrame town={t}>
      <main className="wrap pub-main pub-town-page">
        <h1>{t.name}</h1>
        <p className="pub-lead">Beteiligungen, zu denen die Stadt einlädt.</p>
        {campaigns.length ? (
          <ul className="pub-list">
            {campaigns.map((c) => (
              <li key={c.slug}>
                <Link href={`/${gemeinde}/${c.slug}`}>{c.question}</Link>
                <span className="small muted">{STATES[c.state].label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Gerade läuft keine Beteiligung.</p>
        )}
      </main>
    </PublicFrame>
  );
}
