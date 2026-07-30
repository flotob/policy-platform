import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";
import { reviewPoint } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const db = getDb();
  const consRes = await db.execute(
    sql`SELECT id, title FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as { id: string; title: string };

  const drafts = await db.execute(sql`
    SELECT p.id, p.kind, p.slot, p.label, p.summary,
      (SELECT json_agg(json_build_object('quote', ps.quote, 'org', s.author_org))
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id) AS sources
    FROM points p
    WHERE p.consultation_id = ${consultation.id} AND p.status = 'draft'
    ORDER BY p.kind, p.created_at
  `);
  const released = await db.execute(sql`
    SELECT count(*)::int AS n FROM points
    WHERE consultation_id = ${consultation.id} AND status = 'released'
  `);

  const rows = drafts.rows as {
    id: string; kind: string; slot: string | null; label: string;
    summary: string | null;
    sources: { quote: string | null; org: string | null }[] | null;
  }[];

  return (
    <main className="page">
      <h1>Redaktion: {consultation.title}</h1>
      <div className="stat-strip">
        <span><strong>{rows.length}</strong> Entwürfe zu prüfen</span>
        <span><strong>{(released.rows[0] as { n: number }).n}</strong> freigegeben</span>
      </div>
      {rows.map((p) => (
        <details key={p.id} className={`chip chip--${p.kind}`}>
          <summary>
            <span className="chip__label">{p.label}</span>
            <span className={`badge badge--${p.kind}`}>{p.kind}</span>
            {p.slot && <span className="badge badge--design">{p.slot}</span>}
          </summary>
          <div className="chip__detail">
            {p.summary && <p>{p.summary}</p>}
            {(p.sources ?? []).slice(0, 2).map((s, i) =>
              s.quote ? (
                <blockquote key={i} className="quote">
                  „{s.quote}"{s.org && <cite>— {s.org}</cite>}
                </blockquote>
              ) : null,
            )}
            <form action={reviewPoint} style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
              <input type="hidden" name="pointId" value={p.id} />
              <button className="button" name="decision" value="released" type="submit">
                Freigeben
              </button>
              <button
                className="button"
                name="decision"
                value="rejected"
                type="submit"
                style={{ background: "var(--coral)" }}
              >
                Ablehnen
              </button>
              <input
                name="reason"
                placeholder="Begründung (öffentlich)"
                style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.6rem" }}
              />
            </form>
          </div>
        </details>
      ))}
    </main>
  );
}
