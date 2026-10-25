import { sql } from "@policy/db";
import { KERN_SHORT_FAMILY, type ShortCheck } from "@policy/pipeline/kern";
import { notFound, redirect } from "next/navigation";

import { PublicFrame } from "@/components/PublicFrame";
import { getPublicCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";

import { answerShort } from "../../actions";
import "../../../public.css";
import "../../tueren.css";

export const metadata = { title: "Dein Punkt" };

/**
 * Door 2 (Stephan's screen 3, second half): the machine's answer. A point
 * that is already there — "Ja, das meine ich" counts as the vote there; the
 * opposite of a point — "Ja" counts as disagreeing with it; no argument —
 * rephrase, or send it to the editors anyway.
 */
export default async function PunktGeprueft({ params }: { params: Promise<{ gemeinde: string; verfahren: string; token: string }> }) {
  const { gemeinde, verfahren, token } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  const r = await getDb().execute(sql`
    SELECT s.text, j.decided, p.text AS node_text, p.typ AS node_typ FROM submissions s
    JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text AND j.family = ${KERN_SHORT_FAMILY}
    LEFT JOIN map_points p ON p.id = (j.decided->>'node')::uuid
    WHERE s.consultation_id = ${c.consultationId} AND s.tracking_token = ${token}`);
  const row = r.rows[0] as { text: string; decided: ShortCheck & { answer?: string }; node_text: string | null } | undefined;
  if (!row) notFound();
  if (row.decided.answer && row.decided.answer !== "offen") redirect(`${base}/laufzettel/${token}`);
  const d = row.decided;
  const yes = answerShort.bind(null, c.tenant.slug, c.slug, token, "ja");
  const no = answerShort.bind(null, c.tenant.slug, c.slug, token, "nein");

  return (
    <PublicFrame town={c.tenant} campaign={c} back>
      <main className="wrap door">
        <p className="door-kicker">Dein Punkt</p>
        <blockquote className="door-quote">„{row.text}“</blockquote>
        <p className="door-checked small muted">Geprüft</p>

        {d.outcome === "kein_argument" ? (
          <section className="door-answer">
            <h1 className="serif">Das sieht nicht nach einem Argument zur Maßnahme aus.</h1>
            <p>
              Ein Argument sagt, was stimmt oder was richtig wäre, und warum es für oder gegen die Maßnahme spricht. Magst du deinen Punkt so
              formulieren? Du kannst ihn auch so an die Redaktion schicken.
            </p>
            <div className="door-actions">
              <a href={`${base}/punkt`} className="btn">
                Neu formulieren
              </a>
              <form action={no}>
                <button type="submit" className="btn btn-quiet">
                  Trotzdem an die Redaktion schicken
                </button>
              </form>
            </div>
          </section>
        ) : row.node_text ? (
          <section className="door-answer">
            <h1 className="serif">{d.outcome === "gegenteil" ? "Das Gegenteil steht schon zur Abstimmung:" : "Das könnte ein Punkt sein, den es schon gibt:"}</h1>
            <blockquote className={`door-match${d.outcome === "gegenteil" ? " against" : ""}`}>„{row.node_text}“</blockquote>
            <p>
              {d.outcome === "gegenteil"
                ? "Meinst du, dass diese Aussage nicht stimmt? Dann zählt deine Stimme dort als Ablehnung."
                : "Meinst du das? Dann zählt deine Stimme dort als Zustimmung, und dein Satz kommt zu den Belegen dieses Punkts."}
            </p>
            <div className="door-actions">
              <form action={yes}>
                <button type="submit" className="btn">
                  {d.outcome === "gegenteil" ? "Ja, die lehne ich ab" : "Ja, das meine ich"}
                </button>
              </form>
              <form action={no}>
                <button type="submit" className="btn btn-quiet">
                  Nein, das ist etwas anderes
                </button>
              </form>
            </div>
            <p className="small muted">Bei „Nein“ prüft ein Mensch deinen Punkt. Du bekommst einen Link, um mitzuverfolgen, was daraus wird.</p>
          </section>
        ) : (
          redirect(`${base}/laufzettel/${token}`)
        )}
      </main>
    </PublicFrame>
  );
}
