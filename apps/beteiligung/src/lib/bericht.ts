/**
 * The report of a campaign (Gesamtmodell R1–R5) as records: every version
 * keeps its sentence list (R1), its text (R2) and its check (R3); the
 * editors release or reject it (R4), the initiator publishes (R5). A
 * rejected version stays; the next one reads why it was sent back.
 */

import { sql } from "@policy/db";
import { conclusions, type Absatz, type Checks, type Ergebnis, type Satz } from "@policy/pipeline/kern";

import type { SavedResult } from "./auswertung";
import type { Campaign } from "./campaigns";
import { getDb } from "./db";
import { enqueue } from "./kern";
import { QUESTIONS } from "./params";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];

export type ReportState = "liste" | "text" | "geprueft" | "durchgefallen" | "zurueckgewiesen" | "freigegeben" | "veroeffentlicht";

export const REPORT_STATES: Record<ReportState, { label: string; text: string }> = {
  liste: { label: "Wird geschrieben", text: "Die Schlussfolgerungen stehen fest; die Maschine formuliert den Text und lässt ihn gegenlesen." },
  text: { label: "Wird geprüft", text: "Der Text ist geschrieben, die Prüfung läuft." },
  geprueft: { label: "Geprüft", text: "Jeder Absatz ist auf seine Sätze rückführbar, der Gegenleser hat nichts beanstandet. Die Redaktion kann freigeben." },
  durchgefallen: { label: "Prüfung nicht bestanden", text: "Auch der zweite Entwurf hat die Prüfung nicht bestanden. Unten steht, warum." },
  zurueckgewiesen: { label: "Zurückgewiesen", text: "Die Redaktion hat diese Fassung zurückgewiesen." },
  freigegeben: { label: "Freigegeben", text: "Die Redaktion hat den Bericht freigegeben. Veröffentlichen kann die Verwaltung." },
  veroeffentlicht: { label: "Veröffentlicht", text: "Bericht, Ergebnisseite und offene Daten sind öffentlich." },
};

/** Camp names as the editors confirmed them, with the machine's proposal kept beside them. */
export interface CampNaming {
  names: string[];
  descriptions: string[];
  proposal: { names: string[]; descriptions: string[] } | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export function namingOf(stored: unknown): CampNaming | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const x = stored as Partial<CampNaming>;
  return { names: x.names ?? [], descriptions: x.descriptions ?? [], proposal: x.proposal ?? null, confirmedBy: x.confirmedBy ?? null, confirmedAt: x.confirmedAt ?? null };
}

export interface Report {
  id: string;
  resultId: string;
  version: number;
  state: ReportState;
  sentences: Satz[];
  text: Absatz[] | null;
  checks: Checks | null;
  feedback: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const toReport = (r: Row): Report => ({
  id: r.id as string,
  resultId: r.result_id as string,
  version: Number(r.version),
  state: r.state as ReportState,
  sentences: r.sentences as Satz[],
  text: (r.text as Absatz[] | null) ?? null,
  checks: (r.checks as Checks | null) ?? null,
  feedback: (r.feedback as string | null) ?? null,
  decidedBy: (r.decided_by as string | null) ?? null,
  decidedAt: r.decided_at ? String(r.decided_at) : null,
  createdAt: String(r.created_at),
});

export async function latestReport(campaignId: string): Promise<Report | null> {
  const r = await rows(sql`SELECT * FROM campaign_reports WHERE campaign_id = ${campaignId} ORDER BY version DESC LIMIT 1`);
  return r[0] ? toReport(r[0]) : null;
}

export async function listReports(campaignId: string): Promise<Report[]> {
  return (await rows(sql`SELECT * FROM campaign_reports WHERE campaign_id = ${campaignId} ORDER BY version DESC`)).map(toReport);
}

export async function publishedReport(campaignId: string): Promise<Report | null> {
  const r = await rows(sql`SELECT * FROM campaign_reports WHERE campaign_id = ${campaignId} AND state = 'veroeffentlicht' ORDER BY version DESC LIMIT 1`);
  return r[0] ? toReport(r[0]) : null;
}

export async function getReport(campaignId: string, id: string): Promise<Report | null> {
  const r = await rows(sql`SELECT * FROM campaign_reports WHERE campaign_id = ${campaignId} AND id = ${id}`);
  return r[0] ? toReport(r[0]) : null;
}

/** R1 for a stored result, then R2/R3 in the background. */
export async function startReport(c: Campaign, saved: SavedResult, town: string, feedback: string | null = null): Promise<Report> {
  const naming = namingOf(saved.campNames);
  const sentences = conclusions(saved.result, naming?.names ?? null, {
    town,
    measure: c.measure,
    questions: QUESTIONS.map((q) => ({ key: q.key, label: q.label })),
    fictional: c.fictional,
    editorialMode: c.params.editorialMode,
    resultVersion: saved.version,
    descriptions: naming?.descriptions ?? null,
  });
  const r = await rows(sql`
    INSERT INTO campaign_reports (tenant_id, campaign_id, result_id, version, sentences, feedback)
    SELECT ${c.tenantId}, ${c.id}, ${saved.id}, COALESCE(max(version), 0) + 1, ${JSON.stringify(sentences)}, ${feedback}
    FROM campaign_reports WHERE campaign_id = ${c.id}
    RETURNING *`);
  const report = toReport(r[0]!);
  await enqueue(c.tenantId, c.id, "bericht", null, null, { reportId: report.id });
  return report;
}

/** What the public may see: only a published report, and the result it was written from. */
export async function publishedBundle(c: Campaign) {
  if (c.state !== "veroeffentlicht") return null;
  const report = await publishedReport(c.id);
  if (!report) return null;
  const r = await rows(sql`SELECT * FROM campaign_results WHERE id = ${report.resultId} AND campaign_id = ${c.id}`);
  if (!r[0]) return null;
  const naming = namingOf(r[0].camp_names);
  return { report, result: r[0].result as Ergebnis, version: Number(r[0].version), naming, createdAt: String(r[0].created_at) };
}
