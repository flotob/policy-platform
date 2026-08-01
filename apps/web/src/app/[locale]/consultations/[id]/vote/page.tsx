import { createHash } from "node:crypto";

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
  const tMapView = await getTranslations("MapView");
  const db = getDb();
  const slotLabel = (slot: string | null) =>
    slot === "P1" ? tMapView("slotP1")
    : slot === "P2" ? tMapView("slotP2")
    : slot === "P3" ? tMapView("slotP3")
    : slot === "P4" ? tMapView("slotP4")
    : slot === "conclusion" ? tMapView("slotConclusion")
    : null;

  const consRes = await db.execute(
    sql`SELECT id, title FROM consultations WHERE id::text = ${id}`,
  );
  if (consRes.rows.length === 0) notFound();
  const consultation = consRes.rows[0] as { id: string; title: string };

  // One votable statement per point: the canonical row (lowest locale) carries
  // the votes; display prefers the visitor's locale when a version exists.
  const stRes = await db.execute(sql`
    SELECT canonical.id, p.kind, p.slot, p.label, p.summary, p.theme,
      COALESCE(loc.text, canonical.text) AS text,
      (SELECT json_agg(json_build_object('quote', ps.quote, 'org', s.author_org))
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id) AS sources
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
    slot: string | null;
    label: string;
    summary: string | null;
    theme: string | null;
    text: string;
    sources: { quote: string | null; org: string | null }[] | null;
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

  // Per-participant deterministic shuffle: everyone sees a different order,
  // so early statements don't accumulate all the votes; reloads keep the
  // order stable for the same participant.
  const seed = token ?? "anonymous";
  const shuffled = [...deck].sort((a, b) => {
    const ha = createHash("sha256").update(seed + a.id).digest("hex");
    const hb = createHash("sha256").update(seed + b.id).digest("hex");
    return ha < hb ? -1 : 1;
  });
  const current = shuffled.find((s) => !myVotes.has(s.id));
  const done = deck.length - deck.filter((s) => !myVotes.has(s.id)).length;
  const voted = shuffled.filter((s) => myVotes.has(s.id));
  const voteGlyph = (v: number) => (v === 1 ? "✓" : v === -1 ? "✗" : "–");

  return (
    <main className="page">
      <h1>{t("title")}: {consultation.title}</h1>
      <p className="vote-intro">{t("intro")} {t("stopAnytime")}</p>
      <div className="vote-progress">
        <span>{t("progress", { done, total: deck.length })}</span>
        <span className="vote-progressbar">
          <i style={{ width: `${Math.round((done / deck.length) * 100)}%` }} />
        </span>
      </div>

      {current ? (
        <div className={`vote-card vote-card--${current.kind}`}>
          <span className={`badge badge--${current.kind}`}>{current.kind}</span>
          {current.theme && <span className="vote-card__theme">{current.theme}</span>}
          <p className="vote-card__text">{current.text}</p>
          <details className="vote-context">
            <summary>{t("moreContext")}</summary>
            <div className="vote-context__body">
              {slotLabel(current.slot) && (
                <p className="vote-context__slot">
                  {t("contextSlot")}: <strong>{slotLabel(current.slot)}</strong>
                </p>
              )}
              {current.summary && current.summary !== current.text && (
                <p>{current.summary}</p>
              )}
              {(current.sources ?? [])
                .filter((s) => s.quote)
                .slice(0, 3)
                .map((s, i) => (
                  <blockquote key={i} className="quote">
                    „{s.quote}"{s.org && <cite>— {s.org}</cite>}
                  </blockquote>
                ))}
              {(current.sources?.length ?? 0) > 3 && (
                <p className="vote-context__more">
                  {t("contextSources", { n: current.sources!.length })}
                </p>
              )}
            </div>
          </details>
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
