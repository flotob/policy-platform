/**
 * "Ihre Beiträge": every point and statement this browser sent in one procedure, with where each stands.
 * Read from what is stored anyway (submissions.participant_id = the browser's pseudonym for this procedure);
 * no login. Another device needs the Laufzettel link or the e-mail. Per procedure on purpose: the pseudonym
 * is separate per procedure, so nobody can link one person's contributions across topics.
 */

import { sql } from "@policy/db";
import { KERN_SHORT_FAMILY } from "@policy/pipeline/kern";

import type { Campaign } from "./campaigns";
import { getDb } from "./db";

type Row = Record<string, unknown>;

export interface Beitrag {
  token: string;
  kind: "punkt" | "stellungnahme";
  /** The point's words, or the statement's file name. */
  label: string;
  at: string;
  status: string;
  tone: "wait" | "yes" | "no";
  /** Path below the procedure: the slip, or the question still waiting for the author's answer. */
  href: string;
}

const clip = (t: string, n = 140) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")} …` : s;
};

interface MoveState {
  state: "vorgelegt" | "verknuepft" | "verworfen";
  stance: number;
  released: boolean | null;
  own: boolean | null;
}

/** Said of anything not decided when the procedure closed: it never came to the vote. */
const TOO_LATE = "Kam vor Schluss nicht mehr zur Abstimmung";

function statusOf(kind: Beitrag["kind"], moves: MoveState[], job: string | null, answer: string | null, open: boolean): Pick<Beitrag, "status" | "tone"> {
  const reading = open && (job === "wartet" || job === "laeuft");
  if (!moves.length) {
    if (!open) return { status: TOO_LATE, tone: "no" };
    if (reading) return { status: "Wird gerade gelesen", tone: "wait" };
    if (job === "fehler") return { status: "Beim Lesen hakt es; die Redaktion kümmert sich", tone: "wait" };
    if (kind === "punkt" && answer === "offen") return { status: "Wartet auf Ihre Antwort", tone: "wait" };
    return { status: "Wird geprüft", tone: "wait" };
  }
  const taken = moves.filter((m) => m.state === "verknuepft" && m.released);
  const dropped = moves.filter((m) => m.state === "verworfen");
  const pending = moves.length - taken.length - dropped.length;
  if (kind === "punkt") {
    const m = moves[0]!;
    if (m.state === "verworfen") return { status: "Nicht in die Abstimmung aufgenommen", tone: "no" };
    if (m.state !== "verknuepft" || !m.released) return open ? { status: "Wird geprüft", tone: "wait" } : { status: TOO_LATE, tone: "no" };
    if (m.own) return { status: "Als neue Aussage aufgenommen", tone: "yes" };
    if (m.stance === -1) return { status: "Zählt als Widerspruch zu einer Aussage", tone: "yes" };
    return { status: "Gehört zu einer Aussage, die schon da war", tone: "yes" };
  }
  const parts = [
    taken.length ? `${taken.length} aufgenommen` : "",
    pending ? `${pending} ${open ? "in Prüfung" : "vor Schluss nicht mehr eingeordnet"}` : "",
    dropped.length ? `${dropped.length} nicht aufgenommen` : "",
  ].filter(Boolean);
  const head = `${moves.length} ${moves.length === 1 ? "Argument" : "Argumente"}${reading ? " bisher" : ""}`;
  return { status: `${head}: ${parts.join(", ")}`, tone: (pending && open) || reading ? "wait" : taken.length ? "yes" : "no" };
}

/** This browser's contributions to one procedure, newest first. */
export async function myContributions(c: Campaign, participantId: string): Promise<Beitrag[]> {
  const open = c.state === "offen";
  const r = await getDb().execute(sql`
    SELECT s.tracking_token, s.door, s.text, s.created_at, j.decided->>'answer' AS answer,
      (SELECT f.filename FROM campaign_files f WHERE f.submission_id = s.id LIMIT 1) AS filename,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('state', m.state, 'stance', m.stance, 'released', p.status = 'released',
          'own', m.route IN ('neu', 'praezisierung') AND p.proposal->>'text' = m.aussage) ORDER BY m.ord), '[]'::jsonb)
        FROM moves m LEFT JOIN map_points p ON p.id = m.map_point_id WHERE m.submission_id = s.id) AS moves,
      (SELECT x.state FROM campaign_jobs x LEFT JOIN campaign_files f ON f.id = x.file_id
        WHERE x.submission_id = s.id OR f.submission_id = s.id ORDER BY x.created_at DESC LIMIT 1) AS job
    FROM submissions s
    LEFT JOIN judgments j ON j.subject_kind = 'submission' AND j.subject_id = s.id::text AND j.family = ${KERN_SHORT_FAMILY}
    WHERE s.consultation_id = ${c.consultationId} AND s.participant_id = ${participantId} AND s.tracking_token IS NOT NULL
    ORDER BY s.created_at DESC, s.tracking_token`);
  return (r.rows as Row[]).map((x) => {
    const token = x.tracking_token as string;
    const kind: Beitrag["kind"] = x.door === "statement" ? "punkt" : "stellungnahme";
    const answer = (x.answer as string | null) ?? null;
    const moves = (x.moves as MoveState[] | null) ?? [];
    const filename = (x.filename as string | null) ?? null;
    return {
      token,
      kind,
      label: kind === "stellungnahme" && filename ? `„${filename}“` : clip(String(x.text ?? "")),
      at: String(x.created_at),
      ...statusOf(kind, moves, (x.job as string | null) ?? null, answer, open),
      href: open && kind === "punkt" && answer === "offen" && !moves.length ? `punkt/${token}` : `laufzettel/${token}`,
    };
  });
}
