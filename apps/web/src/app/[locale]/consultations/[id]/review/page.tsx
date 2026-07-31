import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { sql } from "@policy/db";

import { getDb } from "@/lib/db";
import { ConsultationTabs } from "../consultation-tabs";
import {
  releaseAllDraftPoints,
  releaseAllDraftStatements,
  reviewPoint,
  reviewStatements,
  saveFinding,
} from "./actions";

export const dynamic = "force-dynamic";

/** Compact "who decided" chip from the audit trail. */
function ActorChip({ actor }: { actor: string | null }) {
  if (!actor) return null;
  const isAi = actor.startsWith("ai-editor");
  return (
    <span className={`badge ${isAi ? "badge--fact" : "badge--design"}`}>
      {isAi ? "KI-Redaktion" : actor}
    </span>
  );
}

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

  const decisionJoin = sql`
    LEFT JOIN LATERAL (
      SELECT a.actor, a.reason FROM audit_log a
      WHERE a.subject_kind = 'point' AND a.subject_id = p.id::text
        AND a.action IN ('point.release', 'point.reject')
      ORDER BY a.id DESC LIMIT 1
    ) dec ON true`;

  const drafts = await db.execute(sql`
    SELECT p.id, p.kind, p.slot, p.label, p.summary,
      (SELECT json_agg(json_build_object('quote', ps.quote, 'org', s.author_org))
       FROM point_sources ps JOIN submissions s ON s.id = ps.submission_id
       WHERE ps.point_id = p.id) AS sources
    FROM points p
    WHERE p.consultation_id = ${consultation.id} AND p.status = 'draft'
    ORDER BY p.kind, p.created_at
  `);
  const draftStatements = await db.execute(sql`
    SELECT p.id AS point_id, p.label, p.kind,
      json_agg(json_build_object('locale', st.locale, 'text', st.text)
               ORDER BY st.locale) AS versions
    FROM statements st JOIN points p ON p.id = st.point_id
    WHERE p.consultation_id = ${consultation.id} AND st.status = 'draft'
    GROUP BY p.id, p.label, p.kind
    ORDER BY min(st.created_at)
  `);
  const released = await db.execute(sql`
    SELECT p.id, p.kind, p.label, p.finding, dec.actor,
      (SELECT json_agg(json_build_object('locale', st.locale, 'text', st.text)
               ORDER BY st.locale)
       FROM statements st WHERE st.point_id = p.id AND st.status = 'released') AS versions
    FROM points p ${decisionJoin}
    WHERE p.consultation_id = ${consultation.id} AND p.status = 'released'
      AND p.created_by <> 'import:questionnaire'
    ORDER BY p.finding IS NULL, p.created_at
  `);
  const rejected = await db.execute(sql`
    SELECT p.id, p.kind, p.label, dec.actor, dec.reason
    FROM points p ${decisionJoin}
    WHERE p.consultation_id = ${consultation.id} AND p.status = 'rejected'
    ORDER BY p.created_at
  `);

  const draftRows = drafts.rows as {
    id: string; kind: string; slot: string | null; label: string;
    summary: string | null;
    sources: { quote: string | null; org: string | null }[] | null;
  }[];
  const statementRows = draftStatements.rows as {
    point_id: string; label: string; kind: string;
    versions: { locale: string; text: string }[];
  }[];
  const releasedRows = released.rows as {
    id: string; kind: string; label: string; finding: string | null;
    actor: string | null;
    versions: { locale: string; text: string }[] | null;
  }[];
  const rejectedRows = rejected.rows as {
    id: string; kind: string; label: string; actor: string | null; reason: string | null;
  }[];
  const queueCount = draftRows.length + statementRows.length;

  const decisionButtons = (pointId: string, current: "draft" | "released" | "rejected") => (
    <form action={reviewPoint} style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
      <input type="hidden" name="pointId" value={pointId} />
      {current !== "released" && (
        <button className="button" name="decision" value="released" type="submit">
          Freigeben
        </button>
      )}
      {current !== "rejected" && (
        <button className="button" name="decision" value="rejected" type="submit"
          style={{ background: "var(--coral)" }}>
          Ablehnen
        </button>
      )}
      <input name="reason" placeholder="Begründung (öffentlich)"
        style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.6rem" }} />
    </form>
  );

  const queueTab = (
    <>
      {queueCount === 0 && (
        <p className="placeholder-note">Nichts zu prüfen — die Warteschlange ist leer.</p>
      )}
      {statementRows.length > 0 && (
        <section className="map-section map-section--bridge">
          <h2>Statements zur Abstimmung ({statementRows.length})</h2>
          <form action={releaseAllDraftStatements} style={{ marginBottom: "0.8rem" }}>
            <input type="hidden" name="consultationId" value={consultation.id} />
            <button className="button" type="submit">Alle Statements freigeben</button>
          </form>
          {statementRows.map((s) => (
            <details key={s.point_id} className={`chip chip--${s.kind}`}>
              <summary>
                <span className="chip__label">
                  {s.versions.find((v) => v.locale === "de")?.text ?? s.versions[0]?.text}
                </span>
                <span className={`badge badge--${s.kind}`}>{s.kind}</span>
              </summary>
              <div className="chip__detail">
                <p style={{ color: "var(--muted)" }}>Punkt: {s.label}</p>
                {s.versions.map((v) => (
                  <p key={v.locale}><strong>{v.locale}</strong> — {v.text}</p>
                ))}
                <form action={reviewStatements} style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
                  <input type="hidden" name="pointId" value={s.point_id} />
                  <button className="button" name="decision" value="released" type="submit">
                    Freigeben
                  </button>
                  <button className="button" name="decision" value="rejected" type="submit"
                    style={{ background: "var(--coral)" }}>
                    Ablehnen
                  </button>
                </form>
              </div>
            </details>
          ))}
        </section>
      )}
      {draftRows.length > 0 && (
        <section className="map-section map-section--open">
          <h2>Punkt-Entwürfe ({draftRows.length})</h2>
          <form action={releaseAllDraftPoints} style={{ margin: "0.8rem 0" }}>
            <input type="hidden" name="consultationId" value={consultation.id} />
            <button className="button" type="submit">
              Alle {draftRows.length} Entwürfe freigeben
            </button>
          </form>
          {draftRows.map((p) => (
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
                {decisionButtons(p.id, "draft")}
              </div>
            </details>
          ))}
        </section>
      )}
    </>
  );

  const releasedTab = (
    <section className="map-section">
      {releasedRows.map((p) => (
        <details key={p.id} className={`chip chip--${p.kind}`}>
          <summary>
            <span className="chip__label">{p.label}</span>
            {p.finding && <span className="badge badge--value">Befund</span>}
            <ActorChip actor={p.actor} />
            <span className={`badge badge--${p.kind}`}>{p.kind}</span>
          </summary>
          <div className="chip__detail">
            {(p.versions ?? []).map((v) => (
              <p key={v.locale}><strong>{v.locale}</strong> — {v.text}</p>
            ))}
            <form action={saveFinding} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input type="hidden" name="pointId" value={p.id} />
              <textarea name="finding" defaultValue={p.finding ?? ""} rows={2}
                placeholder="Redaktioneller Befund (öffentlich, erscheint auf der Karte)"
                style={{ font: "inherit", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem", background: "var(--paper)", color: "var(--ink)" }} />
              <button className="button" type="submit" style={{ alignSelf: "flex-start" }}>
                Befund speichern
              </button>
            </form>
            {decisionButtons(p.id, "released")}
          </div>
        </details>
      ))}
    </section>
  );

  const rejectedTab = (
    <section className="map-section">
      {rejectedRows.length === 0 && (
        <p className="placeholder-note">Keine abgelehnten Punkte.</p>
      )}
      {rejectedRows.map((p) => (
        <details key={p.id} className={`chip chip--${p.kind}`}>
          <summary>
            <span className="chip__label">{p.label}</span>
            <ActorChip actor={p.actor} />
            <span className={`badge badge--${p.kind}`}>{p.kind}</span>
          </summary>
          <div className="chip__detail">
            {p.reason && <p><strong>Begründung:</strong> {p.reason}</p>}
            {decisionButtons(p.id, "rejected")}
          </div>
        </details>
      ))}
    </section>
  );

  return (
    <main className="page">
      <h1>Redaktion: {consultation.title}</h1>
      <p className="ctabs__explainer">
        Die Maschine schlägt vor, die Redaktion gibt frei — jede Entscheidung
        (auch die der KI-Redaktion) steht im Audit-Log und kann hier jederzeit
        übersteuert werden.
      </p>
      <ConsultationTabs
        tabs={[
          {
            key: "queue",
            label: `Zu prüfen (${queueCount})`,
            explainer:
              "Neue Entwürfe aus der Pipeline: erst Punkte, dann deren abstimmbare Statements. Freigegebenes erscheint sofort öffentlich.",
            content: queueTab,
          },
          {
            key: "released",
            label: `Freigegeben (${releasedRows.length})`,
            explainer:
              "Alles, was öffentlich auf der Karte steht — mit Herkunft der Entscheidung. Hier lassen sich Befunde ergänzen oder Punkte zurückziehen.",
            content: releasedTab,
          },
          {
            key: "rejected",
            label: `Abgelehnt (${rejectedRows.length})`,
            explainer:
              "Aussortierte Entwürfe mit Begründung. Eine Ablehnung ist nie endgültig — Wiederfreigabe jederzeit möglich.",
            content: rejectedTab,
          },
        ]}
      />
    </main>
  );
}
