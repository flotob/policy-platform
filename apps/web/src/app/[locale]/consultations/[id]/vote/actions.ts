"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sql } from "@policy/db";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { PARTICIPANT_COOKIE } from "./participant";

const input = z.object({
  statementId: z.uuid(),
  value: z.coerce.number().pipe(z.union([z.literal(-1), z.literal(0), z.literal(1)])),
});

export async function castVote(formData: FormData) {
  const { statementId, value } = input.parse({
    statementId: formData.get("statementId"),
    value: formData.get("value"),
  });
  const db = getDb();

  // Only released statements are votable — a rejected/draft id 404s here.
  const stRes = await db.execute(sql`
    SELECT st.id, st.tenant_id, p.consultation_id
    FROM statements st JOIN points p ON p.id = st.point_id
    WHERE st.id = ${statementId} AND st.status = 'released'
  `);
  if (stRes.rows.length === 0) throw new Error("statement not votable");
  const st = stRes.rows[0] as {
    id: string;
    tenant_id: string;
    consultation_id: string;
  };

  const cookieStore = await cookies();
  let token = cookieStore.get(PARTICIPANT_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    token = randomUUID();
    cookieStore.set(PARTICIPANT_COOKIE, token, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
  }

  const pRes = await db.execute(sql`
    INSERT INTO participants (tenant_id, consultation_id, source_ref)
    VALUES (${st.tenant_id}, ${st.consultation_id}, ${`web:${token}`})
    ON CONFLICT (consultation_id, source_ref)
    DO UPDATE SET source_ref = EXCLUDED.source_ref
    RETURNING id
  `);
  const participantId = (pRes.rows[0] as { id: string }).id;

  await db.execute(sql`
    INSERT INTO votes (tenant_id, participant_id, statement_id, value)
    VALUES (${st.tenant_id}, ${participantId}, ${st.id}, ${value})
    ON CONFLICT (participant_id, statement_id)
    DO UPDATE SET value = EXCLUDED.value
  `);

  revalidatePath("/[locale]/consultations/[id]/vote", "page");
}
