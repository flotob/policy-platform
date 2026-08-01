"use server";

import { revalidatePath } from "next/cache";
import { and, auditLog, eq, points, sql, statements } from "@policy/db";
import { z } from "zod";

import { getDb } from "@/lib/db";

const input = z.object({
  pointId: z.uuid(),
  decision: z.enum(["released", "rejected"]),
  reason: z.string().trim().max(500).optional(),
});

export async function reviewPoint(formData: FormData) {
  const { pointId, decision, reason } = input.parse({
    pointId: formData.get("pointId"),
    decision: formData.get("decision"),
    reason: formData.get("reason") || undefined,
  });
  const db = getDb();
  const [point] = await db
    .update(points)
    .set({ status: decision })
    .where(eq(points.id, pointId))
    .returning();
  if (!point) throw new Error("point not found");
  await db.insert(auditLog).values({
    tenantId: point.tenantId,
    // TODO(auth): the authenticated editor once OIDC lands.
    actor: "editor:local",
    action: `point.${decision === "released" ? "release" : "reject"}`,
    subjectKind: "point",
    subjectId: point.id,
    reason: reason ?? null,
    payload: { label: point.label, kind: point.kind },
  });
  revalidatePath("/[locale]/consultations/[id]/review", "page");
}

const findingInput = z.object({
  pointId: z.uuid(),
  finding: z.string().trim().max(2000),
});

/** Save the editorial finding (Befund) shown on the map's detail panel. */
export async function saveFinding(formData: FormData) {
  const { pointId, finding } = findingInput.parse({
    pointId: formData.get("pointId"),
    finding: formData.get("finding") ?? "",
  });
  const db = getDb();
  const [point] = await db
    .update(points)
    .set({ finding: finding || null })
    .where(eq(points.id, pointId))
    .returning();
  if (!point) throw new Error("point not found");
  await db.insert(auditLog).values({
    tenantId: point.tenantId,
    actor: "editor:local",
    action: "point.finding",
    subjectKind: "point",
    subjectId: point.id,
    payload: { finding: finding || null },
  });
  revalidatePath("/[locale]/consultations/[id]/review", "page");
}

const bulkInput = z.object({ consultationId: z.uuid() });

export async function releaseAllDraftPoints(formData: FormData) {
  const { consultationId } = bulkInput.parse({
    consultationId: formData.get("consultationId"),
  });
  const db = getDb();
  const released = await db
    .update(points)
    .set({ status: "released" })
    .where(and(eq(points.consultationId, consultationId), eq(points.status, "draft")))
    .returning({ id: points.id, tenantId: points.tenantId });
  if (released.length > 0) {
    await db.insert(auditLog).values({
      tenantId: released[0]!.tenantId,
      // TODO(auth): the authenticated editor once OIDC lands.
      actor: "editor:local",
      action: "point.release_bulk",
      subjectKind: "consultation",
      subjectId: consultationId,
      payload: { count: released.length },
    });
  }
  revalidatePath("/[locale]/consultations/[id]/review", "page");
}

const statementInput = z.object({
  pointId: z.uuid(),
  decision: z.enum(["released", "rejected"]),
});

/** Release/reject a point's draft statements (all locales at once). */
export async function reviewStatements(formData: FormData) {
  const { pointId, decision } = statementInput.parse({
    pointId: formData.get("pointId"),
    decision: formData.get("decision"),
  });
  const db = getDb();
  // All locales of the point transition together, from any prior status —
  // the workbench allows withdrawing and re-releasing.
  const updated = await db
    .update(statements)
    .set({ status: decision })
    .where(eq(statements.pointId, pointId))
    .returning({ id: statements.id, tenantId: statements.tenantId, locale: statements.locale });
  if (updated.length > 0) {
    await db.insert(auditLog).values({
      tenantId: updated[0]!.tenantId,
      actor: "editor:local",
      action: `statement.${decision === "released" ? "release" : "reject"}`,
      subjectKind: "point",
      subjectId: pointId,
      payload: { locales: updated.map((s) => s.locale) },
    });
  }
  revalidatePath("/[locale]/consultations/[id]/review", "page");
}

export async function releaseAllDraftStatements(formData: FormData) {
  const { consultationId } = bulkInput.parse({
    consultationId: formData.get("consultationId"),
  });
  const db = getDb();
  const res = await db.execute(sql`
    UPDATE statements st SET status = 'released'
    FROM points p
    WHERE p.id = st.point_id AND p.consultation_id = ${consultationId}
      AND st.status = 'draft'
    RETURNING st.tenant_id
  `);
  if (res.rows.length > 0) {
    await db.insert(auditLog).values({
      tenantId: (res.rows[0] as { tenant_id: string }).tenant_id,
      actor: "editor:local",
      action: "statement.release_bulk",
      subjectKind: "consultation",
      subjectId: consultationId,
      payload: { count: res.rows.length },
    });
  }
  revalidatePath("/[locale]/consultations/[id]/review", "page");
}
