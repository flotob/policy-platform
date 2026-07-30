"use server";

import { revalidatePath } from "next/cache";
import { auditLog, eq, points } from "@policy/db";
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
