/**
 * The example on the landing page: the published Musterstadt result itself — its camps, its people and
 * four of its statements — so the picture on the first page and the example one click away tell the same
 * story, and follow it when the example is evaluated again. Kept in memory per published report.
 */
import { sql } from "@policy/db";
import type { Ergebnis, StatementOut } from "@policy/pipeline/kern";
import { campName, categoryWords, checkLines, firmBridge, groupOf, groupWords, overall, readingOf } from "@policy/pipeline/kern/text";

import { namingOf } from "./bericht";
import { getPublicCampaign } from "./campaigns";
import { getDb } from "./db";
import { hiddenOf } from "./meldungen";

type Row = Record<string, unknown>;

export const EXAMPLE = { gemeinde: "musterstadt", verfahren: "solarpflicht" } as const;

/** Why the statement was chosen: the core dispute, a firm bridge, a bridge with a reservation, a fact a report can settle. */
export type ExampleRole = "kern" | "einig" | "vorbehalt" | "tatsache";

export interface ExampleStatement {
  role: ExampleRole;
  text: string;
  label: string;
  tone: "agree" | "disagree" | "warn";
  /** The reading without its counting sentence (the numbers stand beside it). */
  reading: string;
  camps: { agree: number; seen: number }[];
}

export interface Example {
  href: string;
  title: string;
  camps: { name: string; n: number }[];
  /** Placed people: position 0–1000 both ways, camp, and their vote on each chosen statement (a, d, p or .). */
  people: { x: number; y: number; camp: number; v: string }[];
  statements: ExampleStatement[];
}

let cache: { report: string; value: Example | null } | null = null;

export async function landingExample(): Promise<Example | null> {
  try {
    const c = await getPublicCampaign(EXAMPLE.gemeinde, EXAMPLE.verfahren);
    if (!c || c.preview || c.state !== "veroeffentlicht") return null;
    const db = getDb();
    const rep = (
      await db.execute(sql`
        SELECT id, result_id FROM campaign_reports WHERE campaign_id = ${c.id} AND state = 'veroeffentlicht' ORDER BY version DESC LIMIT 1`)
    ).rows[0] as Row | undefined;
    if (!rep) return null;
    const hit = cache;
    if (hit && hit.report === rep.id) return hit.value;
    const res = (await db.execute(sql`SELECT result, camp_names FROM campaign_results WHERE id = ${rep.result_id} AND campaign_id = ${c.id}`))
      .rows[0] as Row | undefined;
    const hidden = await hiddenOf(c);
    const value = res ? build(res.result as Ergebnis, namingOf(res.camp_names)?.names ?? null, hidden.nodes, `/${c.tenant.slug}/${c.slug}`, c.title) : null;
    cache = { report: rep.id as string, value };
    return value;
  } catch (e) {
    console.error("[landing] example:", e);
    return null;
  }
}

function build(r: Ergebnis, names: string[] | null, hidden: Set<string>, base: string, title: string): Example | null {
  const k = r.camps?.k ?? 0;
  if (!r.ready || k < 2) return null;
  const pool = r.statements.filter((s) => s.rolle !== "schluss" && !hidden.has(s.id));
  const least = (s: StatementOut) => Math.min(...s.camps.map((x) => (x.seen ? x.agree / x.seen : 0)));
  const bridges = pool.filter((s) => s.category === "bruecke" && s.profile === "getragen").sort((a, b) => least(b) - least(a));
  const core = overall(r)
    .core.map((nr) => pool.find((s) => s.nr === nr))
    .find(Boolean);
  const firm = bridges.find((s) => firmBridge(s));
  const caution = pool.find((s) => s.category === "warnung") ?? bridges.find((s) => !firmBridge(s));
  const fact = pool.filter((s) => s.category === "klaerbar").sort((a, b) => b.gap - a.gap)[0];
  const slots: [ExampleRole, StatementOut | undefined][] = [
    ["kern", core],
    ["einig", firm],
    ["vorbehalt", caution],
    ["tatsache", fact],
  ];
  const picked: { s: StatementOut; role: ExampleRole }[] = [];
  for (const [role, s] of slots) if (s && !picked.some((x) => x.s.id === s.id)) picked.push({ s, role });
  const chosen = picked.map((x) => x.s);
  if (!chosen.length) return null;

  const word = (s: StatementOut): Pick<ExampleStatement, "label" | "tone"> => {
    if (s.category === "bruecke") return firmBridge(s) ? { label: categoryWords("bruecke", k).label, tone: "agree" } : { label: "Einigkeit unter Vorbehalt", tone: "warn" };
    return { label: groupWords(groupOf(s, r.params.bridgeThreshold), k).label, tone: s.category === "streit" ? "disagree" : "warn" };
  };
  return {
    href: base,
    title,
    camps: Array.from({ length: k }, (_, g) => ({ name: campName(names, g), n: r.camps!.sizes[g] ?? 0 })),
    people: r.people
      .filter((p) => p.camp >= 0 && p.x >= 0 && p.y >= 0)
      .map((p) => ({ x: p.x, y: p.y, camp: p.camp, v: chosen.map((s) => p.v[s.nr - 1] ?? ".").join("") })),
    statements: picked.map(({ s, role }) => {
      const lines = readingOf(s, r, names);
      // The results page points to its checks below the reading; here the failed check is said in place.
      const failed = s.category === "bruecke" && !firmBridge(s) ? checkLines(s, r, names).filter((c) => c.ok === false) : [];
      return {
        role,
        text: s.text,
        ...word(s),
        reading: failed.length
          ? `Die Einigkeit ist nicht belastbar. ${failed.map((c) => c.text).join(" ")} Allein trägt sie keinen Beschluss.`
          : (lines.length > 1 ? lines.slice(1) : lines).join(" "),
        camps: s.camps.map((x) => ({ agree: x.agree, seen: x.seen })),
      };
    }),
  };
}
