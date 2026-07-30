/**
 * Statement generation: released point → neutral votable statement (de + en).
 *
 * Statements land as DRAFT — the machine proposes, editors release (same
 * trust architecture as points). Only released statements enter voting and
 * the analysis matrix, so a bad generation can never reach participants.
 */

import { auditLog, eq, points, pointSources, statements, type Db } from "@policy/db";
import type { LlmProvider } from "@policy/llm";

import { STATEMENT_SYSTEM, statementPrompt } from "./prompts.ts";
import { statementJsonSchema, statementOutput } from "./schemas.ts";

export interface StatementRunResult {
  pointId: string;
  locales: string[];
}

export async function generateStatementsForPoint(
  db: Db,
  provider: LlmProvider,
  pointId: string,
  model?: string,
): Promise<StatementRunResult> {
  const [point] = await db.select().from(points).where(eq(points.id, pointId));
  if (!point) throw new Error(`point ${pointId} not found`);
  if (point.status !== "released") {
    throw new Error(`point ${pointId} is ${point.status}, not released`);
  }

  const sources = await db
    .select({ quote: pointSources.quote })
    .from(pointSources)
    .where(eq(pointSources.pointId, pointId));

  const generated = await provider.generateStructured({
    system: STATEMENT_SYSTEM,
    prompt: statementPrompt({
      label: point.label,
      summary: point.summary,
      kind: point.kind,
      quotes: sources.map((s) => s.quote).filter((q): q is string => !!q),
    }),
    schema: statementJsonSchema,
    model,
  });
  const parsed = statementOutput.parse(generated.output);
  const method = `${generated.provenance.provider}:${generated.provenance.model}`;

  const locales: ("de" | "en")[] = ["de", "en"];
  for (const locale of locales) {
    await db.insert(statements).values({
      tenantId: point.tenantId,
      pointId: point.id,
      locale,
      text: parsed[locale],
      status: "draft",
    });
  }

  await db.insert(auditLog).values({
    tenantId: point.tenantId,
    actor: method,
    action: "statement.generate",
    subjectKind: "point",
    subjectId: point.id,
    payload: { de: parsed.de, en: parsed.en, provenance: generated.provenance },
  });

  return { pointId, locales };
}
