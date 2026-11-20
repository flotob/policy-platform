/**
 * The evaluation in plain German: fixed sentence templates over the result
 * object, no language model. The results page and the report's sentence
 * list (R1) use the same words, so a finding reads the same everywhere.
 */

import type { BelegKey, CampCount, Category, Diagnosis, Ergebnis, Status, StatementOut, StepOut, Verdict } from "./befund.ts";
import { carries, diagnoseCamps, MIN_CAMP_VOTES, rejects } from "./position.ts";

export type CampNames = (string | null | undefined)[] | null | undefined;

const LETTERS = "ABCDE";
export const campLetter = (g: number) => LETTERS[g] ?? String(g + 1);
/** "Klima zuerst", or "Lager A" while the camp has no name. */
export const campName = (names: CampNames, g: number) => names?.[g]?.trim() || `Lager ${campLetter(g)}`;
/** „Lager „Klima zuerst““ reads badly: the named camp in quotes, the unnamed one plain. */
export const campLabel = (names: CampNames, g: number) => (names?.[g]?.trim() ? `Lager „${names[g]!.trim()}“` : `Lager ${campLetter(g)}`);

const WORDS = ["null", "eine", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
/** Small numbers as words, as in a written report ("Elf von neunzehn" reads, "11 von 19" counts). */
export const word = (n: number, female = true) => (n === 1 ? (female ? "eine" : "ein") : (WORDS[n] ?? String(n)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "A, B und C" */
const andList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);
export const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

const both = (k: number) => (k === 2 ? "beide" : "alle");
const bothDat = (k: number) => (k === 2 ? "beiden" : "allen");

export function categoryWords(c: Category, k: number): { label: string; pill: string } {
  switch (c) {
    case "bruecke":
      return { label: `Darauf einigen sich ${both(k)} Lager`, pill: `${cap(both(k))} Lager stimmen zu` };
    case "streit":
      return { label: "Hier liegt der Streit", pill: "Die Lager stehen gegeneinander" };
    case "warnung":
      return { label: "Vorsicht, Scheinkonsens", pill: "Einig, aber aus gegensätzlichen Gründen" };
    case "klaerbar":
      return { label: "Mit einem Gutachten klärbar", pill: "Faktenstreit, der sich auflösen lässt" };
    case "offen":
      return { label: "Offen geblieben", pill: "Kein Lager hat sich festgelegt" };
  }
}

/** The pill of one statement — a joint rejection is a bridge too, but says so. */
export function pillOf(s: StatementOut, k: number, t: number): string {
  if (s.profile === "abgelehnt") return `${cap(both(k))} Lager lehnen ab`;
  if (s.category === "offen" && s.typ === "T" && !proven(s)) return "Ohne Beleg geblieben";
  return groupWords(groupOf(s, t), k).pill;
}

export const ORDER: Category[] = ["streit", "warnung", "klaerbar", "offen", "bruecke"];

export const TYP_WORDS = { T: "Tatsachenfrage", W: "Wertungsfrage", verfahren: "Frage der Ausgestaltung" } as const;

export function statusWords(s: Status, k: number): { text: string; tone: "ok" | "warn" | "bad" | "grey" } {
  const b = bothDat(k);
  switch (s) {
    case "abgewehrt":
      return { text: "abgewehrt", tone: "ok" };
    case "klaerbar":
      return { text: "klärbar", tone: "warn" };
    case "offen":
      return { text: "offen", tone: "grey" };
    case "haelt":
      return { text: "hält", tone: "bad" };
    case "verdeckt":
      return { text: "verdeckt als Zustimmung", tone: "warn" };
    case "getragen":
      return { text: `in ${b} Lagern getragen`, tone: "ok" };
    case "einseitig":
      return { text: "nur in einem Teil der Lager getragen", tone: "bad" };
    case "schwach":
      return { text: "in keinem Lager getragen", tone: "grey" };
    case "abgelehnt":
      return { text: `in ${b} Lagern abgelehnt`, tone: "bad" };
  }
}

export const VERDICT_WORDS: Record<Verdict, { text: string; tone: "ok" | "warn" | "bad" }> = {
  haelt: { text: "hält", tone: "ok" },
  wackelt: { text: "wackelt", tone: "warn" },
  faellt: { text: "fällt", tone: "bad" },
};

export const BELEG_WORDS: Record<BelegKey, string> = {
  messdaten: "eigene Zahlen",
  studie: "Studie oder Gutachten",
  vergleichsfall: "Vergleichsfall",
  behauptung: "behauptet, ohne Quelle",
  keine: "ohne Beleg",
};
const BELEG_ORDER: BelegKey[] = ["messdaten", "studie", "vergleichsfall", "behauptung", "keine"];

/** Evidence that is more than a claim (PROOF in befund.ts, repeated so this file stays browser-safe). */
const PROOF_KEYS = ["messdaten", "studie", "vergleichsfall"] as const;
const hasProof = (e: Partial<Record<BelegKey, number>>) => PROOF_KEYS.some((b) => (e[b] ?? 0) > 0);

export const proven = (s: StatementOut) => hasProof(s.evidence.dafuer) || hasProof(s.evidence.dagegen);

/**
 * "Belegt, aber nicht angekommen" (Stephan's deck, slides 16–17): a fact question the camps are not agreed on,
 * where proof — own figures, a study, a comparable case — stands on one side only and the other side only
 * asserts, or says nothing. No expert report is needed; someone has to explain the evidence to the camps it
 * has not reached. By class, not by head count (I10): one study outweighs any number of bare repetitions.
 * Proof on both sides, or on none, stays a question for an expert report.
 *   side   where the proof stands: for the statement, or against it
 *   camps  the camps it has not reached: for proof in favour those who do not carry the statement, for proof
 *          against it those who do not reject it (camps with too few votes are left out)
 */
export function mediation(s: StatementOut, t: number): { side: "dafuer" | "dagegen"; camps: number[] } | null {
  if (s.typ !== "T" || s.category !== "klaerbar") return null;
  const pro = hasProof(s.evidence.dafuer);
  if (pro === hasProof(s.evidence.dagegen)) return null;
  const camps = s.camps.flatMap((c, g) => (c.seen >= MIN_CAMP_VOTES && !(pro ? carries(c, t) : rejects(c, t)) ? [g] : []));
  return camps.length ? { side: pro ? "dafuer" : "dagegen", camps } : null;
}

/** The groups of "Nach Befund": the five findings, the fact questions with one-sided proof apart. */
export type Group = Category | "vermittlung";
export const GROUP_ORDER: Group[] = ["streit", "warnung", "vermittlung", "klaerbar", "offen", "bruecke"];
export const groupOf = (s: StatementOut, t: number): Group => (mediation(s, t) ? "vermittlung" : s.category);
export function groupWords(g: Group, k: number): { label: string; pill: string } {
  return g === "vermittlung" ? { label: "Belegt, aber nicht angekommen", pill: "Vermittlung statt Gutachten" } : categoryWords(g, k);
}

/** "Für die Aussage gibt es Belege, dagegen keine. Im Lager „A“ ist das nicht angekommen. …" */
function mediationText(s: StatementOut, m: { side: "dafuer" | "dagegen"; camps: number[] }, names: CampNames): string {
  const pro = m.side === "dafuer";
  const other = pro ? s.evidence.dagegen : s.evidence.dafuer;
  const asserted = Object.values(other).some((n) => (n ?? 0) > 0);
  const proof = `${pro ? "Für" : "Gegen"} die Aussage gibt es Belege, ${pro ? "dagegen" : "dafür"} ${asserted ? "nur Behauptungen ohne Beleg" : "keine"}.`;
  const all = m.camps.length === s.camps.length;
  const where = all ? "Angekommen ist das in keinem Lager." : `${cap(andList(m.camps.map((g) => `im ${campLabel(names, g)}`)))} ist das nicht angekommen.`;
  const whom = all ? (s.camps.length === 2 ? "beiden Lagern" : "allen Lagern") : andList(m.camps.map((g) => `dem ${campLabel(names, g)}`));
  return `${proof} ${where} Ein Gutachten braucht es nicht, sondern Vermittlung: Jemand muss ${whom} die Belege erklären.`;
}

/** W7: "1 × eigene Zahlen, 2 × behauptet" — evidence by class, the strong classes first. */
export function evidenceText(s: StatementOut): string | null {
  const side = (e: Partial<Record<BelegKey, number>>) =>
    BELEG_ORDER.filter((b) => e[b])
      .map((b) => `${e[b]} × ${BELEG_WORDS[b]}`)
      .join(", ");
  const d = side(s.evidence.dafuer);
  const g = side(s.evidence.dagegen);
  if (!d && !g) return null;
  return [d ? `Dafür: ${d}.` : "", g ? `Dagegen: ${g}.` : ""].filter(Boolean).join(" ");
}

export { MIN_CAMP_VOTES };

/** "62 % im Lager „A“, zu wenige Stimmen im Lager „B“": no percentage where a camp hardly voted. */
export function campShares(s: StatementOut, names: CampNames, field: "agree" | "disagree" = "agree"): string {
  return s.camps.map((c, g) => (c.seen < MIN_CAMP_VOTES ? `zu wenige Stimmen im ${campLabel(names, g)}` : `${pct(c[field], c.seen)} % im ${campLabel(names, g)}`)).join(", ");
}

const perCamp = campShares;

/**
 * Who stands where on one statement, for any number of camps: "das Lager „A“ stimmt zu (86 % dafür, 9 %
 * dagegen) und das Lager „B“ lehnt ab (19 % dafür, 72 % dagegen)". The verb is the camp's position by the
 * bridge rule; both shares stand with it, so "unentschieden" at 23 % dafür explains itself.
 */
export function sidesText(s: StatementOut, names: CampNames, t: number): string {
  return andList(
    s.camps.map((c, g) => {
      const who = `das ${campLabel(names, g)}`;
      if (c.seen < MIN_CAMP_VOTES) return `${who} hat zu wenig abgestimmt`;
      const p = `${pct(c.agree, c.seen)} % dafür, ${pct(c.disagree, c.seen)} % dagegen`;
      return carries(c, t) ? `${who} stimmt zu (${p})` : rejects(c, t) ? `${who} lehnt ab (${p})` : `${who} ist unentschieden (${p})`;
    }),
  );
}

/** With three or more camps: which two stand closest, which two furthest apart. Null otherwise. */
export function pairsText(r: Ergebnis, names: CampNames): string | null {
  const ps = r.pairs;
  if (!ps || ps.length < 2) return null;
  const score = (x: (typeof ps)[number]) => x.einig - x.getrennt;
  const sorted = [...ps].sort((a, b) => score(b) - score(a) || a.camps[0] - b.camps[0] || a.camps[1] - b.camps[1]);
  const close = sorted[0]!;
  const far = sorted[sorted.length - 1]!;
  const two = (x: (typeof ps)[number]) => `das ${campLabel(names, x.camps[0])} und das ${campLabel(names, x.camps[1])}`;
  // Dative after "bei": "bei keiner", "bei einer", "bei sieben".
  const n = (x: number) => (x === 0 ? "keiner" : x === 1 ? "einer" : x <= 12 ? word(x) : String(x));
  return (
    `Am nächsten stehen sich ${two(close)}: Bei ${n(close.einig)} ${pl(close.einig, "Aussage", "Aussagen")} haben sie dieselbe Haltung, bei ${n(close.getrennt)} trennen sie sich. ` +
    `Am weitesten auseinander liegen ${two(far)}: dieselbe Haltung bei ${n(far.einig)}, getrennt bei ${n(far.getrennt)}.`
  );
}

/** The reading of one statement ("Befund"), from its profile, type and role. */
export function readingOf(s: StatementOut, r: Ergebnis, names: CampNames): string[] {
  const k = r.camps?.k ?? 0;
  if (k < 2) return ["Für Lager haben noch zu wenige Menschen abgestimmt."];
  const out: string[] = [];
  const attack = s.rolle === "beitrag" && s.richtung === "greift_an";
  if (s.rolle === "schluss") out.push("Die Maßnahme selbst.");
  switch (s.profile) {
    case "getragen":
      out.push(`${cap(both(k))} Lager stimmen zu: ${perCamp(s, names, "agree")}.`);
      break;
    case "abgelehnt":
      out.push(`${cap(both(k))} Lager lehnen ab: ${perCamp(s, names, "disagree")} stimmen nicht zu.`);
      break;
    case "trennt":
      out.push(`Die Lager trennen sich: ${perCamp(s, names, "agree")} stimmen zu.`);
      break;
    default:
      out.push(`Kein Lager hat sich festgelegt: ${perCamp(s, names, "agree")} stimmen zu.`);
  }
  switch (s.category) {
    case "bruecke":
      if (s.profile === "abgelehnt") out.push(attack ? "Der Einwand überzeugt in keinem Lager." : "Die Behauptung überzeugt in keinem Lager; auf sie lässt sich die Maßnahme nicht stützen.");
      else if (attack) out.push(`Der Einwand überzeugt in ${bothDat(k)} Lagern. Ein Beschluss muss ihn beantworten.`);
      else if (!firmBridge(s)) out.push("Die Einigkeit ist aber nicht belastbar; die Prüfungen unten zeigen, woran es hängt. Allein trägt sie keinen Beschluss.");
      else out.push(`Ein Ansatzpunkt für einen Beschluss, der in ${bothDat(k)} Lagern trägt.`);
      break;
    case "warnung":
      out.push(
        "Die Zustimmung trägt nicht: Ein Teil der Beiträge sagt Ja, um die Maßnahme zu stützen, ein anderer, um sie abzuschwächen. Ein Beschluss, der sich auf diese Zahl stützt, zerbricht bei der ersten Ausgestaltungsfrage. Als Verhandlungsgegenstand behandeln, mit offengelegten Zwecken.",
      );
      break;
    case "streit":
      if (s.typ === "W") {
        if (overall(r).core[0] === s.nr) out.push("Hier entscheidet sich der Streit: Bei keiner anderen Wertungsfrage liegen die Lager so weit auseinander.");
        out.push("Das kann kein Gutachten beantworten. Die Frage gehört in den Rat, ausdrücklich als Wertentscheidung.");
      } else out.push("Eine Frage der Ausgestaltung: Der Rat kann sie im Beschluss regeln, hier lässt sich verhandeln.");
      break;
    case "klaerbar": {
      const m = mediation(s, r.params.bridgeThreshold);
      if (m) {
        out.push(`${s.profile === "trennt" ? "Eine Tatsachenfrage, über die die Lager uneins sind." : "Eine Tatsachenfrage, zu der sich noch kein Lager festgelegt hat."} ${mediationText(s, m, names)}`);
        break;
      }
      out.push(
        s.profile === "trennt"
          ? `Eine Tatsachenfrage, über die die Lager uneins sind. Ein Gutachten kann sie klären${proven(s) ? (hasProof(s.evidence.dafuer) && hasProof(s.evidence.dagegen) ? "; Belege liegen auf beiden Seiten vor" : "; Belege dazu liegen teils schon vor") : ""}.`
          : "Eine Tatsachenfrage, zu der Belege vorliegen, aber noch kein Lager hat sich festgelegt. Ein Gutachten kann sie klären.",
      );
      break;
    }
    case "offen":
      if (s.typ === "T") out.push(proven(s) ? "Belege liegen vor, aber sie haben kein Lager überzeugt. Vor einem Beschluss zu prüfen." : "Im Verfahren ohne Beleg geblieben. Vor einem Beschluss nachzuliefern.");
      else out.push("Keines der Lager hat dazu eine klare Meinung.");
      break;
  }
  return out;
}

/** The verdict on one step, in sentences: "Die Stufe hält. Zwei Angriffe sind abgewehrt, …" */
export function stepText(step: StepOut, r: Ergebnis): string {
  const c = step.counts;
  const n = (x: Status) => c[x] ?? 0;
  // [count, verb (one), verb (many), rest] — the first part names the attacks, the others continue it.
  const raw: [number, string, string, string][] = [
    [n("abgewehrt"), "ist", "sind", "abgewehrt"],
    [n("klaerbar"), "lässt", "lassen", "sich klären"],
    [n("offen"), "ist", "sind", "offen"],
    [n("haelt"), "steht", "stehen", ""],
    [n("verdeckt"), "versteckt", "verstecken", "sich hinter einer Zustimmung"],
  ];
  const parts = raw
    .filter(([x]) => x > 0)
    // "Zwei Angriffe sind abgewehrt und einer ist offen": a later part stands for "Angriff" — "einer", not "ein".
    .map(([x, one, many, rest], i) => `${i === 0 ? `${word(x, false)} ${pl(x, "Angriff", "Angriffe")}` : x === 1 ? "einer" : word(x, false)} ${pl(x, one, many)}${rest ? ` ${rest}` : ""}`);
  const out = [`Die Stufe ${VERDICT_WORDS[step.verdict].text}.`];
  if (!step.attacks) out.push("Niemand hat sie angegriffen.");
  else out.push(cap(parts.join(", ").replace(/, ([^,]*)$/, " und $1")) + ".");
  if (step.verdict === "faellt") {
    const values = r.statements.some((s) => s.typ === "W" && s.entries.some((e) => e.step === step.key && e.role === "greift_an" && e.status === "haelt"));
    out.push(values ? "Was hier steht, sind Wertungen: Keine Evidenz kann sie abwehren." : "Eine Wertung der Stadt teilt nicht jedes Lager, und das kann keine Evidenz ändern.");
  }
  const weak = c.einseitig ?? 0;
  if (weak && step.verdict !== "faellt") out.push(`${cap(word(weak))} ${pl(weak, "Stütze trägt", "Stützen tragen")} nur in einem Teil der Lager.`);
  // Without any attack every possible objection is unraised; saying so twice reads like a contradiction.
  if (step.attacks && step.unasked.length) {
    out.push(`${step.unasked.length === 1 ? "Einen möglichen Einwand" : `${cap(word(step.unasked.length))} mögliche Einwände`} hat niemand erhoben.`);
  }
  return out.join(" ");
}

/**
 * "Stufe 1 und 2 halten, Stufe 3 wackelt, Stufe 4 fällt." — or, for a reader who has not seen the step
 * scheme (the report), by name: "Die Stufen „So ist die Lage“ und „…“ halten, „…“ wackelt, „…“ fällt."
 */
export function stepsLine(r: Ergebnis, byName = false): string {
  const by = (v: Verdict) => r.steps.flatMap((s, i) => (s.verdict === v ? [byName ? `„${s.label}“` : String(i + 1)] : []));
  const verb: Record<Verdict, [string, string]> = { haelt: ["hält", "halten"], wackelt: ["wackelt", "wackeln"], faellt: ["fällt", "fallen"] };
  const groups = (["haelt", "wackelt", "faellt"] as Verdict[]).map((v) => ({ v, xs: by(v) })).filter((g) => g.xs.length);
  const parts = groups.map(({ v, xs }, i) => {
    const head = !byName ? "Stufe " : i === 0 ? (xs.length === 1 ? "Die Stufe " : "Die Stufen ") : "";
    return `${head}${andList(xs)} ${xs.length === 1 ? verb[v][0] : verb[v][1]}`;
  });
  return `${parts.join(", ")}.`;
}

/** "Also": the conclusion from the four verdicts. */
export function conclusionText(r: Ergebnis, byName = false): string {
  const root = r.statements.find((s) => s.rolle === "schluss")?.text ?? "die Maßnahme";
  const falls = r.steps.some((s) => s.verdict === "faellt");
  const shaky = r.steps.some((s) => s.verdict === "wackelt");
  const line = stepsLine(r, byName);
  if (falls && !shaky)
    return `${line} Der Schluss „${root}“ ist nicht widerlegt, aber er ist auch nicht aus Evidenz zu ziehen: Was ihn trägt oder kippt, ist eine Wertung. Sie gehört in den Rat.`;
  if (falls) return `${line} Der Schluss „${root}“ hängt an einer Wertung, die der Rat entscheiden muss, und an Punkten, die sich vorher klären oder ausgestalten lassen.`;
  if (shaky) return `${line} Der Schluss „${root}“ hängt an Punkten, die sich klären oder ausgestalten lassen. Vor einem Beschluss zu schließen.`;
  return `${line} Die Begründung trägt in allen vier Stufen.`;
}

/** The short "Also" under the step scheme: where the conclusion hangs. */
export function schemeConclusion(r: Ergebnis): string {
  const falls = r.steps.map((s, i) => (s.verdict === "faellt" ? i + 1 : 0)).filter(Boolean);
  const shaky = r.steps.map((s, i) => (s.verdict === "wackelt" ? i + 1 : 0)).filter(Boolean);
  if (falls.length) return `Der Schluss hängt an Stufe ${falls.join(" und ")}. Dort steht, was keine Evidenz abwehren kann.`;
  if (shaky.length) return `Der Schluss hängt an Stufe ${shaky.join(" und ")}. Was dort steht, lässt sich klären oder ausgestalten.`;
  return "Alle vier Stufen halten.";
}

export type Segment = { text: string } | { text: string; nr: number };

/**
 * The diagnosis across all camps and the core of the dispute. Results stored before 2026-11-20 compared
 * only camps A and B there; for them (three or more camps) both are worked out again from the statements,
 * so the headline never contradicts the sections.
 */
export function overall(r: Ergebnis): { d: Diagnosis | null; core: number[] } {
  const k = r.camps?.k ?? 0;
  const d = r.diagnoses[0] ?? null;
  if (k < 3 || !d || d.camps.length === k) return { d, core: r.core };
  const core = r.statements
    .filter((s) => s.rolle !== "schluss" && s.typ === "W" && s.profile === "trennt")
    .sort((a, b) => b.gap - a.gap || a.nr - b.nr)
    .map((s) => s.nr);
  return { d: diagnoseCamps(r.statements, Array.from({ length: k }, (_, g) => g), r.params.bridgeThreshold), core };
}

/**
 * What divides the camps, counted the way the report's sections count it: value questions and design
 * questions (the council decides) and fact questions the camps are split on (a study can settle them).
 * The measure itself is not among them; it has its own sentence.
 */
export function disputeCounts(r: Ergebnis): { values: number; design: number; facts: number; mediate: number } {
  const own = r.statements.filter((s) => s.rolle !== "schluss");
  const facts = own.filter((s) => s.category === "klaerbar" && s.profile === "trennt");
  return {
    values: own.filter((s) => s.category === "streit" && s.typ === "W").length,
    design: own.filter((s) => s.category === "streit" && s.typ !== "W").length,
    facts: facts.length,
    // Of those, the ones where proof stands on one side only: explained, not studied.
    mediate: facts.filter((s) => mediation(s, r.params.bridgeThreshold)).length,
  };
}

/** Who settles the fact questions: an expert report — or, where proof stands on one side only, explaining it. */
function factsLine(facts: number, mediate: number, council: string): string {
  if (!mediate) return `Die Tatsachen kann ein Gutachten klären, ${council} entscheidet der Rat.`;
  const explained = "liegen die Belege schon auf einer Seite; sie müssen erklärt, nicht begutachtet werden.";
  if (mediate === facts) return `Bei ${facts === 1 ? "der Tatsachenfrage" : "den Tatsachenfragen"} ${explained} ${cap(council)} entscheidet der Rat.`;
  return `Bei ${mediate === 1 ? "einer" : word(mediate)} der Tatsachenfragen ${explained} Die übrigen kann ein Gutachten klären, ${council} entscheidet der Rat.`;
}

/** The headline under the title: how many statements carry, and what the dispute comes down to. */
export function headline(r: Ergebnis): { lead: string; rest: Segment[] } {
  const k = r.camps?.k ?? 0;
  const n = r.statements.length;
  // Counted as the report counts: firm bridges, bridges that did not pass a check, agreement only for show.
  const firm = r.statements.filter((s) => s.profile === "getragen" && firmBridge(s)).length;
  const shaky = r.statements.filter((s) => s.profile === "getragen" && s.category === "bruecke" && !firmBridge(s)).length;
  const sham = r.statements.filter((s) => s.category === "warnung").length;
  const rejected = r.statements.filter((s) => s.profile === "abgelehnt").length;
  const more = (x: number) => (x === 1 ? "eine weitere" : `${word(x)} weitere`);
  const extra = [shaky ? `${more(shaky)} nur unter Vorbehalt` : "", sham ? `${more(sham)} nur zum Schein` : "", rejected ? `${word(rejected)} lehnen ${both(k)} ab` : ""].filter(Boolean);
  const lead =
    (n === 1
      ? `Die einzige Aussage trägt ${firm ? "" : "nicht "}in ${bothDat(k)} Lagern`
      : firm
        ? `${cap(word(firm))} von ${word(n)} Aussagen ${pl(firm, "trägt", "tragen")} in ${bothDat(k)} Lagern`
        : `Keine der ${word(n)} Aussagen trägt in ${bothDat(k)} Lagern`) + (extra.length ? `, ${andList(extra)}.` : ".");
  const o = overall(r);
  const d = o.d;
  if (!d) return { lead, rest: [] };
  const core = o.core[0] ? r.statements.find((s) => s.nr === o.core[0]) : undefined;
  const { values: vals, design, facts, mediate } = disputeCounts(r);
  const kinds = andList(
    [
      vals ? `${word(vals)} ${pl(vals, "Wertungsfrage", "Wertungsfragen")}` : "",
      design ? `${word(design)} ${pl(design, "Frage", "Fragen")} der Ausgestaltung` : "",
      facts ? `${word(facts)} ${pl(facts, "Tatsachenfrage", "Tatsachenfragen")}` : "",
    ].filter(Boolean),
  );
  const coreSegs: Segment[] = core ? [{ text: "Am weitesten auseinander liegen die Lager hier", nr: core.nr }, { text: `: „${core.text}“ ` }] : [];
  const designNote = design ? ` Dazu ${pl(design, "kommt eine Frage", `kommen ${word(design)} Fragen`)} der Ausgestaltung, die der Rat im Beschluss regeln kann.` : "";
  switch (d.art) {
    case "wertkonflikt":
      return {
        lead,
        rest:
          vals === 1 && core
            ? [
                { text: "Der ganze Streit hat sich auf " },
                { text: "eine einzige Wertungsfrage", nr: core.nr },
                { text: ` verengt: „${core.text}“ Das entscheidet kein Gutachten. Das entscheidet der Rat.${designNote}` },
              ]
            : [{ text: `Die Lager trennen ${kinds}, aber keine Tatsachenfrage. ` }, ...coreSegs, { text: "Das entscheidet kein Gutachten. Das entscheidet der Rat." }],
      };
    case "scheinfaktenstreit":
      return {
        lead,
        rest: [
          {
            text: `Gestritten wird über Tatsachen: ${
              mediate
                ? `Bei ${mediate === 1 ? "einer" : word(mediate)} von ${word(facts)} ${pl(facts, "Frage", "Fragen")} liegen die Belege schon auf einer Seite und müssen nur erklärt werden${facts > mediate ? `, ${word(facts - mediate)} ${pl(facts - mediate, "lässt", "lassen")} sich mit einem Gutachten klären` : ""}.`
                : `${word(facts)} ${pl(facts, "Frage lässt", "Fragen lassen")} sich mit einem Gutachten klären.`
            } In den Wertungen sind sich die Lager näher, als es scheint.${designNote}`,
          },
        ],
      };
    case "gemischt":
      return {
        lead,
        rest: [{ text: `Die Lager trennen ${kinds}. ${factsLine(facts, mediate, design ? "Wertungen und Ausgestaltung" : "die Wertungen")} ` }, ...coreSegs],
      };
    default:
      return { lead, rest: [{ text: design ? `Die Lager trennen nur ${kinds}. Der Rat kann sie im Beschluss regeln.` : "Keine Aussage trennt die Lager." }] };
  }
}

/** W5 in words: the measure itself and what divides the camps — all of them, or the pair `i` points to. */
export function diagnosisText(r: Ergebnis, names: CampNames, i = 0): string {
  const d = i === 0 ? overall(r).d : r.diagnoses[i];
  if (!d) return "";
  const gs = d.camps;
  const two = gs.length === 2;
  const who = two ? `das ${campLabel(names, gs[0]!)} und das ${campLabel(names, gs[1]!)}` : `die ${word(gs.length, false)} Lager`;
  const root = r.statements.find((s) => s.rolle === "schluss");
  // diagnoses[0] compares all camps (in order); with three or more, say who stands where.
  const where = !two && root ? `: ${sidesText(root, names, r.params.bridgeThreshold)}` : "";
  const s = {
    bruecke_gruende: `Über die Maßnahme selbst sind sich ${who} einig, und auch über die Gründe der Stadt: eine Brücke der Gründe, die hält.`,
    bruecke_ergebnisse: `Über die Maßnahme selbst sind sich ${who} einig, aber nicht über die Gründe dafür: eine Brücke der Ergebnisse, die bei der ersten Ausgestaltungsfrage brechen kann.`,
    abgelehnt: two ? `Die Maßnahme selbst lehnen ${who} beide ab.` : `Die Maßnahme selbst lehnen ${who} ab.`,
    streit: `Über die Maßnahme selbst sind sich ${who} nicht einig${where}.`,
    offen: two
      ? `Über die Maßnahme selbst hat sich weder das ${campLabel(names, gs[0]!)} noch das ${campLabel(names, gs[1]!)} klar festgelegt.`
      : "Über die Maßnahme selbst hat sich keines der Lager klar festgelegt.",
  }[d.schluss];
  const a = {
    wertkonflikt: "Die Tatsachen sind zwischen ihnen nicht strittig; was sie trennt, sind Wertungen: ein klarer Wertkonflikt.",
    scheinfaktenstreit: "In den Wertungen trennt sie nichts; gestritten wird über Tatsachen, die sich klären lassen: ein Scheinfaktenstreit.",
    gemischt: "Sie trennen Wertungen und Tatsachen zugleich.",
    // Design questions are not part of the fact/value diagnosis; with all camps compared, name them if they divide.
    einig: i === 0 && disputeCounts(r).design ? "Wertungen und Tatsachen trennen sie nicht, nur Fragen der Ausgestaltung." : i === 0 ? "Keine Aussage trennt sie." : "Keine Wertungs- oder Tatsachenfrage trennt sie.",
  }[d.art];
  return `${s} ${a}`;
}

const questionLabel = (questions: { key: string; label: string }[], key: string) => questions.find((q) => q.key === key)?.label ?? key;

/** W6 in words: what nobody asked, what only one side spoke to. */
export function gapTexts(r: Ergebnis, questions: { key: string; label: string }[]): { title: string; text: string }[] {
  const label = (key: string) => r.steps.find((s) => s.key === key)?.label ?? key;
  const out: { title: string; text: string }[] = [];
  for (const g of r.gaps.unasked) {
    out.push({
      title: questionLabel(questions, g.question),
      text: `Diesen Einwand zur Stufe „${label(g.step)}“ hat niemand erhoben, und niemand hat ihn beantwortet. Das ist ein Ergebnis, kein Fehlen. Vor einem Beschluss zu schließen, durch die Verwaltung oder eine gezielte Nachfrage.`,
    });
  }
  for (const g of r.gaps.oneSided) {
    const n = g.nodes.length;
    out.push({
      title: questionLabel(questions, g.question),
      text:
        g.direction === "greift_an"
          ? `In der Stufe „${label(g.step)}“ nur als Einwand vorgebracht (${n} ${pl(n, "Aussage", "Aussagen")}), niemand hat darauf geantwortet. Die Stadt sollte die Antwort nachliefern.`
          : `In der Stufe „${label(g.step)}“ nur von einer Seite angesprochen (${n} ${pl(n, "Aussage", "Aussagen")}, alle stützend). Von denen, die das anders sehen, liegt nichts vor.`,
    });
  }
  return out;
}

// ———— Too few people for camps: counts and arguments, no verdicts ————
// Below the camp threshold the page and the report count everyone together. A majority of a
// handful is a show of hands, not a finding, so nothing here says "trägt", "Brücke" or "Streit".

export type Tally = "zu" | "geteilt" | "ab" | "ohne";
export const TALLY_ORDER: Tally[] = ["zu", "geteilt", "ab", "ohne"];
export const TALLY_WORDS: Record<Tally, string> = {
  zu: "Die Mehrheit stimmt zu",
  geteilt: "Geteilt",
  ab: "Die Mehrheit lehnt ab",
  ohne: "Noch ohne Stimmen",
};

/** More than half of those who voted on the statement agree (or disagree); otherwise split. */
export function tallyOf(s: StatementOut): Tally {
  const t = s.total;
  if (!t.seen) return "ohne";
  if (2 * t.agree > t.seen) return "zu";
  if (2 * t.disagree > t.seen) return "ab";
  return "geteilt";
}

/** "3 von 4 stimmen zu, 1 lehnt ab." */
export function countLine(s: StatementOut): string {
  const t = s.total;
  if (!t.seen) return "Dazu hat noch niemand abgestimmt.";
  const parts = [`${t.agree} von ${t.seen} ${pl(t.agree, "stimmt", "stimmen")} zu`];
  if (t.disagree) parts.push(`${t.disagree} ${pl(t.disagree, "lehnt", "lehnen")} ab`);
  if (t.pass) parts.push(`${t.pass} ${pl(t.pass, "enthält sich", "enthalten sich")}`);
  return `${parts.join(", ").replace(/, ([^,]*)$/, " und $1")}.`;
}

/** Why there are no camps, with the two numbers. */
export function smallNote(r: Ergebnis): string {
  const why = alike(r)
    ? `Lager zeigen sich hier nicht: ${r.clusterable <= 12 ? cap(word(r.clusterable, false)) : r.clusterable} Menschen haben genug Aussagen bewertet, aber so ähnlich, dass sich keine Gruppen unterscheiden lassen.`
    : `Lager zeigen sich erst, wenn mindestens ${r.needed} Menschen genug Aussagen bewertet haben; ${
        r.clusterable === 0 ? "das hat hier noch niemand" : r.clusterable === 1 ? "das hat hier eine Person" : `das haben hier ${word(r.clusterable)} Personen`
      }.`;
  return `${why} Deshalb zählt diese Seite die Stimmen aller zusammen und zeigt die Argumente, aber kein Urteil über Brücken, Streit oder die vier Stufen.`;
}

/** No camps although enough people voted: they all voted alike (k-means finds no second position). */
export const alike = (r: Ergebnis) => !r.ready && r.clusterable >= r.needed;

/** The headline without camps: how the statements split, counted over everyone. */
export function smallHeadline(r: Ergebnis): { lead: string; rest: Segment[] } {
  const by = (t: Tally) => r.statements.filter((s) => tallyOf(s) === t).length;
  const [zu, ab, geteilt, ohne] = [by("zu"), by("ab"), by("geteilt"), by("ohne")];
  // Dative after "bei": "bei einer Aussage", "bei sieben".
  const dat = (x: number) => (x === 1 ? "einer" : word(x));
  const parts = [
    zu ? `bei ${dat(zu)} ${pl(zu, "Aussage", "Aussagen")} stimmt die Mehrheit zu` : "",
    ab ? `bei ${dat(ab)} lehnt sie ab` : "",
    geteilt ? `${word(geteilt)} ${pl(geteilt, "ist", "sind")} geteilt` : "",
    ohne ? `${word(ohne)} ${pl(ohne, "hat", "haben")} noch keine Stimme` : "",
  ].filter(Boolean);
  return {
    lead: alike(r) ? "Keine Lager: Alle stimmen ähnlich ab." : "Zu wenige Teilnehmende für Lager.",
    rest: [{ text: parts.length ? `Gezählt über alle zusammen: ${parts.join(", ").replace(/, ([^,]*)$/, " und $1")}.` : "Noch hat niemand abgestimmt." }],
  };
}

/** A step without camps: what was said for and against it, and which questions nobody raised. */
export function stepCountText(step: StepOut): string {
  const sup = step.supports ? `${cap(word(step.supports))} ${pl(step.supports, "Aussage stützt", "Aussagen stützen")} die Stufe` : "Keine Aussage stützt die Stufe";
  const att = step.attacks ? `${word(step.attacks)} ${pl(step.attacks, "greift", "greifen")} sie an` : "keine greift sie an";
  const out = [`${sup}, ${att}.`];
  if (step.unasked.length) out.push(`${step.unasked.length === 1 ? "Einen Einwand" : `${cap(word(step.unasked.length))} Einwände`} hat niemand erhoben.`);
  out.push("Ob ein Einwand steht, lässt sich ohne Lager nicht sagen.");
  return out.join(" ");
}

// ———— Stephan's three conditions for a bridge ————

/** A bridge that passed every check (an older stored result has no checks: it stands as it was). */
export function firmBridge(s: StatementOut): boolean {
  return s.category === "bruecke" && (!s.check || (s.check.robust && s.check.lot?.status !== "faellt"));
}

export interface CheckLine {
  /** true: met · false: not met · null: could not be checked */
  ok: boolean | null;
  title: string;
  text: string;
}

const camps1 = (names: CampNames, gs: number[]) => {
  const xs = gs.map((g) => `im ${campLabel(names, g)}`);
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`;
};

/** The three conditions of one bridge, in plain words (results page). Empty for anything but a bridge. */
export function checkLines(s: StatementOut, r: Ergebnis, names: CampNames): CheckLine[] {
  if (s.category !== "bruecke" || !s.check) return [];
  const k = r.camps?.k ?? 0;
  const no = s.profile === "abgelehnt";
  const verb = no ? "lehnen ab" : "stimmen zu";
  const out: CheckLine[] = [
    {
      ok: true,
      title: `Genug Stimmen aus ${bothDat(k)} Lagern`,
      text: `In jedem Lager haben genug Menschen abgestimmt, und das Ergebnis ist kein Zufall der kleinen Zahl.`,
    },
    s.check.robust
      ? {
          ok: true,
          title: "Hängt nicht an wenigen Stimmen",
          text: `Auch ohne ein Zehntel der ${no ? "Ablehnung" : "Zustimmung"} in jedem Lager bliebe es eine Brücke.`,
        }
      : {
          ok: false,
          title: "Hängt an wenigen Stimmen",
          text: `Ohne ein Zehntel der ${no ? "Ablehnung" : "Zustimmung"} ${camps1(names, s.check.fragile)} fiele die Einigkeit unter die Schwelle. Wenige abgestimmte Stimmen könnten sie hergestellt haben.`,
        },
  ];
  const lot = s.check.lot;
  if (!lot) {
    out.push({ ok: null, title: "Keine Gegenprobe durch Los", text: "In diesem Verfahren gab es keine ausgelosten Teilnehmenden, die per Brief eingeladen wurden." });
  } else if (lot.status === "zu_wenige") {
    out.push({
      ok: null,
      title: "Gegenprobe nicht möglich",
      text: `Zu wenige Ausgeloste haben über diese Aussage abgestimmt (${lot.camps.map((c, g) => `${c.seen} ${campLabel(names, g).replace(/^Lager/, "im Lager")}`).join(", ")}; nötig sind je 5).`,
    });
  } else {
    const field = no ? "disagree" : "agree";
    const t = r.params.bridgeThreshold;
    const low = (c: CampCount) => c.seen > 0 && c[field] / c.seen < t;
    const nums = (pick: (c: CampCount) => boolean) =>
      lot.camps.flatMap((c, g) => (pick(c) ? [`im ${campLabel(names, g)} ${c[field]} von ${c.seen}`] : [])).join(", ");
    const [v1, v2] = verb.split(" ") as [string, string];
    out.push(
      lot.status === "haelt"
        ? { ok: true, title: "Hält auch bei den Ausgelosten", text: `Von denen, die per Los eingeladen wurden, ${v1} ${nums(() => true)} ${v2}.` }
        : {
            ok: false,
            title: "Hält nur bei den Selbstgewählten",
            text: `Von denen, die per Los eingeladen wurden, ${v1} ${nums(low).replace(/(\d+ von)/g, "nur $1")} ${v2}${nums((c) => !low(c)) ? ` (${nums((c) => !low(c))})` : ""}. Wer von sich aus mitgemacht hat, sieht das anders als die Stichprobe.`,
          },
    );
  }
  return out;
}

/** The cross-check over all bridges, for the method text and the report. Null when nothing was checked. */
export function lotSummary(r: Ergebnis): { drawn: number; firm: number; onlySelf: number; tooFew: number; bridges: number } | null {
  const drawn = r.participation.drawn ?? 0;
  if (!drawn) return null;
  const bridges = r.statements.filter((s) => s.category === "bruecke" && s.check?.lot);
  return {
    drawn,
    bridges: bridges.length,
    firm: bridges.filter((s) => s.check!.lot!.status === "haelt").length,
    onlySelf: bridges.filter((s) => s.check!.lot!.status === "faellt").length,
    tooFew: bridges.filter((s) => s.check!.lot!.status === "zu_wenige").length,
  };
}
