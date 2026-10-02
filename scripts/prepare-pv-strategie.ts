/**
 * Prepare the PV-Strategie 2023 export (BMWK, 496 statements) for import.
 * One-off data hygiene before import-harvest.ts / import-documents.ts:
 *
 *  - names from the ministry's own list ("Liste der veröffentlichten
 *    Stellungnahmen", part of the export) instead of file names;
 *  - private persons (the list puts them last, from no. 238 on) become
 *    "Privatperson N" — their names never reach the database; in their texts
 *    names, e-mail addresses, phone numbers and street addresses are masked;
 *  - contact persons appended to an organisation's name are dropped;
 *  - the ministry's e-mail print header (clerk, sender address) is stripped;
 *  - the same sender twice (duplicates, "Nachtrag") becomes one statement;
 *  - scanned PDFs without a text layer get their OCR text (<documents>/ocr/NNN.txt);
 *  - the draft strategy (subject of the consultation) and the final strategy
 *    become consultation documents.
 *
 * Usage:
 *   tsx scripts/prepare-pv-strategie.ts <export-dir> <documents-dir> <out-dir>
 * Writes <out-dir>/consultation.json, responses.jsonl, documents.jsonl.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Response {
  source_response_id: string;
  author_org: string;
  author_type: string | null;
  language: string | null;
  submitted_at: string | null;
  text: string | null;
  pii_status: string;
  attachments: { filename: string; extracted_text: string | null }[];
}

/** From this list number on, the ministry lists private persons. */
const FIRST_PRIVATE = 238;

/** Official names that carry a contact person, an MP's role, or a typo. */
const NAME_FIX: Record<string, string> = {
  "017": "MdL Martin Hahn (GRÜNE, Landtag von Baden-Württemberg)",
  "018": "MdL Gregor Kaiser (Landtag von Nordrhein-Westfalen)",
  "019": "MdL Dorothea Frederking (Landtag von Sachsen-Anhalt)",
  "020": "Arbeitskreis Umwelt und Energie der Gemeinde Finsing",
  "021": "Energieagentur Kreis Konstanz gGmbH",
  "022": "Kreisvorstand Rhein-Hunsrück",
  "023": "Gemeinde St. Leon-Rot",
  "024": "Stadt Remscheid, Fachdienst Stadtentwicklung",
  "026": "Regionale Planungsgemeinschaft Harz",
  "027": "Kreis- und Hochschulstadt Meschede, Fachbereich Planung und Bauordnung",
  "028": "Landratsamt Freising, Energiebeauftragter",
  "029": "Samtgemeinderat Elbtalaue, Gemeinderat Neu Darchau",
  "072": "MdB Mathias Papendieck (Deutscher Bundestag)",
  "073": "MdB Dr. Jörg Lange (Deutscher Bundestag)",
  "079": "SPD – Arbeitsgruppe Wirtschaft",
  "087": "German Zero FG Energie",
  "097": "DGS – Deutsche Gesellschaft für Sonnenenergie (Einzelbeitrag)",
  "105": "Bund Deutscher Forstleute, NRW",
  "108": "Fraunhofer-Institut für Solare Energiesysteme ISE",
  "109": "Fraunhofer-Institut für Energiewirtschaft und Energiesystemtechnik IEE",
  "116": "SEGRO Germany GmbH",
  "117": "HEBERGER GmbH",
  "120": "Fachanwalt für Bau- und Architektenrecht (QVSD e. V.)",
  "121": "HOK Steuerberater",
  "122": "HEUSSEN Rechtsanwaltsgesellschaft mbH",
  "177": "LEAG – Lausitz Energie Bergbau AG / Lausitz Energie Kraftwerke AG",
  "205": "Unabhängiger Energieökonom und Rohstoffhändler",
  "212": "DFMG",
};

/** Kind of sender, from the list's order (with the exceptions named). */
function senderType(n: number): string {
  if (n >= FIRST_PRIVATE) return "PRIVATE";
  if ([17, 18, 19, 22, 72, 73, 76, 77, 78, 79].includes(n)) return "POLITICS";
  if (n <= 16 || (n >= 20 && n <= 29) || n === 71) return "PUBLIC_AUTHORITY";
  if (n >= 107 && n <= 115) return "RESEARCH";
  if (n >= 116 && n !== 161) return "COMPANY";
  return "ASSOCIATION";
}

function parseList(text: string): Map<string, string> {
  const names = new Map<string, string[]>();
  let cur: string | null = null;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (/^\d{3}$/.test(l)) {
      cur = l;
      names.set(cur, []);
      continue;
    }
    if (!cur || !l || l === "Nr." || l === "Bezeichnung der Eingebenden" || /^\d{1,2}$/.test(l)) continue;
    names.get(cur)!.push(l);
  }
  return new Map([...names].map(([k, v]) => [k, v.join(" ").replace(/\s+/g, " ").trim()]));
}

/** Same sender: case, punctuation, "e. V." and a leading "Nachtrag" do not count. */
function senderKey(name: string): string {
  return name
    .replace(/^Nachtrag\s+/i, "")
    .toLowerCase()
    .replace(/\be\.\s*v\.?/g, "")
    .replace(/[^a-z0-9äöüß]+/g, "");
}

/** The ministry's e-mail print header: clerk line, sender, date, recipient, category. */
function stripMailHeader(text: string): string {
  return text
    .replace(/^[^\n,]{2,40}, [^\n,]{2,30}, IIIB\d[ \t]*$/gm, "")
    .replace(/Von:[ \t]*\n[^\n]*\n\s*Gesendet:[ \t]*\n[^\n]*\n\s*An:[ \t]*\n[^\n]*\n(?:\s*Cc:[ \t]*\n(?:(?!\s*Betreff:)[^\n]*\n)?)?/g, "")
    .replace(/Kategorien:[ \t]*\n[^\n]*Erfasst[^\n]*\n/g, "")
    // Quoted and forwarded mails: who wrote to whom.
    .replace(/^([ \t]*(?:Von|From|An|To|Cc|Gesendet|Sent)[ \t]*:)[ \t]*\S[^\n]*$/gim, "$1 […]");
}

/** Also an address broken across a line ("name@\ndomain.de"). */
const EMAIL = /[\w.+-]+@(?:[ \t]*\n[ \t]*)?[\w-]+(?:\.[\w-]+)*/g;
const PHONE = [
  /\+49[\d\s/().-]{6,}\d/g,
  /\b(?:Tel\.?|Telefon|Fax|Mobil|Mobile|Handy|Mob\.|Festnetz|Phone|Fon|T|F|M)[ \t]*[:.][ \t]*[+\d(][\d \t/().-]{5,}\d/gi,
];
/** Signatory lists of a petition: "Vorname Nachname, Beruf aus Ort". */
const SIGNATORY = /^([ \t\uf0b7•*-]*)[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)+,(?=[^\n]* aus )/gm;
/** A name on the line after a bullet (signatory lists). */
const BULLET_NAME = /([\uf0b7•][ \t]*\n[ \t]*)(?:(?:Dr\.|Prof\.|Dipl\.-Ing\.)[ \t]*)*[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+){1,3}/g;
/** Phone numbers without a label — only in private persons' letters (too eager for reports full of figures). */
const BARE_PHONE = /\b0\d{2,4}[ \t/-]+\d[\d \t-]{4,}\d\b/g;
const STREET = /\b[A-ZÄÖÜ][\wäöüß.-]*(?:straße|strasse|str\.|weg|gasse|allee|platz|ring|damm)\s+\d+[ \t]*[a-z]?\b/gi;
const PLZ_TOWN = /\b\d{5}[ \t]+[A-ZÄÖÜ][\wäöüß-]+/g;
/** Letterhead and signature: where names and addresses sit in a letter. */
const ZONE = 600;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mask a private person's name and contact data. A name part that is also an
 * ordinary word elsewhere in the corpus ("Winter", "Ohm") is masked only as
 * part of the full name or in letterhead and signature.
 */
function maskPrivate(text: string, name: string, common: (token: string) => boolean): string {
  const tokens = name
    .split(/[\s,]+/)
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t.length >= 3 && !/^(von|van|der|den|Anonym)$/i.test(t));
  let out = text;
  if (tokens.length >= 2) {
    const alt = tokens.map(escapeRe).join("|");
    // Full name in any order, with an optional initial in between.
    out = out.replace(new RegExp(`\\b(?:${alt})(?:[ \\t,]+(?:[A-ZÄÖÜ]\\.[ \\t]*)?(?:${alt}))+\\b`, "g"), "[Name]");
  }
  for (const t of tokens) {
    const re = new RegExp(`\\b${escapeRe(t)}\\b`, "g");
    if (!common(t)) {
      out = out.replace(re, "[Name]");
    } else if (out.length > 2 * ZONE) {
      out = out.slice(0, ZONE).replace(re, "[Name]") + out.slice(ZONE, -ZONE) + out.slice(-ZONE).replace(re, "[Name]");
    } else {
      out = out.replace(re, "[Name]");
    }
  }
  const zone = (s: string) => s.replace(STREET, "[Adresse]").replace(PLZ_TOWN, "[Ort]");
  out = out.length > 2 * ZONE ? zone(out.slice(0, ZONE)) + out.slice(ZONE, -ZONE) + zone(out.slice(-ZONE)) : zone(out);
  return out;
}

function main() {
  const [, , exportDir, docsDir, outDir] = process.argv;
  if (!exportDir || !docsDir || !outDir) throw new Error("usage: prepare-pv-strategie.ts <export-dir> <documents-dir> <out-dir>");
  const meta = JSON.parse(readFileSync(join(exportDir, "consultation.json"), "utf-8"));
  const rows: Response[] = readFileSync(join(exportDir, "responses.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  const listRow = rows.find((r) => r.author_org.startsWith("Liste der"));
  if (!listRow) throw new Error("the ministry's list of statements is missing from the export");
  const official = parseList(listRow.attachments[0]!.extracted_text ?? "");

  // Texts, OCR where the PDF has no text layer.
  const items = rows
    .filter((r) => r !== listRow)
    .map((r) => {
      const no = r.author_org.slice(0, 3);
      if (!/^\d{3}$/.test(no) || !official.has(no)) throw new Error(`no list entry for "${r.author_org}"`);
      let text = r.attachments.map((a) => a.extracted_text ?? "").join("\n\n");
      let ocr = false;
      if (text.trim().length < 50) {
        const f = join(docsDir, "ocr", `${no}.txt`);
        if (!existsSync(f)) throw new Error(`no text and no OCR for ${no} (${f})`);
        text = readFileSync(f, "utf-8");
        ocr = true;
      }
      return { r, no, n: Number(no), name: official.get(no)!, text: stripMailHeader(text), ocr };
    });

  // A name part is an ordinary word if other statements use it too.
  const docFreq = new Map<string, number>();
  for (const it of items) for (const w of new Set(it.text.match(/[A-Za-zÄÖÜäöüß-]{3,}/g) ?? [])) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  const common = (t: string) => (docFreq.get(t) ?? 0) >= 4;

  // Group by sender; private persons are numbered in list order.
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const isPrivate = it.n >= FIRST_PRIVATE;
    const display = isPrivate ? null : (NAME_FIX[it.no] ?? it.name);
    // Anonymous senders are distinct people; everyone else is keyed by name.
    const key = isPrivate ? (/^Anonym$/i.test(it.name) ? `anon:${it.no}` : `p:${senderKey(it.name)}`) : `o:${senderKey(display!)}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  const out: unknown[] = [];
  let privateNo = 0;
  const merged: string[] = [];
  const leftovers: string[] = [];
  for (const [key, its] of groups) {
    const first = its[0]!;
    const isPrivate = first.n >= FIRST_PRIVATE;
    const contact = (t: string) => PHONE.reduce((acc, re) => acc.replace(re, "[Telefon]"), t.replace(EMAIL, "[E-Mail]"));
    const texts = [...new Set(its.map((i) => (isPrivate ? maskPrivate(contact(i.text).replace(BARE_PHONE, "[Telefon]"), i.name, common).replace(SIGNATORY, "$1[Name],").replace(BULLET_NAME, "$1[Name]") : contact(i.text))))];
    let text = texts.join("\n\n");
    text = text.replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, "\n\n");
    const authorOrg = isPrivate ? `Privatperson ${++privateNo}` : (NAME_FIX[first.no] ?? first.name);
    if (its.length > 1) merged.push(`${its.map((i) => i.no).join("+")} → ${isPrivate ? authorOrg : authorOrg}${texts.length < its.length ? " (identical text kept once)" : ""}`);
    if (isPrivate) {
      for (const t of first.name.split(/[\s,]+/).filter((t) => t.length >= 3 && !/^Anonym$/i.test(t))) {
        if (new RegExp(`\\b${escapeRe(t)}\\b`).test(text)) leftovers.push(`${authorOrg}: "${t}" left in the body (ordinary word)`);
      }
    }
    out.push({
      source_response_id: first.r.source_response_id,
      author_org: authorOrg,
      author_type: senderType(first.n),
      language: "de",
      submitted_at: null,
      text,
      pii_status: isPrivate ? "masked" : "none",
      attachments: [],
      list_numbers: its.map((i) => i.no),
      ocr: its.some((i) => i.ocr),
    });
    void key;
  }

  // The draft is what the consultation asked about; the final version is the outcome.
  const tidy = (t: string) => t.replace(/(?:[ \t]*\.){5,}/g, " ").replace(/\n{3,}/g, "\n\n");
  const docs = [
    {
      kind: "strategie:Entwurf",
      filename: "pv-strategie-2023-entwurf.pdf",
      source_url:
        "https://www.bundeswirtschaftsministerium.de/Redaktion/DE/Publikationen/Energie/photovoltaik-stategie-2023-entwurf.pdf?__blob=publicationFile&v=14",
      extracted_text: tidy(readFileSync(join(docsDir, "pv-strategie-2023-entwurf.txt"), "utf-8")),
    },
    {
      kind: "strategie:Endfassung",
      filename: "pv-strategie-2023-final.pdf",
      source_url:
        "https://www.bundeswirtschaftsministerium.de/Redaktion/DE/Publikationen/Energie/photovoltaik-stategie-2023.pdf?__blob=publicationFile",
      extracted_text: tidy(readFileSync(join(docsDir, "pv-strategie-2023-final.txt"), "utf-8")),
    },
  ];

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "consultation.json"), JSON.stringify({ ...meta, title: "Photovoltaik-Strategie 2023 (BMWK, öffentliche Konsultation)" }, null, 2));
  writeFileSync(join(outDir, "responses.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
  writeFileSync(join(outDir, "documents.jsonl"), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");

  const byType = new Map<string, number>();
  for (const o of out as { author_type: string }[]) byType.set(o.author_type, (byType.get(o.author_type) ?? 0) + 1);
  console.log(`${items.length} statements → ${out.length} senders (${privateNo} private persons)`);
  console.log(`by kind: ${[...byType].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`OCR: ${items.filter((i) => i.ocr).map((i) => i.no).join(", ")}`);
  console.log(`merged:\n  ${merged.join("\n  ")}`);
  console.log(`name parts left in private texts: ${leftovers.length}${leftovers.length ? "\n  " + leftovers.join("\n  ") : ""}`);
}

main();
