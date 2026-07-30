import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";
import { castVote } from "./actions";
import { PARTICIPANT_COOKIE } from "./participant";

export const dynamic = "force-dynamic";

export default async function VotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Vote");
  const db = getDb();

  const consRes = await db.execute(
    sql`SELECT id, title FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as { id: string; title: string };

  // One votable statement per point: the canonical row (lowest locale) carries
  // the votes; display prefers the visitor's locale when a version exists.
  const stRes = await db.execute(sql`
    SELECT canonical.id, p.kind, p.label,
      COALESCE(loc.text, canonical.text) AS text
    FROM (
      SELECT DISTINCT ON (st.point_id) st.id, st.point_id, st.text, st.created_at
      FROM statements st JOIN points p ON p.id = st.point_id
      WHERE p.consultation_id = ${consultation.id} AND st.status = 'released'
      ORDER BY st.point_id, st.locale
    ) canonical
    JOIN points p ON p.id = canonical.point_id
    LEFT JOIN statements loc ON loc.point_id = canonical.point_id
      AND loc.locale = ${locale} AND loc.status = 'released'
    ORDER BY canonical.created_at, canonical.id
  `);
  const deck = stRes.rows as {
    id: string;
    kind: string;
    label: string;
    text: string;
  }[];
  if (deck.length === 0) notFound();

  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value;
  const myVotes = new Map<string, number>();
  if (token) {
    const vRes = await db.execute(sql`
      SELECT v.statement_id, v.value
      FROM votes v JOIN participants pa ON pa.id = v.participant_id
      WHERE pa.consultation_id = ${consultation.id}
        AND pa.source_ref = ${`web:${token}`}
    `);
    for (const row of vRes.rows as { statement_id: string; value: number }[]) {
      myVotes.set(row.statement_id, row.value);
    }
  }

  const current = deck.find((s) => !myVotes.has(s.id));
  const done = deck.length - deck.filter((s) => !myVotes.has(s.id)).length;
  const voted = deck.filter((s) => myVotes.has(s.id));
  const voteGlyph = (v: number) => (v === 1 ? "✓" : v === -1 ? "✗" : "–");

  return (
    <main className="page">
      <h1>{t("title")}: {consultation.title}</h1>
      <p className="vote-intro">{t("intro")}</p>
      <div className="vote-progress">
        <span>{t("progress", { done, total: deck.length })}</span>
        <span className="vote-progressbar">
          <i style={{ width: `${Math.round((done / deck.length) * 100)}%` }} />
        </span>
      </div>

      {current ? (
        <div className={`vote-card vote-card--${current.kind}`}>
          <span className={`badge badge--${current.kind}`}>{current.kind}</span>
          <p className="vote-card__text">{current.text}</p>
          <form action={castVote} className="vote-actions">
            <input type="hidden" name="statementId" value={current.id} />
            <button className="button vote-button vote-button--agree" name="value" value="1" type="submit">
              ✓ {t("agree")}
            </button>
            <button className="button vote-button vote-button--pass" name="value" value="0" type="submit">
              – {t("pass")}
            </button>
            <button className="button vote-button vote-button--disagree" name="value" value="-1" type="submit">
              ✗ {t("disagree")}
            </button>
          </form>
        </div>
      ) : (
        <div className="vote-card vote-card--done">
          <p className="vote-card__text">{t("done")}</p>
          <Link className="button" href={`/${locale}/consultations/${consultation.id}`}>
            {t("backToMap")}
          </Link>
        </div>
      )}

      {voted.length > 0 && (
        <section className="map-section map-section--open">
          <h2>{t("yourVotes")} ({voted.length})</h2>
          {voted.map((s) => (
            <div key={s.id} className="chip chip--open vote-done-row">
              <span className={`vote-mark vote-mark--${myVotes.get(s.id)}`}>
                {voteGlyph(myVotes.get(s.id)!)}
              </span>
              <span className="chip__label">{s.text}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
