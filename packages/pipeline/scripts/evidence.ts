/**
 * Evidence per source (exp/jev, concept paper v7 §6/§7): does the quoted
 * passage back its argument with evidence — data, a study, a legal provision,
 * a documented case — or does it only assert? "Am Tatsachenpunkt zählt
 * Beweiskraft, nicht Kopfzahl." The Landkarte combines this with the camp
 * profile: evidenced but disbelieved = mediation; unevidenced and disputed =
 * a study settles it; unevidenced and believed by all = nobody asks.
 *
 * One Jev choice per source quote (batched), recorded in `judgments`
 * (subject_kind 'point_source', family source-evidence.v1). Skips sources
 * already judged under this family. Usage:
 *   DATABASE_URL=... TYPESAFE_API_KEY=... tsx scripts/evidence.ts --consultation <ref> [--concurrency 8]
 */

import { createDb, sql, type Db } from "@policy/db";
import { choice, JevJudge } from "@policy/llm";

import { judgeAll, resolveConsultation, saveJudgment, statsLine } from "../src/jev-stage.ts";
import { DRAFT_DOCUMENT_KINDS, type DraftKind } from "../src/measures.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** v2: the draft's own sections and bare numbers are not evidence (v1 counted "§ 13 Abs. 4 anheben" as a legal source). */
export const SOURCE_EVIDENCE_FAMILY = "source-evidence.v2";
const BATCH = 20;
/** Below this probability of "no evidence" a source counts as evidenced. */
export const EVIDENCED_BELOW = 0.5;

/** What `draft` is and how a passage points at it (law wording unchanged since v2). */
const DRAFT_REFS: Record<DraftKind, string> = {
  law: `The draft law under discussion is \`draft\`: a reference to its own sections ("§ 29", "§ 13 Absatz 4", "der Entwurf", "WPG-E") only says WHAT is discussed and is never evidence. A demand to change a section is never evidence.`,
  strategy: `The draft strategy under discussion is \`draft\`: a reference to its own parts ("Handlungsfeld 3.4", "Kapitel 3", "der Entwurf", "die Strategie") only says WHAT is discussed and is never evidence. A demand to change the strategy is never evidence.`,
};

export function evidenceQuestion(key: string, kind: DraftKind = "law") {
  return choice(
    {
      task: `What evidence does the quoted passage in \`sources.${key}.quote\` give for the argument in \`sources.${key}.argument\`? Judge only what the passage itself contains. ${DRAFT_REFS[kind]}`,
    },
    {
      data: `\`sources.${key}.quote\` presents concrete figures, measurements, or statistics AND their basis (a named source, a calculation, a survey) — a bare number or estimate without basis does not count.`,
      study: `\`sources.${key}.quote\` names or cites a specific study, expert report, analysis, or scientific source.`,
      law: `\`sources.${key}.quote\` grounds the argument in a provision of ANOTHER law (e.g. the Basic Law, EU law, the building energy act), a court ruling, or an official statement of another body (e.g. the Bundesrat's statement) — not in a section of \`draft\`.`,
      case: `\`sources.${key}.quote\` describes a documented real case, project, or comparison from practice.`,
      none: `\`sources.${key}.quote\` only asserts, demands, or evaluates, or refers to sections of \`draft\` — no data with a basis, study, other legal source, or documented case is given.`,
    },
  );
}

interface Src {
  id: string;
  quote: string;
  label: string;
  summary: string | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db: Db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const res = await db.execute(sql`
    SELECT ps.id, ps.quote, p.label, p.summary FROM point_sources ps JOIN points p ON p.id = ps.point_id
    WHERE p.consultation_id = ${cons.id} AND p.status = 'released' AND ps.quote IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM judgments j WHERE j.subject_kind = 'point_source' AND j.subject_id = ps.id::text
                      AND j.family = ${SOURCE_EVIDENCE_FAMILY})
    ORDER BY ps.created_at`);
  const srcs = res.rows as unknown as Src[];
  // The draft under consultation: a law (WPG) or a strategy (its title is the consultation's).
  const docKinds = (await db.execute(sql`SELECT DISTINCT kind FROM consultation_documents WHERE consultation_id = ${cons.id}`)).rows.map((r) => (r as { kind: string }).kind);
  const draftKind: DraftKind = docKinds.includes("drucksache:Gesetzentwurf") ? "law" : (docKinds.map((k) => DRAFT_DOCUMENT_KINDS[k]).find(Boolean) ?? "law");
  const draft = draftKind === "law" ? "Entwurf eines Gesetzes für die Wärmeplanung (Wärmeplanungsgesetz, WPG-E)" : `Entwurf: ${cons.title}`;
  console.log(`${srcs.length} source quotes to judge`);
  const batches: Src[][] = [];
  for (let o = 0; o < srcs.length; o += BATCH) batches.push(srcs.slice(o, o + BATCH));

  const dist: Record<string, number> = {};
  const stats = await judgeAll(
    new JevJudge(),
    batches,
    (b) => ({
      state: { draft, sources: Object.fromEntries(b.map((s, i) => [`s${i + 1}`, { argument: s.summary ?? s.label, quote: s.quote }])) },
      questions: Object.fromEntries(b.map((_, i) => [`s${i + 1}`, evidenceQuestion(`s${i + 1}`, draftKind)])),
    }),
    async (b, answers, provenance) => {
      await db.transaction(async (tx) => {
        for (const [i, s] of b.entries()) {
          const a = answers[`s${i + 1}`] as { choice: string; probabilities: Record<string, number> };
          const pNone = a.probabilities.none ?? 0;
          const evidenced = pNone < EVIDENCED_BELOW;
          const kind = evidenced
            ? Object.entries(a.probabilities).filter(([k]) => k !== "none").sort((x, y) => y[1] - x[1])[0]![0]
            : "none";
          dist[kind] = (dist[kind] ?? 0) + 1;
          await saveJudgment(tx as unknown as Db, {
            tenantId: cons.tenantId,
            consultationId: cons.id,
            subjectKind: "point_source",
            subjectId: s.id,
            family: SOURCE_EVIDENCE_FAMILY,
            provenance,
            answers: { evidence: a },
            decided: { kind, evidenced, pNone: Number(pNone.toFixed(3)) },
          });
        }
      });
    },
    Number(arg("concurrency") ?? 8),
    { label: (b) => `evidence batch of ${b.length}`, progress: "evidence" },
  );
  console.log(`\n${statsLine(stats)}`);
  console.log(`evidence: ${Object.entries(dist).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
