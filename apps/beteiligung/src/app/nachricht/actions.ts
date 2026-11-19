"use server";

import { redirect } from "next/navigation";

import { checkSignature, confirmFollower, unsubscribe } from "@/lib/folgen";

/** Confirm or unsubscribe by button, not by opening the link: mail scanners open links, they do not press buttons. */
export async function answer(id: string, purpose: "bestaetigen" | "abmelden", token: string): Promise<void> {
  if (!checkSignature(id, purpose, token)) redirect("/nachricht?fehler=1");
  if (purpose === "bestaetigen") await confirmFollower(id);
  else await unsubscribe(id);
  redirect(`/nachricht?id=${id}&a=${purpose}&t=${token}&fertig=1`);
}
