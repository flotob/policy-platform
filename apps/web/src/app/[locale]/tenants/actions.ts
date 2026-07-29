"use server";

import { revalidatePath } from "next/cache";
import { auditLog, tenants } from "@policy/db";
import { z } from "zod";

import { getDb } from "@/lib/db";

const createTenantInput = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "invalid slug"),
});

export async function createTenant(formData: FormData) {
  const input = createTenantInput.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  const db = getDb();
  const [tenant] = await db
    .insert(tenants)
    .values({ name: input.name, slug: input.slug })
    .returning();
  if (!tenant) throw new Error("tenant insert returned no row");
  await db.insert(auditLog).values({
    tenantId: tenant.id,
    // TODO(auth): replace with the authenticated principal once OIDC lands.
    actor: "system:scaffold",
    action: "tenant.create",
    subjectKind: "tenant",
    subjectId: tenant.id,
    payload: { name: tenant.name, slug: tenant.slug },
  });
  revalidatePath("/[locale]/tenants", "page");
}
