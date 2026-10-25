import { sql } from "@policy/db";

import { publishedBundle } from "@/lib/bericht";
import { getPublicCampaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";

/**
 * R5, the open export: the vote matrix (W1), the statements, the
 * contributions with their quotes, the protocol (P1) and the stored result
 * (W9). Every number in the report can be recomputed from these files.
 * Participants are numbered as on the results page; private persons are
 * never named.
 */

type Row = Record<string, unknown>;

const json = (data: unknown, name: string) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `inline; filename="${name}"` },
  });

const ACTOR = (a: string) => (a.startsWith("user:") ? "Verwaltung oder Redaktion" : a.startsWith("ki") ? "Maschine" : a === "regel" ? "Regel" : a === "demo" ? "Demo-Vorbereitung" : "System");

export async function GET(_req: Request, { params }: { params: Promise<{ gemeinde: string; verfahren: string; datei: string }> }) {
  const { gemeinde, verfahren, datei } = await params;
  const c = await getPublicCampaign(gemeinde, verfahren);
  const bundle = c ? await publishedBundle(c) : null;
  if (!c || !bundle) return new Response("Nicht gefunden", { status: 404 });
  const r = bundle.result;
  const names = bundle.naming?.names ?? [];
  const camp = (g: number) => (g >= 0 ? (names[g] ?? `Lager ${"ABCDE"[g]}`) : "");

  switch (datei) {
    case "abstimmungsmatrix.csv": {
      const head = ["teilnehmer", "lager", "herkunft", ...r.statements.map((s) => `A${s.nr}`)];
      const via = (v: string | null) => (v === "tuer" ? "beteiligung" : v === "simulation" ? "simuliert" : v ? "stellungnahme" : "");
      const cell = (ch: string) => (ch === "a" ? "1" : ch === "d" ? "-1" : ch === "p" ? "0" : "");
      const q = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      const lines = [head.join(","), ...r.people.map((p) => [String(p.n), q(camp(p.camp)), via(p.via), ...[...p.v].map(cell)].join(","))];
      return new Response(`${lines.join("\n")}\n`, {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="abstimmungsmatrix-${c.slug}.csv"` },
      });
    }
    case "aussagen.json":
      return json(
        {
          verfahren: c.title,
          massnahme: c.measure,
          werte: "1 = stimmt zu, -1 = lehnt ab, 0 = enthält sich; je Lager gezählt unter den Personen des Lagers, die abgestimmt haben",
          lager: (r.camps?.sizes ?? []).map((n, g) => ({ lager: camp(g), personen: n, beschreibung: bundle.naming?.descriptions?.[g] ?? null })),
          aussagen: r.statements.map(({ quotes: _, ...s }) => ({ ...s, lager: s.camps.map((x, g) => ({ lager: camp(g), ...x })), camps: undefined })),
        },
        `aussagen-${c.slug}.json`,
      );
    case "beitraege.json":
      return json(
        r.statements.flatMap((s) =>
          s.quotes.map((q) => ({
            aussage: s.nr,
            zitat: q.text,
            kernaussage: q.aussage,
            haltung: q.stance === 1 ? "stimmt zu" : "widerspricht",
            richtung: q.richtung,
            beleg: q.beleg,
            absender: q.source?.kind === "organisation" ? q.sender : q.source?.kind === "kurzaussage" ? "Eigener Punkt aus der Beteiligung" : "Privatperson",
            teilnehmer: q.person,
            eingang: q.source?.date ?? null,
          })),
        ),
        `beitraege-${c.slug}.json`,
      );
    case "protokoll.json": {
      const rows = (
        await getDb().execute(sql`
          SELECT a.created_at, a.actor, a.action, a.subject_kind, a.reason FROM audit_log a
          WHERE a.tenant_id = ${c.tenantId} AND (
            a.subject_id = ${c.id}
            OR a.subject_id IN (SELECT id::text FROM map_points WHERE consultation_id = ${c.consultationId})
            OR a.subject_id IN (SELECT id::text FROM moves WHERE consultation_id = ${c.consultationId})
            OR a.subject_id IN (SELECT id::text FROM campaign_results WHERE campaign_id = ${c.id})
            OR a.subject_id IN (SELECT id::text FROM campaign_reports WHERE campaign_id = ${c.id}))
          ORDER BY a.created_at, a.id`)
      ).rows as Row[];
      return json(
        rows.map((x) => ({ zeit: x.created_at, wer: ACTOR(x.actor as string), was: x.action, woran: x.subject_kind, grund: x.reason ?? null })),
        `protokoll-${c.slug}.json`,
      );
    }
    case "ergebnis.json":
      return json(
        { version: bundle.version, gerechnet: bundle.createdAt, lagernamen: names, beschreibungen: bundle.naming?.descriptions ?? [], ergebnis: r },
        `ergebnis-${c.slug}.json`,
      );
    default:
      return new Response("Nicht gefunden", { status: 404 });
  }
}
