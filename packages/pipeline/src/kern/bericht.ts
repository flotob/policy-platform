/**
 * Module R of the Gesamtmodell: the report.
 *
 *   R1  the binding list of conclusions — sentence templates over the result
 *       object, each with an ID, the statements it points to and its numbers.
 *       No AI.
 *   R2  the language model turns the list into readable text; every paragraph
 *       names the sentence IDs it renders. Forbidden: change, weaken, turn
 *       around, add.
 *   R3  the check: rules in code (every paragraph traceable, every sentence
 *       rendered, no number or statement that is not in its sentences) and a
 *       second, independent reader — Jev, a different model — on fidelity,
 *       direction and strength. Both must pass; otherwise R2 again.
 *   R4  the editors release or reject (the app); they cannot change a sentence.
 *
 * Also here: the camp names, which the language model proposes and the
 * editors confirm.
 */

import { noul, type JevJudge, type LlmProvider } from "@policy/llm";
import { z } from "zod";

import type { Ergebnis, StatementOut } from "./befund.ts";
import {
  campLabel,
  conclusionText,
  diagnosisText,
  evidenceText,
  headline,
  pct,
  stepText,
  word,
  type CampNames,
} from "./befund-text.ts";

// ———— R1 ————

export const SECTIONS = {
  ergebnis: "Das Wichtigste",
  beteiligung: "Wer sich beteiligt hat",
  einig: "Worauf sich die Lager einigen",
  warnung: "Vorsicht, Scheinkonsens",
  rat: "Was der Rat entscheiden muss",
  klaeren: "Was sich klären lässt",
  schritte: "Die Begründung Schritt für Schritt",
  luecken: "Was niemand gefragt hat",
  belastbarkeit: "Wie belastbar das Ergebnis ist",
} as const;
export type SectionKey = keyof typeof SECTIONS;

export interface Satz {
  id: string;
  section: SectionKey;
  text: string;
  /** Statement numbers the sentence points to ([A12]). */
  refs: number[];
}

export interface ReportContext {
  town: string;
  measure: string;
  questions: { key: string; label: string }[];
  fictional: boolean;
  editorialMode: "mensch" | "assistiert" | "ki";
  resultVersion: number;
  descriptions?: (string | null)[] | null;
}

const ref = (s: StatementOut) => `„${s.text}“ [A${s.nr}]`;
const fmt = (n: number) => n.toLocaleString("de-DE");
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);
const shares = (s: StatementOut, names: CampNames, field: "agree" | "disagree" = "agree") =>
  s.camps.map((c, g) => `${pct(c[field], c.seen)} % im ${campLabel(names, g)}`).join(", ");

/** R1: the sentences, in report order. Templates only — the same result always gives the same list. */
export function conclusions(r: Ergebnis, names: CampNames, ctx: ReportContext): Satz[] {
  const out: Omit<Satz, "id">[] = [];
  const add = (section: SectionKey, text: string, refs: number[] = []) => out.push({ section, text, refs });
  const k = r.camps?.k ?? 0;
  const by = (nr: number) => r.statements.find((s) => s.nr === nr)!;

  // Das Wichtigste
  const h = headline(r);
  add("ergebnis", h.lead, r.statements.filter((s) => s.profile === "getragen" || s.profile === "abgelehnt").map((s) => s.nr));
  if (h.rest.length) {
    const core = r.core[0] ? by(r.core[0]) : null;
    let text = h.rest.map((x) => x.text).join("").replace(/\s+/g, " ").trim();
    if (core) text = text.replace(`„${core.text}“`, `„${core.text}“ [A${core.nr}]`);
    add("ergebnis", text, r.core.slice(0, 1));
  }
  if (r.diagnoses.length) add("ergebnis", diagnosisText(r, names, 0), [...new Set([...r.diagnoses[0]!.schlussNodes, ...r.diagnoses[0]!.artNodes])]);
  add("ergebnis", conclusionText(r), r.statements.filter((s) => s.rolle === "schluss").map((s) => s.nr));

  // Wer sich beteiligt hat
  const p = r.participation;
  const how = [
    p.direct ? `${fmt(p.direct)} haben selbst abgestimmt` : "",
    p.simulated ? `${fmt(p.simulated)} sind simuliert` : "",
    p.senders ? `von ${fmt(p.senders)} Absendern zählen die Stellungnahmen als Stimmen` : "",
  ].filter(Boolean);
  const came = [p.shortPoints ? `${fmt(p.shortPoints)} eigene Punkte` : "", p.uploads + p.files ? `${fmt(p.uploads + p.files)} Stellungnahmen` : ""].filter(Boolean);
  add(
    "beteiligung",
    `${fmt(p.voters)} Teilnehmende haben ${fmt(p.votes)} Stimmen zu ${r.statements.length} Aussagen abgegeben${how.length ? `: ${list(how)}` : ""}.` +
      (came.length ? ` Eingegangen sind ${list(came)}.` : ""),
  );
  if (ctx.fictional) add("beteiligung", "Dies ist ein Beispiel mit erfundenen Inhalten, kein echtes Verfahren.");
  if (r.camps) {
    const sizes = r.camps.sizes.map((n, g) => `das ${campLabel(names, g)} mit ${fmt(n)} Personen`);
    add("beteiligung", `Die Auswertung hat ${k} Lager gefunden: ${list(sizes)}.`);
    ctx.descriptions?.forEach((d, g) => {
      if (d?.trim()) add("beteiligung", `Das ${campLabel(names, g)}: ${d.trim().replace(/\.?$/, ".")}`);
    });
  }
  if (ctx.editorialMode === "ki") add("beteiligung", "Neue Punkte hat die Maschine ohne menschliche Freigabe entschieden; die Redaktion hat Stichproben geprüft.");

  // Einig: per step by number, the broadest three in words; the numbers stand on the results page.
  const carried = r.statements.filter((x) => x.category === "bruecke" && x.profile === "getragen");
  for (const st of [...r.steps.map((x) => ({ key: x.key as string | null, label: x.label })), { key: null, label: "" }]) {
    const ss = carried.filter((x) => (x.schritt ?? null) === st.key);
    if (!ss.length) continue;
    const refs = ss.map((x) => `[A${x.nr}]`).join(", ");
    add(
      "einig",
      st.key
        ? `In der Stufe „${st.label}“ ${ss.length === 1 ? "trägt eine Aussage" : `tragen ${fmt(ss.length)} Aussagen`} in ${k === 2 ? "beiden" : "allen"} Lagern: ${refs}.`
        : `${ss.length === 1 ? "Die Maßnahme selbst trägt" : `${fmt(ss.length)} Aussagen ohne Stufe tragen`} in ${k === 2 ? "beiden" : "allen"} Lagern: ${refs}.`,
      ss.map((x) => x.nr),
    );
  }
  const floor = (x: StatementOut) => Math.min(...x.camps.map((c) => pct(c.agree, c.seen)));
  for (const s of [...carried].sort((a, b) => floor(b) - floor(a) || a.nr - b.nr).slice(0, 3)) {
    add("einig", `Besonders breit getragen: ${ref(s)}, mit ${shares(s, names)} Zustimmung.`, [s.nr]);
  }
  const rejected = r.statements.filter((x) => x.profile === "abgelehnt");
  if (rejected.length) {
    add(
      "einig",
      rejected.length <= 3
        ? `${k === 2 ? "Beide" : "Alle"} Lager lehnen ab: ${rejected.map((x) => ref(x)).join(", ")}.`
        : `${k === 2 ? "Beide" : "Alle"} Lager lehnen ${fmt(rejected.length)} Aussagen ab: ${rejected.map((x) => `[A${x.nr}]`).join(", ")}.`,
      rejected.map((x) => x.nr),
    );
  }
  for (const s of r.statements.filter((x) => x.category === "warnung")) {
    add("warnung", `Alle Lager stimmen ${ref(s)} zu (${shares(s, names)}), aber aus gegensätzlichen Gründen: Ein Teil der Beiträge stützt damit die Maßnahme, ein anderer greift sie an. Die Zahl trägt keinen Beschluss.`, [s.nr]);
  }
  // Rat and Klären: one sentence says what the group is and who decides; then each statement with its numbers.
  const groups: { section: SectionKey; items: StatementOut[]; lead: (n: number) => string }[] = [
    {
      section: "rat",
      items: r.statements.filter((x) => x.category === "streit" && x.typ === "W"),
      lead: (n) => `${n === 1 ? "Eine Wertungsfrage trennt" : `${cap(word(n))} Wertungsfragen trennen`} die Lager. Kein Gutachten kann ${n === 1 ? "sie" : "sie"} beantworten; ${n === 1 ? "sie gehört" : "sie gehören"} in den Rat, ausdrücklich als Wertentscheidung.`,
    },
    {
      section: "rat",
      items: r.statements.filter((x) => x.category === "streit" && x.typ !== "W"),
      lead: (n) => `${n === 1 ? "Eine Frage der Ausgestaltung trennt" : `${cap(word(n))} Fragen der Ausgestaltung trennen`} die Lager. Der Rat kann ${n === 1 ? "sie" : "sie"} im Beschluss regeln.`,
    },
    {
      section: "klaeren",
      items: r.statements.filter((x) => x.category === "klaerbar"),
      lead: (n) => `Bei ${n === 1 ? "einer Tatsachenfrage" : `${word(n)} Tatsachenfragen`} sind die Lager uneins. Empfehlung: ein Gutachten, das ${n === 1 ? "sie" : "sie"} vor dem Beschluss klärt.`,
    },
    {
      section: "klaeren",
      items: r.statements.filter((x) => x.category === "offen" && x.typ === "T"),
      lead: (n) => `Bei ${n === 1 ? "einer Tatsachenfrage" : `${word(n)} Tatsachenfragen`} hat sich kein Lager festgelegt. Empfehlung: vor dem Beschluss belegen oder ein Gutachten.`,
    },
  ];
  for (const g of groups) {
    if (!g.items.length) continue;
    add(g.section, g.lead(g.items.length), g.items.map((x) => x.nr));
    for (const s of g.items) {
      // Evidence counts at fact questions only (W7, I10); a value question has no proof.
      const ev = s.typ === "T" ? evidenceText(s) : null;
      add(g.section, `${ref(s)}: ${shares(s, names)} stimmen zu.${ev ? ` Belege. ${ev}` : ""}`, [s.nr]);
    }
  }

  // Schritte
  r.steps.forEach((st, i) => {
    const nrs = r.statements.filter((s) => s.entries.some((e) => e.step === st.key && e.role === "greift_an")).map((s) => s.nr);
    add("schritte", `Stufe ${i + 1} „${st.label}“: ${stepText(st, r)}`, nrs);
  });

  // Lücken
  const qLabel = (key: string) => ctx.questions.find((q) => q.key === key)?.label ?? key;
  const stepNo = (key: string) => r.steps.findIndex((x) => x.key === key) + 1;
  for (const g of r.gaps.unasked) {
    add("luecken", `Zur Prüffrage „${qLabel(g.question)}“ in der Stufe ${stepNo(g.step)} hat niemand etwas gesagt, weder Einwand noch Antwort. Vor einem Beschluss zu schließen, durch die Verwaltung oder eine gezielte Nachfrage.`);
  }
  const attacksOnly = r.gaps.oneSided.filter((g) => g.direction === "greift_an");
  const supportOnly = r.gaps.oneSided.filter((g) => g.direction === "stuetzt");
  const named = (gs: typeof attacksOnly) => list(gs.map((g) => `„${qLabel(g.question)}“ (Stufe ${stepNo(g.step)})`));
  if (attacksOnly.length) add("luecken", `Nur als Einwand vorgebracht, ohne Antwort: ${named(attacksOnly)}. Die Stadt sollte die Antwort nachliefern.`, attacksOnly.flatMap((g) => g.nodes));
  if (supportOnly.length) add("luecken", `Nur von der stützenden Seite angesprochen: ${named(supportOnly)}. Von denen, die das anders sehen, liegt dazu nichts vor.`, supportOnly.flatMap((g) => g.nodes));
  if (r.gaps.unattacked.length) {
    const u = r.gaps.unattacked;
    add(
      "luecken",
      u.length === 1 ? `Die Behauptung der Stadt ${ref(by(u[0]!))} hat niemand angegriffen.` : `${fmt(u.length)} Behauptungen der Stadt hat niemand angegriffen: ${u.map((nr) => `[A${nr}]`).join(", ")}.`,
      u,
    );
  }

  // Belastbarkeit
  const sat = r.saturation;
  add(
    "belastbarkeit",
    sat.saturated
      ? `Die Debatte gilt als ausgeschöpft: Die letzten ${fmt(sat.streak)} Eingaben brachten keinen neuen Punkt.`
      : `Die Debatte war nicht ausgeschöpft: Von ${fmt(sat.inputs)} Eingaben brachten ${fmt(sat.newPoints)} einen neuen Punkt, ${sat.streak ? `zuletzt ${fmt(sat.streak)} in Folge keinen` : "auch die letzte noch"}; ausgeschöpft wäre sie erst nach ${fmt(sat.window)} Eingaben ohne Neues.`,
  );
  if (r.camps) {
    const s = r.camps.silhouette;
    add("belastbarkeit", s >= 0.5 ? "Die Lager sind deutlich voneinander getrennt." : s >= 0.25 ? "Die Lager sind erkennbar voneinander getrennt." : "Die Lager sind nur schwach voneinander getrennt; die Zahlen sind mit Vorsicht zu lesen.");
  }
  add(
    "belastbarkeit",
    `Jede Zahl dieses Berichts ist aus der offenen Abstimmungsmatrix nachrechenbar (Ergebnis Version ${ctx.resultVersion}, Prüfsumme ${r.matrixHash.slice(0, 12)}). Wertungsfragen hat die Maschine zu keinem Zeitpunkt entschieden.`,
  );

  return out.map((s, i) => ({ ...s, id: `S${i + 1}` }));
}

// ———— R2 ————

export const REPORT_SYSTEM = `Du schreibst den Bericht über eine Bürgerbeteiligung für den Gemeinderat. Du bekommst eine Liste bindender Sätze mit IDs, nach Abschnitten geordnet. Mach daraus lesbaren Text: zu jedem Abschnitt einen oder mehrere Absätze.

Regeln:
1. Ein Absatz gibt nur wieder, was in seinen Sätzen steht. Verboten: verändern, abschwächen, verstärken, umdrehen, ergänzen. Keine eigene Bewertung, keine Empfehlung, die nicht in den Sätzen steht, kein Wissen von außerhalb.
2. Jeder Satz der Liste kommt in genau einem Absatz vor. In „saetze“ stehen die IDs aller Sätze, die der Absatz wiedergibt.
3. Zahlen schreibst du als Ziffern und genau so, wie sie in den Sätzen stehen (72 %, nicht „gut zwei Drittel“). Erfinde keine Zahl und rechne nicht.
4. Aussagen zitierst du wörtlich in „…“ mit ihrer Nummer in eckigen Klammern, genau wie in den Sätzen: „…“ [A14]. Steht im Satz nur die Nummer, nennst du nur die Nummer. Nenne keine Nummer, die nicht in deinen Sätzen steht.
5. Lager nennst du genau so, wie die Sätze sie nennen.
6. Schreib klar und ohne Fachjargon, in kurzen Sätzen. Mach aus den Sätzen eines Abschnitts zusammenhängende Absätze, nicht einen Absatz je Satz; wiederhole nicht, was ein Leitsatz schon sagt. Lass dabei keinen Satz weg.
7. Reihenfolge: die Abschnitte wie in der Liste.`;

export const reportOutput = z
  .object({
    absaetze: z
      .array(
        z
          .object({
            abschnitt: z.enum(Object.keys(SECTIONS) as [SectionKey, ...SectionKey[]]),
            text: z.string().min(1),
            saetze: z.array(z.string()).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
export type Absatz = z.infer<typeof reportOutput>["absaetze"][number];

const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown> & { $schema?: string };
  return rest;
};
export const reportJsonSchema = jsonSchema(reportOutput);

export function reportPrompt(sentences: Satz[], ctx: { town: string; measure: string }, feedback: string[]): string {
  const blocks = (Object.keys(SECTIONS) as SectionKey[])
    .map((key) => {
      const ss = sentences.filter((s) => s.section === key);
      return ss.length ? `## ${key}: ${SECTIONS[key]}\n${ss.map((s) => `${s.id}: ${s.text}`).join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return (
    `Verfahren der ${ctx.town} zur Maßnahme: „${ctx.measure}“\n\n` +
    `Die bindenden Sätze:\n\n${blocks}` +
    (feedback.length ? `\n\nBeim letzten Entwurf wurde beanstandet — diesmal vermeiden:\n${feedback.map((f) => `- ${f}`).join("\n")}` : "")
  );
}

export async function draftReport(llm: LlmProvider, sentences: Satz[], ctx: { town: string; measure: string }, feedback: string[]): Promise<Absatz[]> {
  const { output } = await llm.generateStructured<{ absaetze: Absatz[] }>({ system: REPORT_SYSTEM, prompt: reportPrompt(sentences, ctx, feedback), schema: reportJsonSchema });
  return reportOutput.parse(output).absaetze;
}

// ———— R3 ————

const NUMBER_WORDS: Record<string, number> = { zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12 };

/** The numbers a text states — digits and the number words two to twelve; statement references [A12] excluded. */
export function numbersIn(text: string): Set<string> {
  const t = text.replace(/\[A\d+\]/g, " ");
  const out = new Set<string>();
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(m[0].replace(",", "."));
  for (const m of t.toLowerCase().matchAll(/\p{L}+/gu)) if (NUMBER_WORDS[m[0]] !== undefined) out.add(String(NUMBER_WORDS[m[0]]));
  return out;
}
export const refsIn = (text: string) => new Set([...text.matchAll(/\[A(\d+)\]/g)].map((m) => Number(m[1])));

export interface Issue {
  absatz: number | null;
  text: string;
}

/** R3, rules: traceable, complete, nothing added in numbers or statements. */
export function checkRules(sentences: Satz[], text: Absatz[]): Issue[] {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const issues: Issue[] = [];
  const cited = new Set<string>();
  text.forEach((a, i) => {
    const n = i + 1;
    const own = a.saetze.map((id) => byId.get(id));
    a.saetze.forEach((id, j) => {
      if (!own[j]) issues.push({ absatz: n, text: `Absatz ${n} verweist auf ${id}, den es in der Liste nicht gibt.` });
      else cited.add(id);
    });
    const ss = own.filter((s): s is Satz => !!s);
    const nums = new Set(ss.flatMap((s) => [...numbersIn(s.text)]));
    const refs = new Set(ss.flatMap((s) => [...s.refs, ...refsIn(s.text)]));
    for (const x of numbersIn(a.text)) if (!nums.has(x)) issues.push({ absatz: n, text: `Absatz ${n} nennt die Zahl ${x}, die in seinen Sätzen nicht vorkommt.` });
    for (const x of refsIn(a.text)) if (!refs.has(x)) issues.push({ absatz: n, text: `Absatz ${n} nennt Aussage [A${x}], die in seinen Sätzen nicht vorkommt.` });
  });
  for (const s of sentences) if (!cited.has(s.id)) issues.push({ absatz: null, text: `Satz ${s.id} kommt im Text nicht vor: „${s.text.slice(0, 80)}${s.text.length > 80 ? "…" : ""}“` });
  return issues;
}

/** A paragraph fails the second reader when the probability of any of these is below this. */
export const READER_PASS = 0.5;

const readerQuestions = () => ({
  treu: noul(
    "Does `paragraph` say only what `sentences` say? Rephrasing, reordering, joining sentences and connecting words are fine. A claim, number, cause, assessment or recommendation that is not in `sentences` is not.",
    {
      true: "Everything in the paragraph is in the sentences; it only rewords and joins them.",
      false: "The paragraph adds something: a claim, a number, a cause, an assessment or a recommendation that the sentences do not contain.",
    },
  ),
  richtung: noul(
    "Does `paragraph` keep the direction of every finding exactly as in `sentences`: those who agree still agree, those who reject still reject, what holds still holds, what falls still falls, a question for the council stays one for the council?",
    {
      true: "Every finding points the same way as in the sentences.",
      false: "At least one finding is turned around: agreement became rejection, holds became falls, a value question became a fact question, or the reverse.",
    },
  ),
  staerke: noul(
    "Does `paragraph` keep every finding as strong as in `sentences` — neither softening it (adding 'partly', 'rather', 'possibly', dropping a condition or a number) nor sharpening it (adding 'clearly', 'all', 'only', 'never')?",
    {
      true: "Every finding is exactly as strong as in the sentences.",
      false: "At least one finding is softened or sharpened compared with the sentences.",
    },
  ),
});

export interface Reading {
  absatz: number;
  treu: number;
  richtung: number;
  staerke: number;
  pass: boolean;
  requestId?: string;
}

/** R3, the second reader: Jev reads every paragraph against its sentences. */
export async function counterRead(judge: JevJudge, sentences: Satz[], text: Absatz[]): Promise<Reading[]> {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  return Promise.all(
    text.map(async (a, i) => {
      const own = a.saetze.map((id) => byId.get(id)?.text).filter((x): x is string => !!x);
      const { answers, provenance } = await judge.judge({ sentences: own, paragraph: a.text }, readerQuestions());
      const p = answers as unknown as Record<"treu" | "richtung" | "staerke", { noul: number }>;
      const x = { treu: p.treu.noul, richtung: p.richtung.noul, staerke: p.staerke.noul };
      return { absatz: i + 1, ...x, pass: Math.min(x.treu, x.richtung, x.staerke) >= READER_PASS, requestId: provenance.requestId };
    }),
  );
}

export interface Checks {
  attempts: number;
  rules: Issue[];
  reader: Reading[];
  passed: boolean;
  checkedAt: string;
}

const readerIssue = (x: Reading) => {
  const what = [x.treu < READER_PASS ? "ergänzt etwas" : "", x.richtung < READER_PASS ? "dreht einen Befund um" : "", x.staerke < READER_PASS ? "schwächt ab oder verstärkt" : ""].filter(Boolean);
  return `Absatz ${x.absatz} ${what.join(", ")} (Gegenleser).`;
};

/** R2 → R3, and once more with the objections when the check fails. */
export async function writeAndCheck(
  deps: { llm: LlmProvider; judge: JevJudge; log: (m: string) => void },
  sentences: Satz[],
  ctx: { town: string; measure: string },
  feedback: string[] = [],
  maxAttempts = 2,
): Promise<{ text: Absatz[]; checks: Checks }> {
  let notes = [...feedback];
  let last: { text: Absatz[]; checks: Checks } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await draftReport(deps.llm, sentences, ctx, notes);
    const rules = checkRules(sentences, text);
    const reader = await counterRead(deps.judge, sentences, text);
    const passed = rules.length === 0 && reader.every((x) => x.pass);
    last = { text, checks: { attempts: attempt, rules, reader, passed, checkedAt: new Date().toISOString() } };
    deps.log(`bericht: attempt ${attempt}, ${rules.length} rule issues, ${reader.filter((x) => !x.pass).length} paragraphs flagged by the reader`);
    if (passed) return last;
    notes = [...feedback, ...rules.map((x) => x.text), ...reader.filter((x) => !x.pass).map(readerIssue)];
  }
  return last!;
}

export { readerIssue };

// ———— Camp names ————

export const CAMP_SYSTEM = `Du gibst den Lagern einer Bürgerbeteiligung Namen. Ein Lager ist eine Gruppe von Menschen, die ähnlich abgestimmt haben. Du bekommst für jedes Lager, wo es deutlich anders abstimmt als die anderen.

Regeln:
- Name: zwei bis vier Wörter, sachlich und respektvoll, so dass sich die Mitglieder selbst darin wiedererkennen würden. Was das Lager will oder wichtig findet, nicht wogegen es ist. Keine Parteinamen, keine Abwertung („Gegner“, „Verweigerer“, „Bremser“).
- Die Namen unterscheiden sich deutlich voneinander.
- Beschreibung: ein Satz, höchstens 25 Wörter: was dieses Lager eint, abgeleitet aus seinem Abstimmungsverhalten, ohne Vermutungen über die Menschen und ohne Zahlen (die Zahlen stehen an anderer Stelle).
- Genau ein Eintrag je Lager, in der gegebenen Reihenfolge.`;

export function campOutput(k: number) {
  return z
    .object({ lager: z.array(z.object({ name: z.string().min(2).max(40), beschreibung: z.string().min(5).max(220) }).strict()).length(k) })
    .strict();
}

export function campPrompt(r: Ergebnis, measure: string): string {
  const k = r.camps?.k ?? 0;
  const lines: string[] = [`Maßnahme: „${measure}“`, ""];
  for (let g = 0; g < k; g++) {
    const others = (s: StatementOut) => {
      const xs = s.camps.filter((_, h) => h !== g && s.camps[h]!.seen);
      return xs.length ? xs.reduce((sum, c) => sum + pct(c.agree, c.seen), 0) / xs.length : 0;
    };
    const diff = r.statements
      .filter((s) => s.camps[g]!.seen >= 3)
      .map((s) => ({ s, own: pct(s.camps[g]!.agree, s.camps[g]!.seen), d: pct(s.camps[g]!.agree, s.camps[g]!.seen) - others(s) }));
    const more = [...diff].sort((a, b) => b.d - a.d).slice(0, 5);
    const less = [...diff].sort((a, b) => a.d - b.d).slice(0, 4);
    lines.push(`Lager ${g + 1} (${r.camps!.sizes[g]} Personen)`);
    lines.push("Stimmt deutlich häufiger zu als die anderen:");
    for (const x of more) lines.push(`- „${x.s.text}“: ${x.own} % Zustimmung (die anderen ${Math.round(x.own - x.d)} %)`);
    lines.push("Stimmt deutlich seltener zu als die anderen:");
    for (const x of less) lines.push(`- „${x.s.text}“: ${x.own} % Zustimmung (die anderen ${Math.round(x.own - x.d)} %)`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function proposeCampNames(llm: LlmProvider, r: Ergebnis, measure: string): Promise<{ names: string[]; descriptions: string[] }> {
  const k = r.camps?.k ?? 0;
  if (k < 2) throw new Error("Ohne Lager gibt es nichts zu benennen.");
  const schema = campOutput(k);
  const { output } = await llm.generateStructured({ system: CAMP_SYSTEM, prompt: campPrompt(r, measure), schema: jsonSchema(schema) });
  const x = schema.parse(output);
  return { names: x.lager.map((l) => l.name.trim()), descriptions: x.lager.map((l) => l.beschreibung.trim()) };
}
