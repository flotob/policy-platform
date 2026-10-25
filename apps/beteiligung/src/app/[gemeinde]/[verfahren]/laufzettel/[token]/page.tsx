import { sql } from "@policy/db";
import { KERN_SHORT_FAMILY } from "@policy/pipeline/kern";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { PublicFrame } from "@/components/PublicFrame";
import { getPublicCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { QUESTIONS, STEPS } from "@/lib/params";
import { REJECT } from "@/lib/vocab";

import { objectToAssignment } from "../../actions";
import "../../../public.css";
import "../../tueren.css";

export const metadata = { title: "Laufzettel" };

type Row = Record<string, unknown>;
const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const TYP = { T: "Tatsache", W: "Wertung", verfahren: "Ausgestaltung" } as Record<string, string>;
const TYP_LONG = { T: "Tatsachenfrage · lässt sich klären", W: "Wertungsfrage · entscheidet die Politik", verfahren: "Ausgestaltung · eine Frage der Gestaltung" } as Record<
  string,
  string
>;
const pct = (p: unknown) => `${Math.round(Number(p ?? 0) * 100)} %`;

function place(r: { typ: string; schritt: string | null; frage: string | null }): string {
  const q = QUESTIONS.find((x) => x.key === r.frage);
  const s = STEPS.find((x) => x.key === r.schritt);
  if (!s) return `Die Maßnahme selbst · ${TYP[r.typ] ?? r.typ}`;
  return `${q ? q.label : s.label} · ${TYP[r.typ] ?? r.typ}`;
}

interface MoveView {
  id: string;
  quote: string;
  kern: string;
  aussage: string;
  typ: string;
  schritt: string | null;
  frage: string | null;
  route: string | null;
  state: string;
  stance: number;
  match: { pSame?: number; pOpposite?: number; node?: string | null } | null;
  decision: { action?: string; reason?: string; einspruch?: boolean } | null;
  decidedBy: string | null;
  node: null | {
    ord: number;
    status: string;
    text: string;
    typ: string;
    schritt: string | null;
    frage: string | null;
    releasedAt: string | null;
    releasedBy: string | null;
    agree: number;
    disagree: number;
    mergedOrd: number | null;
  };
  matchOrd: number | null;
  own: boolean;
}

/** What became of one argument, in the words of Stephan's Laufzettel. */
function Fate({ m, base, token, short }: { m: MoveView; base: string; token: string; short: boolean }) {
  const n = m.node;
  const own = m.own;
  let head: string;
  let body: string | null = null;
  if (m.state === "verworfen") {
    head = "Nicht in die Abstimmung aufgenommen";
    body = `Die Redaktion hat diesen Beitrag verworfen${m.decision?.reason ? `: ${REJECT[m.decision.reason as keyof typeof REJECT] ?? m.decision.reason}` : ""}. Er bleibt im Protokoll.`;
  } else if (m.state === "vorgelegt" || !n || n.status !== "released") {
    head = m.decision?.einspruch ? "Dein Einspruch liegt bei der Redaktion" : `Ein Mensch aus der Redaktion prüft ${short ? "deinen Punkt" : "dieses Argument"}`;
    body = n?.status === "released" ? `Die Frage ist, ob er zu Punkt ${n.ord} gehört.` : "Sobald entschieden ist, steht es hier.";
  } else if (own) {
    head = `Dein Punkt ist jetzt Punkt ${n.ord}`;
    body = `${m.decidedBy?.startsWith("ki") ? "Die Maschine hat ihn" : "Ein Mensch aus der Redaktion hat ihn"} geprüft und als neuen Punkt angelegt.${n.releasedAt ? ` Seit dem ${date.format(new Date(n.releasedAt))} stimmen andere darüber ab.` : ""}`;
  } else if (m.stance === -1) {
    head = `Dein Punkt zählt als Widerspruch zu Punkt ${n.ord}`;
    body = "Er sagt das Gegenteil einer Aussage, die schon zur Abstimmung steht. Deine Stimme zählt dort als Ablehnung.";
  } else {
    head = `Dein Punkt gehört zu Punkt ${n.ord}`;
    body = "Diese Aussage stand schon zur Abstimmung. Deine Stimme zählt dort, dein Satz gehört zu ihren Belegen.";
  }

  const byAuthor = m.decision?.action === "vom_verfasser_bestaetigt";
  const machine = {
    kern: m.kern,
    place: place(m),
    known: byAuthor
      ? `${m.stance === -1 ? "Gegenteil von" : "Gleich wie"} Punkt ${n?.ord ?? "?"} · Sicherheit ${pct(m.stance === -1 ? m.match?.pOpposite : m.match?.pSame)} · dir zur Bestätigung gezeigt`
      : m.route === "auto"
        ? `Treffer auf Punkt ${m.matchOrd ?? "?"} · Sicherheit ${pct(m.match?.pSame)}`
        : m.route === "unsicher"
          ? `Treffer auf Punkt ${m.matchOrd ?? "?"} · Sicherheit ${pct(m.match?.pSame)} · unter der Schwelle, daher Vorlage`
          : m.route === "gegenteil"
            ? `Gegenteil von Punkt ${m.matchOrd ?? "?"} · Sicherheit ${pct(m.match?.pOpposite)} · daher Vorlage`
            : m.matchOrd
              ? `Neu, ähnlich wie Punkt ${m.matchOrd} · daher Vorlage`
              : "Neu · daher Vorlage",
    aussage: m.aussage,
  };
  const action = m.decision?.action;
  const editors = {
    kern: m.state === "verworfen" ? "—" : "übernommen",
    place: !n || n.status !== "released" ? "offen" : place(n) === machine.place ? "übernommen" : `Geändert: ${place(n)}`,
    known:
      m.state === "verworfen"
        ? "Verworfen"
        : m.state === "vorgelegt"
          ? "offen"
          : action === "vom_verfasser_bestaetigt"
            ? "von dir bestätigt"
            : action === "auto"
              ? "automatisch, ohne Vorlage"
              : own
                ? "neuer Punkt angelegt"
                : action === "zusammengefuehrt"
                  ? `Geändert: zu Punkt ${n?.ord} gelegt`
                  : action === "umgehaengt" || action === "neuer_punkt"
                    ? `Geändert: Punkt ${n?.ord} zugeordnet`
                    : "übernommen",
    aussage: !n || n.status !== "released" ? "offen" : !own ? `gehört zu „${n.text}“` : n.text === m.aussage ? "übernommen" : `Geändert: „${n.text}“`,
  };
  const rows: [string, string, string][] = [
    // A point the author confirmed as already there was never decomposed: no core to show.
    ...(byAuthor ? [] : [["Kern erkannt", machine.kern, editors.kern] as [string, string, string]]),
    ["Stelle in der Begründung", machine.place, editors.place],
    ["Bekannt oder neu?", machine.known, editors.known],
    ["Aussage formuliert", machine.aussage, editors.aussage],
  ];

  return (
    <section className="fate">
      <h2 className="serif">{head}</h2>
      {body ? <p>{body}</p> : null}
      {n && n.status === "released" && m.state === "verknuepft" ? (
        <div className="fate-point">
          <p className="small muted">So steht {own ? "er" : "der Punkt"} zur Abstimmung</p>
          <p className="fate-text serif">{n.text}</p>
          <p className="small">
            <span className="fate-typ">{TYP_LONG[n.typ] ?? n.typ}</span>
            <span className="muted num">
              {" "}
              · Bisher: {n.agree} dafür, {n.disagree} dagegen
            </span>
          </p>
        </div>
      ) : null}
      <details className="fate-diff">
        <summary>Was genau geändert wurde</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Station</th>
              <th scope="col" className="ki">
                Die Maschine hat vorgeschlagen
              </th>
              <th scope="col" className="rd">
                Die Redaktion hat entschieden
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([station, ki, rd]) => (
              <tr key={station}>
                <th scope="row">{station}</th>
                <td className="ki">{ki}</td>
                <td className={`rd${rd.startsWith("Geändert") ? " changed" : ""}`}>{rd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {m.state === "verknuepft" ? (
        <form action={objectToAssignment.bind(null, base.split("/")[1]!, base.split("/")[2]!, token, m.id)}>
          <button type="submit" className="btn btn-quiet btn-small">
            Das meint mein Punkt nicht
          </button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * The tracking slip (Stephan's screen 4 and his "Laufzettel"): what became of
 * a door-2 point or of every argument in a door-3 statement — the machine's
 * proposal next to the editors' decision, station by station.
 */
export default async function Laufzettel({
  params,
  searchParams,
}: {
  params: Promise<{ gemeinde: string; verfahren: string; token: string }>;
  searchParams: Promise<{ einspruch?: string }>;
}) {
  const { gemeinde, verfahren, token } = await params;
  const { einspruch } = await searchParams;
  const c = await getPublicCampaign(gemeinde, verfahren);
  if (!c) notFound();
  const base = `/${c.tenant.slug}/${c.slug}`;
  const db = getDb();
  const s = (
    await db.execute(sql`
      SELECT s.id, s.door, s.text, s.created_at, s.author_org, f.filename, j.decided
      FROM submissions s LEFT JOIN campaign_files f ON f.submission_id = s.id
      LEFT JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text AND j.family = ${KERN_SHORT_FAMILY}
      WHERE s.consultation_id = ${c.consultationId} AND s.tracking_token = ${token}`)
  ).rows[0] as Row | undefined;
  if (!s) notFound();
  const moves = (
    await db.execute(sql`
      SELECT m.*, p.ord AS n_ord, p.status AS n_status, p.text AS n_text, p.typ AS n_typ, p.schritt AS n_schritt, p.frage AS n_frage,
        p.released_at AS n_released_at, p.released_by AS n_released_by,
        -- The point was opened from this very contribution (its first proposal is this move's sentence).
        (m.route IN ('neu', 'praezisierung') AND p.proposal->>'text' = m.aussage) AS n_own,
        (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version AND v.value = 1)::int AS n_agree,
        (SELECT count(*) FROM map_point_votes v WHERE v.map_point_id = p.id AND v.version = p.version AND v.value = -1)::int AS n_disagree,
        (SELECT ord FROM map_points x WHERE x.id = (m.match->>'node')::uuid) AS match_ord
      FROM moves m LEFT JOIN map_points p ON p.id = m.map_point_id
      WHERE m.submission_id = ${s.id as string} ORDER BY m.ord`)
  ).rows as Row[];
  const job = (
    await db.execute(sql`
      SELECT j.state FROM campaign_jobs j LEFT JOIN campaign_files f ON f.id = j.file_id
      WHERE j.submission_id = ${s.id as string} OR f.submission_id = ${s.id as string} ORDER BY j.created_at DESC LIMIT 1`)
  ).rows[0] as Row | undefined;
  const busy = job?.state === "wartet" || job?.state === "laeuft";
  const reading = !moves.length && busy;
  const failed = !moves.length && job?.state === "fehler";
  const views: MoveView[] = moves.map((m) => ({
    id: m.id as string,
    quote: m.quote as string,
    kern: m.kern as string,
    aussage: m.aussage as string,
    typ: m.typ as string,
    schritt: (m.schritt as string | null) ?? null,
    frage: (m.frage as string | null) ?? null,
    route: (m.route as string | null) ?? null,
    state: m.state as string,
    stance: Number(m.stance),
    match: (m.match as MoveView["match"]) ?? null,
    decision: (m.decision as MoveView["decision"]) ?? null,
    decidedBy: (m.decided_by as string | null) ?? null,
    matchOrd: m.match_ord == null ? null : Number(m.match_ord),
    own: m.n_own === true,
    node: m.n_ord == null
      ? null
      : {
          ord: Number(m.n_ord),
          status: m.n_status as string,
          text: m.n_text as string,
          typ: m.n_typ as string,
          schritt: (m.n_schritt as string | null) ?? null,
          frage: (m.n_frage as string | null) ?? null,
          releasedAt: m.n_released_at ? String(m.n_released_at) : null,
          releasedBy: (m.n_released_by as string | null) ?? null,
          agree: Number(m.n_agree),
          disagree: Number(m.n_disagree),
          mergedOrd: null,
        },
  }));
  const isShort = s.door === "statement";
  const confirmed = (s.decided as { answer?: string } | null)?.answer === "ja";

  return (
    <PublicFrame town={c.tenant} campaign={c} fictional={c.fictional} back>
      <AutoRefresh active={busy} everyMs={5000} />
      <main className="wrap door slip">
        <div className="slip-head">
          <p className="door-kicker">
            {isShort ? "Deine Eingabe" : `Deine Stellungnahme${s.filename ? ` „${s.filename as string}“` : ""}`} vom {date.format(new Date(String(s.created_at)))}
          </p>
          <p className="small muted num">Laufzettel Nr. {token.slice(0, 4)}</p>
        </div>
        {isShort ? <blockquote className="door-quote">„{s.text as string}“</blockquote> : null}
        {einspruch ? <p className="notice small">Dein Einspruch ist angekommen. Ein Mensch aus der Redaktion sieht sich die Zuordnung noch einmal an.</p> : null}

        {reading ? (
          <section className="fate">
            <h2 className="serif">Die Maschine liest {isShort ? "deinen Punkt" : "deine Stellungnahme"} gerade.</h2>
            <p>Das dauert etwa eine Minute. Danach prüft ein Mensch aus der Redaktion alles Neue. Diese Seite aktualisiert sich von selbst.</p>
          </section>
        ) : failed ? (
          <section className="fate">
            <h2 className="serif">Beim Lesen ist etwas schiefgegangen.</h2>
            <p>Die Redaktion sieht es und kümmert sich darum. Dein Beitrag ist nicht verloren.</p>
          </section>
        ) : !views.length ? (
          <section className="fate">
            <h2 className="serif">Ein Mensch aus der Redaktion prüft deinen Punkt.</h2>
            <p>Sobald entschieden ist, steht es hier.</p>
          </section>
        ) : isShort ? (
          views.map((m) => <Fate key={m.id} m={m} base={base} token={token} short />)
        ) : (
          <>
            <p className="pub-lead">
              {busy
                ? `Die Maschine liest noch; ${views.length} ${views.length === 1 ? "Argument hat" : "Argumente hat"} sie schon gefunden. Diese Seite aktualisiert sich von selbst.`
                : `Die Maschine hat ${views.length} ${views.length === 1 ? "Argument" : "Argumente"} darin gefunden. So steht jedes davon:`}
            </p>
            {views.map((m) => (
              <div key={m.id} className="slip-move">
                <blockquote className="door-quote small-quote">„{m.quote.replace(/\s+/g, " ")}“</blockquote>
                <Fate m={m} base={base} token={token} short={false} />
              </div>
            ))}
          </>
        )}

        <p className="slip-keep small muted">
          {confirmed ? "Du hast bestätigt, dass dein Punkt schon da war. " : ""}Speichere diesen Link, um später nachzusehen.{" "}
          <Link href={`${base}/abstimmen`}>Weiter abstimmen</Link>
        </p>
      </main>
    </PublicFrame>
  );
}
