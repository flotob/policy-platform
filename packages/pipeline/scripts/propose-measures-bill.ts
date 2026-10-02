/**
 * Measures from the bill (exp/jev): what is being decided comes from the
 * draft law itself, not from what the submissions talk about. The LLM reads
 * the law text (cover sheet + articles, without the explanatory memorandum)
 * once and names the separately decidable measures with their sections;
 * jev-classify then assigns every point to one of them — or to "the bill as
 * a whole" / "beyond the bill". Audit-logged as consultation.propose_measures
 * (source: bill), which jev-classify reads.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/propose-measures-bill.ts --consultation <ref>
 *     [--document <filename>]   default: the longest 'drucksache:Gesetzentwurf', else the
 *                               longest 'strategie:Entwurf' (a draft strategy: its
 *                               fields of action are the measures)
 *     [--force]                 ask the LLM again (default: reuse the cached cut)
 *
 * Cached like the extraction: the same bill, prompt, and model give the same
 * measures across resets — iterations downstream keep a stable map structure.
 */

import { createHash } from "node:crypto";

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider } from "@policy/llm";

import { resolveConsultation } from "../src/jev-stage.ts";
import { DRAFT_DOCUMENT_KINDS } from "../src/measures.ts";
import { BILL_MEASURES_SYSTEM, STRATEGY_MEASURES_SYSTEM } from "../src/prompts.ts";
import { billMeasuresJsonSchema, billMeasuresOutput } from "../src/schemas.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const LAW_TEXT_MAX = 200_000;

/** Cover sheet + law text: everything before the explanatory memorandum ("A. Allgemeiner Teil"). */
export function lawTextOf(text: string): string {
  const m = /\n\s*A\.\s*Allgemeiner\s+Teil/.exec(text.slice(Math.floor(text.length * 0.05)));
  const end = m ? Math.floor(text.length * 0.05) + m.index : LAW_TEXT_MAX;
  return text.slice(0, Math.min(end, LAW_TEXT_MAX));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ref = arg("consultation");
  if (!ref) throw new Error("--consultation required");
  const db = createDb(url);
  const cons = await resolveConsultation(db, ref);

  const kinds = Object.keys(DRAFT_DOCUMENT_KINDS);
  const docRes = await db.execute(sql`
    SELECT filename, kind, text FROM consultation_documents
    WHERE consultation_id = ${cons.id} AND text IS NOT NULL
      AND ${arg("document") ? sql`filename = ${arg("document")}` : sql`kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`}
    ORDER BY kind = 'drucksache:Gesetzentwurf' DESC, length(text) DESC LIMIT 1
  `);
  const doc = docRes.rows[0] as { filename: string; kind: string; text: string } | undefined;
  if (!doc) throw new Error("no draft found — run scripts/import-documents.ts first (or pass --document)");
  const kind = DRAFT_DOCUMENT_KINDS[doc.kind] ?? "law";
  const law = kind === "law" ? lawTextOf(doc.text) : doc.text.slice(0, LAW_TEXT_MAX);
  console.log(`${cons.title}: reading ${doc.filename} (${kind}) — text ${law.length.toLocaleString("en")} of ${doc.text.length.toLocaleString("en")} chars`);

  const prompt =
    kind === "law"
      ? `Draft law (cover sheet and law text):\n\n---\n${law}\n---\n\nName the separately decidable measures.`
      : `Draft strategy:\n\n---\n${law}\n---\n\nName the separately decidable measures (its fields of action).`;
  const system = kind === "law" ? BILL_MEASURES_SYSTEM : STRATEGY_MEASURES_SYSTEM;
  const model = process.env.LLM_MODEL ?? "claude-sonnet-5-5";
  // The law's hash input is unchanged — WPG keeps its cached cut.
  const callHash = createHash("sha256")
    .update(JSON.stringify(kind === "law" ? { BILL_MEASURES_SYSTEM, prompt, model, schema: billMeasuresJsonSchema } : { system, prompt, model, schema: billMeasuresJsonSchema }))
    .digest("hex");
  const cached = process.argv.includes("--force")
    ? undefined
    : ((
        await db.execute(sql`
          SELECT payload, actor FROM audit_log WHERE action = 'consultation.propose_measures' AND subject_id = ${cons.id}
            AND payload->>'callHash' = ${callHash} ORDER BY created_at DESC LIMIT 1`)
      ).rows[0] as { payload: { details: unknown }; actor: string } | undefined);
  const t0 = Date.now();
  let measures;
  let actor: string;
  if (cached) {
    ({ measures } = billMeasuresOutput.parse({ measures: cached.payload.details }));
    actor = cached.actor;
    console.log(`${measures.length} measures (cached cut — --force to ask the LLM again):`);
  } else {
    const res = await new AgentSdkProvider().generateStructured({ system, prompt, schema: billMeasuresJsonSchema, model });
    ({ measures } = billMeasuresOutput.parse(res.output));
    actor = `ai-editor:${res.provenance.model}`;
    console.log(`${measures.length} measures in ${((Date.now() - t0) / 1000).toFixed(0)}s:`);
  }
  for (const m of measures) {
    console.log(`  - ${m.name}  [${[kind === "law" ? `§ ${m.paragraphs.join(", ")}` : "", ...m.other].filter(Boolean).join(" · ")}]\n      ${m.description}`);
  }
  // A section number must belong to one measure only — otherwise the code
  // pre-assignment by "§ N" would be ambiguous (jev-classify skips those).
  const owners = new Map<number, string[]>();
  for (const m of measures) for (const p of m.paragraphs) owners.set(p, [...(owners.get(p) ?? []), m.name]);
  const shared = [...owners.entries()].filter(([, o]) => o.length > 1);
  if (shared.length) console.log(`sections in several measures (no pre-assignment): ${shared.map(([p]) => `§ ${p}`).join(", ")}`);

  await db.execute(sql`
    INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
    VALUES (${cons.tenantId}, ${actor}, 'consultation.propose_measures',
            'consultation', ${cons.id},
            ${JSON.stringify({ measures: measures.map((m) => m.name), details: measures, callHash, cached: !!cached, source: { document: doc.filename, kind, chars: law.length } })})
  `);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
