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
  alike,
  campShares,
  conclusionText,
  countLine,
  pairsText,
  sidesText,
  smallHeadline,
  stepCountText,
  diagnosisText,
  evidenceText,
  firmBridge,
  headline,
  lotSummary,
  pct,
  stepText,
  word,
  type CampNames,
} from "./befund-text.ts";

// ———— R1 ————

export const SECTIONS = {
  ergebnis: "Das Wichtigste",
  beteiligung: "Wer sich beteiligt hat",
  lager: "Die Lager",
  lesart: "Wie gezählt wurde",
  stimmen: "Wie abgestimmt wurde",
  einig: "Worauf sich die Lager einigen",
  vorbehalt: "Einigkeit unter Vorbehalt",
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
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Small numbers as words in running text, larger ones as digits. */
const num = (n: number, female = true) => (n <= 12 ? word(n, female) : fmt(n));
const shares = campShares;

/** Who took part and who voted how, the same sentence in both kinds of report. */
function participationSentences(r: Ergebnis): { took: string; how: string | null; came: string | null } {
  const p = r.participation;
  const how = [
    p.direct ? `${fmt(p.direct)} ${pl(p.direct, "hat", "haben")} selbst abgestimmt` : "",
    p.simulated ? `${fmt(p.simulated)} ${pl(p.simulated, "ist", "sind")} simuliert` : "",
    p.senders
      ? `${fmt(p.senders)} ${pl(p.senders, "ist Absender einer schriftlichen Stellungnahme", "sind Absender schriftlicher Stellungnahmen")}; was sie geschrieben haben, zählt als ihre Stimme zu den Aussagen, die es betrifft`
      : "",
  ].filter(Boolean);
  const inputs = p.uploads + p.files;
  const came = [
    p.shortPoints ? `${fmt(p.shortPoints)} ${pl(p.shortPoints, "eigener Punkt", "eigene Punkte")} von Teilnehmenden` : "",
    inputs ? `${fmt(inputs)} ${pl(inputs, "Stellungnahme", "Stellungnahmen")}` : "",
  ].filter(Boolean);
  const fromTown = r.statements.filter((s) => s.rolle !== "beitrag").length;
  const fromInputs = r.statements.length - fromTown;
  return {
    took: `${fmt(p.voters)} ${pl(p.voters, "Person hat", "Teilnehmende haben")} ${fmt(p.votes)} Stimmen zu ${r.statements.length} Aussagen abgegeben, jeweils Zustimmung, Ablehnung oder Enthaltung.`,
    how: how.length ? `${cap(list(how))}.` : null,
    came: came.length
      ? `Eingegangen ${came.length === 1 && /^1 /.test(came[0]!) ? "ist" : "sind"} ${list(came)}. Aus ihnen und aus der Begründung der Stadt stammen die Aussagen, über die abgestimmt wurde: ${num(fromTown)} aus der Begründung, ${num(fromInputs)} aus den Eingaben.`
      : null,
  };
}

/** R1: the sentences, in report order. Templates only — the same result always gives the same list. */
export function conclusions(r: Ergebnis, names: CampNames, ctx: ReportContext): Satz[] {
  if (!r.ready) return smallConclusions(r, ctx);
  const out: Omit<Satz, "id">[] = [];
  const add = (section: SectionKey, text: string, refs: number[] = []) => out.push({ section, text, refs });
  const k = r.camps?.k ?? 0;
  const t = r.params.bridgeThreshold;
  const T = Math.round(t * 100);
  const by = (nr: number) => r.statements.find((s) => s.nr === nr)!;
  const root = r.statements.find((s) => s.rolle === "schluss");
  const every = k === 2 ? "beiden" : "allen";
  const Every = k === 2 ? "Beide" : "Alle";
  const sizes = (r.camps?.sizes ?? []).map((n, g) => `das ${campLabel(names, g)} mit ${fmt(n)} Personen`);
  const stepLabel = (key: string) => r.steps.find((x) => x.key === key)?.label ?? key;

  // Das Wichtigste — readable on its own: who voted, which camps there are, what holds, what divides.
  add(
    "ergebnis",
    `${fmt(r.participation.voters)} Menschen haben über ${r.statements.length} Aussagen zur Maßnahme abgestimmt. Nach ihren Stimmen bilden sie ${word(k, false)} Lager, also Gruppen, die ähnlich abgestimmt haben: ${list(sizes)}.`,
  );
  const h = headline(r);
  add(
    "ergebnis",
    `${h.lead} Eine Aussage trägt in einem Lager, wenn dort mindestens ${T} % zustimmen.`,
    r.statements.filter((s) => s.profile === "getragen" || s.profile === "abgelehnt").map((s) => s.nr),
  );
  if (h.rest.length) {
    const core = r.core[0] ? by(r.core[0]) : null;
    let text = h.rest.map((x) => x.text).join("").replace(/\s+/g, " ").trim();
    if (core) text = text.replace(`„${core.text}“`, `„${core.text}“ [A${core.nr}]`);
    add("ergebnis", text, r.core.slice(0, 1));
  }
  if (r.diagnoses.length) add("ergebnis", diagnosisText(r, names, 0), [...new Set([...r.diagnoses[0]!.schlussNodes, ...r.diagnoses[0]!.artNodes])]);
  add("ergebnis", `Die Begründung der Stadt hat vier Stufen. ${conclusionText(r, true)}`, root ? [root.nr] : []);

  // Wer sich beteiligt hat
  const ps = participationSentences(r);
  add("beteiligung", ps.took);
  if (ps.how) add("beteiligung", ps.how);
  if (ps.came) add("beteiligung", ps.came);
  const p = r.participation;
  if (p.drawn) {
    add(
      "beteiligung",
      `${fmt(p.drawn)} ${p.drawn === 1 ? "Person kam" : "Teilnehmende kamen"} mit dem Code aus einem Brief an zufällig ausgeloste Einwohnerinnen und Einwohner. Ihre Stimmen zählen wie alle anderen und werden zusätzlich getrennt ausgewertet, als Gegenprobe.`,
    );
  }
  if (ctx.fictional) add("beteiligung", "Dies ist ein Beispiel mit erfundenen Inhalten, kein echtes Verfahren.");
  if (ctx.editorialMode === "ki") add("beteiligung", "Neue Punkte hat die Maschine ohne menschliche Freigabe entschieden; die Redaktion hat Stichproben geprüft.");

  // Die Lager: what a camp is, which ones there are, who is in none, who stands close to whom.
  if (r.camps) {
    add("lager", `Lager sind Gruppen von Menschen, die ähnlich abgestimmt haben. Niemand ordnet sich selbst zu: Die Auswertung bildet die Lager aus den Stimmen. Sie hat ${word(k, false)} gefunden: ${list(sizes)}.`);
    ctx.descriptions?.forEach((d, g) => {
      if (d?.trim()) add("lager", `Das ${campLabel(names, g)}: ${d.trim().replace(/\.?$/, ".")}`);
    });
    const placed = r.camps.sizes.reduce((a, b) => a + b, 0);
    const unplaced = p.voters - placed;
    if (unplaced > 0) {
      add(
        "lager",
        `${cap(num(unplaced, false))} ${unplaced === 1 ? "Teilnehmender hat" : "Teilnehmende haben"} zu wenige Aussagen bewertet, um einem Lager zugeordnet zu werden. Ihre Stimmen stehen in der offenen Abstimmungsmatrix, zählen aber in keinem Lager.`,
      );
    }
    const pairs = pairsText(r, names);
    if (pairs) add("lager", pairs);
  }

  // Wie gezählt wurde: every word the findings use, once, before they are used.
  add(
    "lesart",
    `Jede Aussage hat eine Nummer${root ? `, etwa [A${root.nr}] für die Maßnahme selbst` : ""}. Unter dieser Nummer steht sie auf der Ergebnisseite, mit allen Zahlen und den Zitaten, aus denen sie stammt.`,
    root ? [root.nr] : [],
  );
  add(
    "lesart",
    `Eine Aussage trägt in einem Lager, wenn dort mindestens ${T} % zustimmen und so viele abgestimmt haben, dass es kein Zufall der kleinen Zahl ist. Trägt sie in ${every} Lagern, ist sie eine Brücke: ein Punkt, auf den sich ein Beschluss stützen kann. Lehnen ${k === 2 ? "beide" : "alle"} Lager eine Aussage ebenso deutlich ab, ist auch das eine Einigung. Wer dazwischen liegt, ist unentschieden.`,
  );
  add(
    "lesart",
    "Tatsachenfragen lassen sich prüfen, etwa durch ein Gutachten. Wertungsfragen kann kein Gutachten beantworten; sie entscheidet der Rat. Fragen der Ausgestaltung regelt der Rat im Beschluss.",
  );
  add(
    "lesart",
    `Die Begründung der Stadt hat vier Stufen, die aufeinander aufbauen: ${list(r.steps.map((x) => `„${x.label}“`))}. Eine Stufe hält, wenn kein Einwand gegen sie steht. Sie wackelt, wenn ein Einwand zu einer Tatsache oder zur Ausgestaltung steht. Sie fällt, wenn ein Einwand gegen eine Wertung steht oder eine Wertung der Stadt nicht in ${every} Lagern trägt; das kann keine Evidenz ändern.`,
  );

  // Einig: per step how many, and the most broadly carried one in words; the full list is on the results page.
  // Only bridges that passed Stephan's checks; the others follow under "Einigkeit unter Vorbehalt".
  const carried = r.statements.filter((x) => firmBridge(x) && x.profile === "getragen");
  const floor = (x: StatementOut) => Math.min(...x.camps.map((c) => pct(c.agree, c.seen)));
  if (carried.length) {
    add("einig", `${Every} Lager einigen sich auf ${num(carried.length, true)} ${pl(carried.length, "Aussage", "Aussagen")}.`, carried.map((x) => x.nr));
  }
  // An objection every camp agrees with is a bridge too — but against the town's reasoning: said apart.
  const isObjection = (x: StatementOut) => x.rolle === "beitrag" && x.richtung === "greift_an";
  for (const st of [...r.steps.map((x) => ({ key: x.key as string | null, label: x.label })), { key: null, label: "" }]) {
    const ss = carried.filter((x) => (x.schritt ?? null) === st.key);
    if (!ss.length) continue;
    const pro = ss.filter((x) => !isObjection(x));
    const best = [...(pro.length ? pro : ss)].sort((a, b) => floor(b) - floor(a) || a.nr - b.nr)[0]!;
    const where = st.key ? `In der Stufe „${st.label}“` : "Ohne Stufe";
    add(
      "einig",
      ss.length === 1
        ? `${where} ist es eine: ${ref(best)}, mit ${shares(best, names)} Zustimmung.`
        : `${where} sind es ${num(ss.length)}. Am breitesten getragen ist ${ref(best)}, mit ${shares(best, names)} Zustimmung.`,
      [best.nr],
    );
  }
  const objections = carried.filter(isObjection);
  if (objections.length) {
    add(
      "einig",
      `${objections.length === 1 ? "Eine davon ist ein Einwand" : `${cap(num(objections.length))} davon sind Einwände`} gegen die Begründung der Stadt, ${pl(objections.length, "dem", "denen")} ${k === 2 ? "beide" : "alle"} Lager zustimmen. Ein Beschluss muss ${pl(objections.length, "ihn", "sie")} beantworten: ${
        objections.length <= 3 ? list(objections.map((x) => ref(x))) : objections.map((x) => `[A${x.nr}]`).join(", ")
      }.`,
      objections.map((x) => x.nr),
    );
  }
  const rejected = r.statements.filter((x) => x.profile === "abgelehnt" && firmBridge(x));
  if (rejected.length) {
    add(
      "einig",
      rejected.length <= 3
        ? `${Every} Lager lehnen ab: ${rejected.map((x) => ref(x)).join(", ")}.`
        : `${Every} Lager lehnen ${fmt(rejected.length)} Aussagen ab: ${rejected.map((x) => `[A${x.nr}]`).join(", ")}.`,
      rejected.map((x) => x.nr),
    );
  }
  const unchecked = [...carried, ...rejected].filter((x) => x.check?.lot?.status === "zu_wenige");
  if (unchecked.length) {
    add(
      "einig",
      `${unchecked.length === 1 ? "Bei einer dieser Aussagen ließ" : `Bei ${num(unchecked.length)} dieser Aussagen ließ`} sich die Gegenprobe durch Los nicht machen, weil zu wenige Ausgeloste über ${pl(unchecked.length, "sie", "sie")} abgestimmt haben: ${unchecked.map((x) => `[A${x.nr}]`).join(", ")}. Ob ${pl(unchecked.length, "sie", "sie")} auch bei Menschen ${pl(unchecked.length, "trägt", "tragen")}, die nicht von sich aus mitgemacht haben, ist offen.`,
      unchecked.map((x) => x.nr),
    );
  }
  if (carried.length || rejected.length) add("einig", "Die vollständige Liste mit allen Zahlen steht auf der Ergebnisseite.");

  for (const s of r.statements.filter((x) => x.category === "bruecke" && !firmBridge(x))) {
    const field = s.profile === "abgelehnt" ? "disagree" : "agree";
    const what = s.profile === "abgelehnt" ? "Ablehnung" : "Zustimmung";
    const why: string[] = [];
    if (s.check && !s.check.robust) {
      why.push(`ohne ein Zehntel der ${what} ${list(s.check.fragile.map((g) => `im ${campLabel(names, g)}`))} fiele sie unter die Schwelle`);
    }
    if (s.check?.lot?.status === "faellt") {
      const low = s.check.lot.camps.flatMap((c, g) => (c.seen && c[field] / c.seen < t ? [`im ${campLabel(names, g)} nur ${fmt(c[field])} von ${fmt(c.seen)}`] : []));
      why.push(`bei den Ausgelosten ${s.profile === "abgelehnt" ? "lehnen" : "stimmen"} ${list(low)} ${s.profile === "abgelehnt" ? "ab" : "zu"}`);
    }
    add(
      "vorbehalt",
      `${Every} Lager ${s.profile === "abgelehnt" ? "lehnen" : "stimmen"} ${ref(s)} ${s.profile === "abgelehnt" ? "ab" : "zu"} (${shares(s, names, field)}), aber die Einigkeit ist nicht belastbar: ${why.join("; ")}. Sie trägt einen Beschluss nicht allein.`,
      [s.nr],
    );
  }
  for (const s of r.statements.filter((x) => x.category === "warnung")) {
    add("warnung", `${Every} Lager stimmen ${ref(s)} zu (${shares(s, names)}), aber aus gegensätzlichen Gründen: Ein Teil der Beiträge stützt damit die Maßnahme, ein anderer greift sie an. Die Zahl trägt keinen Beschluss.`, [s.nr]);
  }

  // Rat and Klären: the measure itself first, then one sentence per group (what it is, who decides), then
  // each statement with who stands where.
  const sides = (s: StatementOut) => cap(sidesText(s, names, t));
  if (root && root.category === "streit") {
    add("rat", `Über die Maßnahme selbst sind sich die Lager nicht einig: ${ref(root)}. ${sides(root)}.`, [root.nr]);
  }
  const own = r.statements.filter((x) => x.rolle !== "schluss");
  const groups: { section: SectionKey; items: StatementOut[]; lead: (n: number) => string }[] = [
    {
      section: "rat",
      items: own.filter((x) => x.category === "streit" && x.typ === "W"),
      lead: (n) => {
        const what = `${n === 1 ? "eine Wertungsfrage" : `${num(n)} Wertungsfragen`} die Lager`;
        const verb = pl(n, "trennt", "trennen");
        return `${root?.category === "streit" ? `Außerdem ${verb} ${what}` : cap(`${what.replace(" die Lager", "")} ${verb} die Lager`)}. Kein Gutachten kann sie beantworten; ${pl(n, "sie gehört", "sie gehören")} in den Rat, ausdrücklich als Wertentscheidung.`;
      },
    },
    {
      section: "rat",
      items: own.filter((x) => x.category === "streit" && x.typ !== "W"),
      lead: (n) => `${n === 1 ? "Eine Frage der Ausgestaltung trennt" : `${cap(num(n))} Fragen der Ausgestaltung trennen`} die Lager. Der Rat kann sie im Beschluss regeln.`,
    },
    {
      section: "klaeren",
      items: own.filter((x) => x.category === "klaerbar" && x.profile === "trennt"),
      lead: (n) => `Bei ${n === 1 ? "einer Tatsachenfrage" : `${num(n)} Tatsachenfragen`} sind die Lager uneins. Empfehlung: ein Gutachten, das ${pl(n, "sie", "sie")} vor dem Beschluss klärt.`,
    },
    {
      section: "klaeren",
      items: own.filter((x) => x.category === "klaerbar" && x.profile !== "trennt"),
      lead: (n) => `Zu ${n === 1 ? "einer Tatsachenfrage" : `${num(n)} Tatsachenfragen`} liegen Belege vor, aber kein Lager hat sich festgelegt. Empfehlung: ein Gutachten.`,
    },
    {
      section: "klaeren",
      items: own.filter((x) => x.category === "offen" && x.typ === "T"),
      lead: (n) => `Bei ${n === 1 ? "einer Tatsachenfrage" : `${num(n)} Tatsachenfragen`} hat sich kein Lager festgelegt, und es liegt kein Beleg vor. Empfehlung: vor dem Beschluss belegen oder ein Gutachten.`,
    },
  ];
  for (const g of groups) {
    if (!g.items.length) continue;
    add(g.section, g.lead(g.items.length), g.items.map((x) => x.nr));
    for (const s of g.items) {
      // Evidence counts at fact questions only (W7, I10); a value question has no proof.
      const ev = s.typ === "T" ? evidenceText(s) : null;
      add(g.section, `${ref(s)}: ${sides(s)}.${ev ? ` Belege. ${ev}` : ""}`, [s.nr]);
    }
  }

  // Schritte: each step's verdict, what stands against it, and which of the town's values do not carry.
  r.steps.forEach((st, i) => {
    const standing: { text: string; nr: number }[] = [];
    for (const s of r.statements) {
      for (const e of s.entries) {
        if (e.step !== st.key || e.role !== "greift_an" || e.status !== "haelt") continue;
        // An entry with its own attack wording is a contradiction of the statement itself.
        standing.push(e.attack ? { text: `der Widerspruch gegen ${ref(s)}`, nr: s.nr } : { text: ref(s), nr: s.nr });
      }
    }
    // The town's values that not every camp carries — unless a standing contradiction already names them.
    const weakValues = r.statements.filter(
      (s) =>
        s.rolle === "praemisse" &&
        s.typ === "W" &&
        s.entries.some((e) => e.step === st.key && e.role === "stuetzt" && e.status !== "getragen") &&
        !standing.some((x) => x.nr === s.nr),
    );
    const parts = [`Stufe ${i + 1} „${st.label}“: ${stepText(st, r)}`];
    if (standing.length) {
      const shown = standing.slice(0, 3);
      parts.push(`${standing.length === 1 ? "Der Einwand, der steht" : standing.length <= 3 ? "Die Einwände, die stehen" : "Darunter"}: ${list(shown.map((x) => x.text))}.`);
    }
    if (weakValues.length) {
      parts.push(`Nicht in ${every} Lagern getragen ${weakValues.length === 1 ? "ist die Wertung" : "sind die Wertungen"} der Stadt ${list(weakValues.map((x) => ref(x)))}.`);
    }
    add("schritte", parts.join(" "), [...new Set([...standing.slice(0, 3).map((x) => x.nr), ...weakValues.map((x) => x.nr)])]);
  });

  // Lücken
  const qLabel = (key: string) => ctx.questions.find((q) => q.key === key)?.label ?? key;
  for (const g of r.gaps.unasked) {
    add("luecken", `Den Einwand „${qLabel(g.question)}“ zur Stufe „${stepLabel(g.step)}“ hat niemand erhoben, und niemand hat ihn beantwortet. Vor einem Beschluss zu schließen, durch die Verwaltung oder eine gezielte Nachfrage.`);
  }
  const attacksOnly = r.gaps.oneSided.filter((g) => g.direction === "greift_an");
  const supportOnly = r.gaps.oneSided.filter((g) => g.direction === "stuetzt");
  const named = (gs: typeof attacksOnly) => list(gs.map((g) => `„${qLabel(g.question)}“ (Stufe „${stepLabel(g.step)}“)`));
  if (attacksOnly.length) {
    add("luecken", `Nur als Einwand vorgebracht, ohne Antwort der Stadt oder anderer Beteiligter: ${named(attacksOnly)}. Die Stadt sollte die Antwort nachliefern.`, attacksOnly.flatMap((g) => g.nodes));
  }
  if (supportOnly.length) {
    add(
      "luecken",
      `Zu ${supportOnly.length === 1 ? "einem möglichen Einwand" : `${num(supportOnly.length, false)} möglichen Einwänden`} gibt es nur Beiträge, die die Stadt stützen, und keinen, der widerspricht: ${named(supportOnly)}.`,
      supportOnly.flatMap((g) => g.nodes),
    );
  }
  if (r.gaps.unattacked.length) {
    const u = r.gaps.unattacked;
    add(
      "luecken",
      u.length === 1
        ? `Die Behauptung der Stadt ${ref(by(u[0]!))} hat niemand angegriffen.`
        : u.length <= 3
          ? `${cap(num(u.length, false))} Behauptungen aus der Begründung der Stadt hat niemand angegriffen: ${list(u.map((nr) => ref(by(nr))))}.`
          : `${cap(num(u.length, false))} Behauptungen aus der Begründung der Stadt hat niemand angegriffen, darunter ${list(u.slice(0, 2).map((nr) => ref(by(nr))))}. Alle stehen auf der Ergebnisseite.`,
      u.length <= 3 ? u : u.slice(0, 2),
    );
  }

  // Belastbarkeit
  const sat = r.saturation;
  add(
    "belastbarkeit",
    !sat.inputs
      ? "Eigene Punkte oder Stellungnahmen gab es nicht; ob die Debatte ausgeschöpft war, lässt sich nicht sagen."
      : sat.saturated
      ? `Die Debatte gilt als ausgeschöpft: Die letzten ${fmt(sat.streak)} Eingaben brachten keinen neuen Punkt.`
      : `Die Debatte war nicht ausgeschöpft: Von ${fmt(sat.inputs)} Eingaben brachten ${fmt(sat.newPoints)} einen neuen Punkt, ${sat.streak ? `zuletzt ${fmt(sat.streak)} in Folge keinen` : "auch die letzte noch"}; ausgeschöpft wäre sie erst nach ${fmt(sat.window)} Eingaben ohne Neues.`,
  );
  const bridges = r.statements.filter((x) => x.category === "bruecke" && x.check);
  if (bridges.length) {
    const fragile = bridges.filter((x) => !x.check!.robust);
    add(
      "belastbarkeit",
      fragile.length
        ? `${fragile.length === 1 ? "Eine Brücke hängt" : `${cap(word(fragile.length))} Brücken hängen`} an wenigen Stimmen: ${fragile.map((x) => `[A${x.nr}]`).join(", ")}. Alle anderen halten auch, wenn man in jedem Lager ein Zehntel der Stimmen herausnimmt, die sie tragen.`
        : "Jede Brücke hält auch, wenn man in jedem Lager ein Zehntel der Stimmen herausnimmt, die sie tragen. Keine hängt an wenigen Stimmen.",
      fragile.map((x) => x.nr),
    );
    const lot = lotSummary(r);
    if (!lot) {
      add("belastbarkeit", "Eine Gegenprobe durch Los gab es nicht. Ob die Brücken auch bei Menschen tragen, die nicht von sich aus mitgemacht haben, ist offen.");
    } else {
      const a = [
        lot.firm ? `${num(lot.firm)} auch bei den Ausgelosten` : "",
        lot.onlySelf ? `${num(lot.onlySelf)} nur bei denen, die von sich aus mitgemacht haben` : "",
      ].filter(Boolean);
      let text = `Gegenprobe durch Los mit ${fmt(lot.drawn)} ausgelosten Teilnehmenden: `;
      if (lot.bridges === 1) {
        text += lot.firm ? "Die eine Brücke trägt auch bei den Ausgelosten" : lot.onlySelf ? "Die eine Brücke trägt nur bei denen, die von sich aus mitgemacht haben" : "Die eine Brücke ließ sich nicht prüfen";
      } else text += a.length ? `Von ${num(lot.bridges)} Brücken tragen ${list(a)}` : `Von ${num(lot.bridges)} Brücken ließ sich keine prüfen`;
      if (lot.tooFew) text += a.length && lot.bridges > 1 ? `; bei ${lot.tooFew === 1 ? "einer" : num(lot.tooFew)} haben zu wenige Ausgeloste abgestimmt` : ", weil zu wenige Ausgeloste abgestimmt haben";
      add("belastbarkeit", `${text}.`, r.statements.filter((x) => x.check?.lot?.status === "faellt").map((x) => x.nr));
    }
  }
  if (r.camps) {
    const s = r.camps.silhouette;
    add(
      "belastbarkeit",
      s >= 0.5
        ? "Die Lager sind deutlich voneinander getrennt: Wer zu einem Lager gehört, stimmt seinem Lager klar ähnlicher ab als den anderen."
        : s >= 0.25
          ? "Die Lager sind erkennbar voneinander getrennt, die Übergänge aber fließend."
          : "Die Lager sind nur schwach voneinander getrennt; die Zahlen sind mit Vorsicht zu lesen.",
    );
  }
  add(
    "belastbarkeit",
    `Jede Zahl dieses Berichts ist aus der offenen Abstimmungsmatrix nachrechenbar (Ergebnis Version ${ctx.resultVersion}, Prüfsumme ${r.matrixHash.slice(0, 12)}). Wertungsfragen hat die Maschine zu keinem Zeitpunkt entschieden.`,
  );

  return out.map((s, i) => ({ ...s, id: `S${i + 1}` }));
}

/**
 * R1 for a procedure with too few people for camps: counts over everyone and the arguments, step by
 * step. No sentence says a statement carries or a step holds; that needs camps.
 */
function smallConclusions(r: Ergebnis, ctx: ReportContext): Satz[] {
  const out: Omit<Satz, "id">[] = [];
  const add = (section: SectionKey, text: string, refs: number[] = []) => out.push({ section, text, refs });
  const p = r.participation;
  const h = smallHeadline(r);
  const got = r.clusterable === 0 ? "hat das niemand" : r.clusterable === 1 ? "hat das eine Person" : `haben das ${num(r.clusterable, false)} Personen`;
  add(
    "ergebnis",
    `${fmt(p.voters)} ${pl(p.voters, "Person hat", "Menschen haben")} über ${r.statements.length} Aussagen zur Maßnahme abgestimmt. ` +
      (alike(r)
        ? `Lager, also Gruppen, die ähnlich abstimmen, zeigen sich dabei nicht: ${cap(num(r.clusterable, false))} haben genug Aussagen bewertet, aber so ähnlich, dass sich keine Gruppen unterscheiden lassen.`
        : `Das sind zu wenige für Lager, also Gruppen, die ähnlich abstimmen: Dafür müssten mindestens ${r.needed} Menschen genug Aussagen bewertet haben, hier ${got}.`),
  );
  add(
    "ergebnis",
    `Deshalb zählt dieser Bericht die Stimmen aller zusammen. ${h.rest.map((x) => x.text).join("")} Ob eine Aussage über Lager hinweg trägt, wo der Streit liegt und ob die Begründung hält, lässt sich so nicht sagen.`,
  );

  const ps = participationSentences(r);
  add("beteiligung", ps.took);
  if (ps.how) add("beteiligung", ps.how);
  if (ps.came) add("beteiligung", ps.came);
  if (ctx.fictional) add("beteiligung", "Dies ist ein Beispiel mit erfundenen Inhalten, kein echtes Verfahren.");
  if (ctx.editorialMode === "ki") add("beteiligung", "Neue Punkte hat die Maschine ohne menschliche Freigabe entschieden; die Redaktion hat Stichproben geprüft.");

  const root = r.statements.find((s) => s.rolle === "schluss");
  add(
    "lesart",
    `Jede Aussage hat eine Nummer${root ? `, etwa [A${root.nr}] für die Maßnahme selbst` : ""}. Unter dieser Nummer steht sie auf der Ergebnisseite, mit allen Zahlen und den Zitaten, aus denen sie stammt.`,
    root ? [root.nr] : [],
  );
  add("lesart", `Die Begründung der Stadt hat vier Stufen, die aufeinander aufbauen: ${list(r.steps.map((x) => `„${x.label}“`))}. Zu jeder Stufe steht unten, was sie stützt und was sie angreift.`);

  // The measure first, then every statement anyone voted on, in display order.
  for (const s of r.statements.filter((x) => x.total.seen > 0)) {
    add("stimmen", `${s.rolle === "schluss" ? "Zur Maßnahme selbst, " : ""}${ref(s)}: ${countLine(s)}`, [s.nr]);
  }
  const silent = r.statements.filter((x) => x.total.seen === 0);
  if (silent.length) add("stimmen", `Zu ${fmt(silent.length)} ${silent.length === 1 ? "Aussage" : "Aussagen"} hat niemand abgestimmt: ${silent.map((x) => `[A${x.nr}]`).join(", ")}.`, silent.map((x) => x.nr));

  r.steps.forEach((st, i) => {
    const nrs = r.statements.filter((s) => s.entries.some((e) => e.step === st.key)).map((s) => s.nr);
    add("schritte", `Stufe ${i + 1} „${st.label}“: ${stepCountText(st)}`, nrs);
  });

  const qLabel = (key: string) => ctx.questions.find((q) => q.key === key)?.label ?? key;
  const stepLabel = (key: string) => r.steps.find((x) => x.key === key)?.label ?? key;
  for (const g of r.gaps.unasked) {
    add("luecken", `Den Einwand „${qLabel(g.question)}“ zur Stufe „${stepLabel(g.step)}“ hat niemand erhoben, und niemand hat ihn beantwortet.`);
  }
  const attacksOnly = r.gaps.oneSided.filter((g) => g.direction === "greift_an");
  if (attacksOnly.length) {
    add(
      "luecken",
      `Nur als Einwand vorgebracht, ohne Antwort: ${list(attacksOnly.map((g) => `„${qLabel(g.question)}“ (Stufe „${stepLabel(g.step)}“)`))}. Die Stadt sollte die Antwort nachliefern.`,
      attacksOnly.flatMap((g) => g.nodes),
    );
  }

  add("belastbarkeit", `Bei ${fmt(p.voters)} ${p.voters === 1 ? "Person" : "Teilnehmenden"} sind die Zählungen ein Stimmungsbild, keine belastbare Mehrheit.`);
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
7. Reihenfolge: die Abschnitte wie in der Liste, und innerhalb eines Abschnitts die Sätze in ihrer Reihenfolge.
8. „Das Wichtigste“ muss für sich verständlich sein: Wer nur diesen Abschnitt liest, erfährt, welche Lager es gibt, worauf sie sich einigen und was sie trennt. Erkläre Begriffe dort so, wie die Sätze es tun, nicht anders.`;

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
    // "eine Brücke" in a sentence may read "1 Brücke" in the text (the writer is told to use digits); the
    // article is not counted as a number, so "1" passes wherever its sentences say "ein…".
    const saysOne = ss.some((s) => /\bein(e|er|en|em|es)?\b/i.test(s.text));
    for (const x of numbersIn(a.text)) {
      if (nums.has(x) || (x === "1" && saysOne)) continue;
      issues.push({ absatz: n, text: `Absatz ${n} nennt die Zahl ${x}, die in seinen Sätzen nicht vorkommt.` });
    }
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
