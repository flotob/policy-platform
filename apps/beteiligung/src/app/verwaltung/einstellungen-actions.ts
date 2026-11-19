"use server";

import { revalidatePath } from "next/cache";

import { cleanUrl, LOGO_MAX, LOGO_TYPES, saveLogo, saveSettings, type KommuneSettings } from "@/lib/kommune";
import { requireInitiator } from "@/lib/session";
import { looksLikeEmail } from "@/lib/team";

import type { ActionState } from "./actions";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveKommune(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const values = Object.fromEntries(["name", "stelle", "email", "telefon", "website", "impressum", "datenschutz"].map((k) => [k, field(form, k)]));
  if (values.name!.length < 3) return { error: "Bitte geben Sie den Namen der Kommune an.", values };
  if (values.email && !looksLikeEmail(values.email)) return { error: "Die E-Mail-Adresse sieht nicht vollständig aus.", values };
  const urls: Record<string, string> = {};
  for (const [k, label] of [["website", "Website"], ["impressum", "Impressum"], ["datenschutz", "Datenschutzerklärung"]] as const) {
    const u = cleanUrl(values[k]!);
    if (u === null) return { error: `Der Link zu „${label}“ ist keine gültige Webadresse.`, values };
    urls[k] = u;
  }
  const s: KommuneSettings = {
    kontakt: { stelle: values.stelle!, email: values.email!.toLowerCase(), telefon: values.telefon! },
    website: urls.website!,
    impressum: urls.impressum!,
    datenschutz: urls.datenschutz!,
  };
  await saveSettings(staff.tenant.id, values.name!, s, staff.user.id);
  revalidatePath("/", "layout");
  return { ok: "Gespeichert." };
}

export async function uploadLogo(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  if (form.get("entfernen")) {
    await saveLogo(staff.tenant.id, null, null, staff.user.id);
    revalidatePath("/", "layout");
    return { ok: "Logo entfernt." };
  }
  const file = form.get("logo");
  if (!(file instanceof File) || !file.size) return { error: "Bitte wählen Sie eine Datei." };
  if (!LOGO_TYPES[file.type]) return { error: "Bitte ein Logo als PNG, JPG, WebP oder SVG." };
  if (file.size > LOGO_MAX) return { error: "Das Logo ist größer als 500 KB." };
  await saveLogo(staff.tenant.id, new Uint8Array(await file.arrayBuffer()), file.type, staff.user.id);
  revalidatePath("/", "layout");
  return { ok: "Logo gespeichert." };
}
