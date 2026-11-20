"use server";

import { revalidatePath } from "next/cache";

import {
  cleanUrl,
  IMAGE_MAX,
  kommuneById,
  LIMITS,
  LINKS_MAX,
  LOGO_MAX,
  LOGO_TYPES,
  photoType,
  saveImage,
  saveLogo,
  saveSettings,
  type ImageKind,
  type KommuneLink,
  type KommuneSettings,
} from "@/lib/kommune";
import { requireInitiator } from "@/lib/session";
import { looksLikeEmail } from "@/lib/team";

import type { ActionState } from "./actions";

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fields = (f: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, field(f, k)])) as Record<string, string>;
const tooLong = (v: string, max: number) => [...v].length > max;

async function current(tenantId: string) {
  const k = await kommuneById(tenantId);
  if (!k) throw new Error("Kommune nicht gefunden");
  return k;
}

export async function saveKommune(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const values = fields(form, ["name", "stelle", "email", "telefon", "zeiten", "website", "impressum", "datenschutz"]);
  if (values.name!.length < 3) return { error: "Bitte geben Sie den Namen der Kommune an.", values };
  if (values.email && !looksLikeEmail(values.email)) return { error: "Die E-Mail-Adresse sieht nicht vollständig aus.", values };
  if (tooLong(values.zeiten!, LIMITS.zeiten)) return { error: `„Erreichbar“ hat höchstens ${LIMITS.zeiten} Zeichen.`, values };
  const urls: Record<string, string> = {};
  for (const [k, label] of [["website", "Website"], ["impressum", "Impressum"], ["datenschutz", "Datenschutzerklärung"]] as const) {
    const u = cleanUrl(values[k]!);
    if (u === null) return { error: `Der Link zu „${label}“ ist keine gültige Webadresse.`, values };
    urls[k] = u;
  }
  const k = await current(staff.tenant.id);
  const s: KommuneSettings = {
    ...k.settings,
    kontakt: { stelle: values.stelle!, email: values.email!.toLowerCase(), telefon: values.telefon!, zeiten: values.zeiten! },
    website: urls.website!,
    impressum: urls.impressum!,
    datenschutz: urls.datenschutz!,
  };
  await saveSettings(staff.tenant.id, values.name!, s, staff.user.id);
  revalidatePath("/", "layout");
  return { ok: "Gespeichert." };
}

const LINK_KEYS = Array.from({ length: LINKS_MAX }, (_, i) => [`link_label_${i}`, `link_url_${i}`]).flat();

/** The town introduces itself: one line under the name, a greeting, links. */
export async function saveProfil(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const values = fields(form, ["claim", "gruss_text", "gruss_name", "gruss_amt", ...LINK_KEYS]);
  for (const [key, max, label] of [
    ["claim", LIMITS.claim, "Der Satz unter dem Namen"],
    ["gruss_text", LIMITS.gruss, "Das Wort vorab"],
    ["gruss_name", LIMITS.name, "Der Name"],
    ["gruss_amt", LIMITS.amt, "Die Funktion"],
  ] as const) {
    if (tooLong(values[key]!, max)) return { error: `${label} hat höchstens ${max} Zeichen.`, values };
  }
  if (values.gruss_text && !values.gruss_name) return { error: "Bitte sagen Sie, wer das Wort vorab spricht.", values };
  const links: KommuneLink[] = [];
  for (let i = 0; i < LINKS_MAX; i++) {
    const label = values[`link_label_${i}`]!;
    const raw = values[`link_url_${i}`]!;
    if (!label && !raw) continue;
    if (!label || !raw) return { error: `Link ${i + 1}: Bitte Bezeichnung und Adresse angeben.`, values };
    if (tooLong(label, LIMITS.label)) return { error: `Link ${i + 1}: Die Bezeichnung hat höchstens ${LIMITS.label} Zeichen.`, values };
    const url = cleanUrl(raw);
    if (!url) return { error: `Link ${i + 1}: „${raw}“ ist keine gültige Webadresse.`, values };
    links.push({ label, url });
  }
  const k = await current(staff.tenant.id);
  const s: KommuneSettings = {
    ...k.settings,
    claim: values.claim!,
    gruss: { text: values.gruss_text!, name: values.gruss_name!, amt: values.gruss_amt! },
    links,
  };
  await saveSettings(staff.tenant.id, k.name, s, staff.user.id);
  revalidatePath("/", "layout");
  return { ok: "Gespeichert." };
}

const IMAGE_WORDS: Record<ImageKind, { name: string; max: string }> = {
  titelbild: { name: "Titelbild", max: "5 MB" },
  portrait: { name: "Foto", max: "1 MB" },
};

/** Title photo (with its credit and description) or the greeting's portrait: upload, replace, remove. */
export async function uploadTitelbild(prev: ActionState, form: FormData): Promise<ActionState> {
  return uploadImage("titelbild", prev, form);
}

export async function uploadPortrait(prev: ActionState, form: FormData): Promise<ActionState> {
  return uploadImage("portrait", prev, form);
}

async function uploadImage(kind: ImageKind, _prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireInitiator();
  const w = IMAGE_WORDS[kind];
  const k = await current(staff.tenant.id);
  if (form.get("entfernen")) {
    await saveImage(staff.tenant.id, kind, null, null, staff.user.id);
    revalidatePath("/", "layout");
    return { ok: `${w.name} entfernt.` };
  }
  const values = kind === "titelbild" ? fields(form, ["credit", "alt"]) : {};
  if (kind === "titelbild") {
    if (tooLong(values.credit!, LIMITS.credit)) return { error: `Der Bildnachweis hat höchstens ${LIMITS.credit} Zeichen.`, values };
    if (tooLong(values.alt!, LIMITS.alt)) return { error: `Die Bildbeschreibung hat höchstens ${LIMITS.alt} Zeichen.`, values };
  }
  const file = form.get("bild");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !(kind === "titelbild" && k.titelbild)) return { error: "Bitte wählen Sie ein Bild.", values };
  if (hasFile) {
    if (file.size > IMAGE_MAX[kind]) return { error: `Das Bild ist größer als ${w.max}.`, values };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = photoType(bytes);
    if (!type) return { error: "Bitte ein Foto als JPG, PNG oder WebP.", values };
    await saveImage(staff.tenant.id, kind, bytes, type, staff.user.id);
  }
  if (kind === "titelbild") {
    await saveSettings(staff.tenant.id, k.name, { ...k.settings, titelbild: { credit: values.credit!, alt: values.alt! } }, staff.user.id);
  }
  revalidatePath("/", "layout");
  return { ok: hasFile ? `${w.name} gespeichert.` : "Gespeichert." };
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
