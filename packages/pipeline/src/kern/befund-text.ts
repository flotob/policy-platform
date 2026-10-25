/**
 * The evaluation in plain German: fixed sentence templates over the result
 * object, no language model. The results page and the report's sentence
 * list (R1) use the same words, so a finding reads the same everywhere.
 */

import type { BelegKey, Category, Ergebnis, Status, StatementOut, StepOut, Verdict } from "./befund.ts";

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
export function pillOf(s: StatementOut, k: number): string {
  if (s.profile === "abgelehnt") return `${cap(both(k))} Lager lehnen ab`;
  if (s.category === "offen" && s.typ === "T" && !proven(s)) return "Ohne Beleg geblieben";
  return categoryWords(s.category, k).pill;
}

export const ORDER: Category[] = ["streit", "warnung", "klaerbar", "offen", "bruecke"];

export const TYP_WORDS = { T: "Tatsachenfrage", W: "Wertungsfrage", verfahren: "Frage der Ausgestaltung" } as const;

export function statusWords(s: Status, k: number): { text: string; tone: "ok" | "warn" | "bad" | "grey" } {
  const b = bothDat(k);
  switch (s) {
    case "abgewehrt":
      return { text: "abgewehrt", tone: "ok" };
    case "klaerbar":
      return { text: "durch Gutachten klärbar", tone: "warn" };
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

export const proven = (s: StatementOut) => (["messdaten", "studie", "vergleichsfall"] as const).some((b) => (s.evidence.dafuer[b] ?? 0) + (s.evidence.dagegen[b] ?? 0) > 0);

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

/** "72 % im Lager „Klima zuerst“, 18 % im Lager „Kosten & Freiheit“" */
function perCamp(s: StatementOut, names: CampNames, field: "agree" | "disagree") {
  return s.camps.map((c, g) => `${pct(c[field], c.seen)} % im ${campLabel(names, g)}`).join(", ");
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
      else out.push(`Ein Ansatzpunkt für einen Beschluss, der in ${bothDat(k)} Lagern trägt.`);
      break;
    case "warnung":
      out.push(
        "Die Zustimmung trägt nicht: Ein Teil der Beiträge sagt Ja, um die Maßnahme zu stützen, ein anderer, um sie abzuschwächen. Ein Beschluss, der sich auf diese Zahl stützt, zerbricht bei der ersten Ausgestaltungsfrage. Als Verhandlungsgegenstand behandeln, mit offengelegten Zwecken.",
      );
      break;
    case "streit":
      if (s.typ === "W") {
        if (r.core[0] === s.nr) out.push("Hier entscheidet sich der Streit: Bei keiner anderen Wertungsfrage liegen die Lager so weit auseinander.");
        out.push("Das kann kein Gutachten beantworten. Die Frage gehört in den Rat, ausdrücklich als Wertentscheidung.");
      } else out.push("Eine Frage der Ausgestaltung: Der Rat kann sie im Beschluss regeln, hier lässt sich verhandeln.");
      break;
    case "klaerbar":
      out.push(`Eine Tatsachenfrage, über die die Lager uneins sind. Ein Gutachten kann sie klären${proven(s) ? "; Belege dazu liegen teils schon vor" : ""}.`);
      break;
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
    [n("klaerbar"), "lässt", "lassen", "sich mit einem Gutachten klären"],
    [n("offen"), "ist", "sind", "offen"],
    [n("haelt"), "steht", "stehen", ""],
    [n("verdeckt"), "versteckt", "verstecken", "sich hinter einer Zustimmung"],
  ];
  const parts = raw
    .filter(([x]) => x > 0)
    .map(([x, one, many, rest], i) => `${word(x, false)}${i === 0 ? ` ${pl(x, "Angriff", "Angriffe")}` : ""} ${pl(x, one, many)}${rest ? ` ${rest}` : ""}`);
  const out = [`Die Stufe ${VERDICT_WORDS[step.verdict].text}.`];
  if (!step.attacks) out.push("Niemand hat sie angegriffen.");
  else out.push(cap(parts.join(", ").replace(/, ([^,]*)$/, " und $1")) + ".");
  if (step.verdict === "faellt") {
    const values = r.statements.some((s) => s.typ === "W" && s.entries.some((e) => e.step === step.key && e.role === "greift_an" && e.status === "haelt"));
    out.push(values ? "Was hier steht, sind Wertungen: Keine Evidenz kann sie abwehren." : "Eine Wertung der Stadt teilt nicht jedes Lager, und das kann keine Evidenz ändern.");
  }
  const weak = c.einseitig ?? 0;
  if (weak && step.verdict !== "faellt") out.push(`${cap(word(weak))} ${pl(weak, "Stütze trägt", "Stützen tragen")} nur in einem Teil der Lager.`);
  if (step.unasked.length) out.push(`${cap(word(step.unasked.length))} ${pl(step.unasked.length, "Prüffrage hat", "Prüffragen hat")} niemand gestellt.`);
  return out.join(" ");
}

/** "Stufe 1 und 2 halten, Stufe 3 wackelt, Stufe 4 fällt." */
export function stepsLine(r: Ergebnis): string {
  const by = (v: Verdict) => r.steps.map((s, i) => (s.verdict === v ? i + 1 : 0)).filter(Boolean);
  const list = (xs: number[]) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);
  const verb: Record<Verdict, [string, string]> = { haelt: ["hält", "halten"], wackelt: ["wackelt", "wackeln"], faellt: ["fällt", "fallen"] };
  const parts = (["haelt", "wackelt", "faellt"] as Verdict[])
    .map((v) => {
      const xs = by(v);
      return xs.length ? `Stufe ${list(xs)} ${xs.length === 1 ? verb[v][0] : verb[v][1]}` : "";
    })
    .filter(Boolean);
  return `${parts.join(", ")}.`;
}

/** "Also": the conclusion from the four verdicts. */
export function conclusionText(r: Ergebnis): string {
  const root = r.statements.find((s) => s.rolle === "schluss")?.text ?? "die Maßnahme";
  const falls = r.steps.some((s) => s.verdict === "faellt");
  const shaky = r.steps.some((s) => s.verdict === "wackelt");
  const line = stepsLine(r);
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

/** The headline under the title: how many statements carry, and what the dispute comes down to. */
export function headline(r: Ergebnis): { lead: string; rest: Segment[] } {
  const k = r.camps?.k ?? 0;
  const n = r.statements.length;
  const carried = r.statements.filter((s) => s.profile === "getragen").length;
  const rejected = r.statements.filter((s) => s.profile === "abgelehnt").length;
  const lead =
    (carried ? `${cap(word(carried))} von ${word(n)} Aussagen ${pl(carried, "trägt", "tragen")} in ${bothDat(k)} Lagern` : `Keine der ${word(n)} Aussagen trägt in ${bothDat(k)} Lagern`) +
    (rejected ? `, ${word(rejected)} lehnen ${both(k)} ab.` : ".");
  const d = r.diagnoses[0];
  if (!d) return { lead, rest: [] };
  const core = r.core[0] ? r.statements.find((s) => s.nr === r.core[0]) : undefined;
  const vals = d.artNodes.filter((x) => r.statements.find((s) => s.nr === x)?.typ === "W").length;
  const facts = d.artNodes.length - vals;
  switch (d.art) {
    case "wertkonflikt":
      return {
        lead,
        rest:
          vals === 1 && core
            ? [{ text: "Der ganze Streit hat sich auf " }, { text: "eine einzige Frage", nr: core.nr }, { text: ` verengt, und die ist keine Tatsachenfrage: „${core.text}“ Das entscheidet kein Gutachten. Das entscheidet der Rat.` }]
            : [
                { text: `Der Streit hat sich auf ${word(vals)} Fragen verengt, und es sind keine Tatsachenfragen. ` },
                ...(core ? [{ text: "Am weitesten auseinander liegen die Lager hier", nr: core.nr }, { text: `: „${core.text}“ ` }] : []),
                { text: "Das entscheidet kein Gutachten. Das entscheidet der Rat." },
              ],
      };
    case "scheinfaktenstreit":
      return {
        lead,
        rest: [{ text: `Gestritten wird über Tatsachen: ${word(facts)} ${pl(facts, "Frage lässt", "Fragen lassen")} sich mit einem Gutachten klären. In den Wertungen sind sich die Lager näher, als es scheint.` }],
      };
    case "gemischt":
      return {
        lead,
        rest: [
          { text: `Die Lager trennen ${word(vals)} ${pl(vals, "Wertungsfrage", "Wertungsfragen")} und ${word(facts)} ${pl(facts, "Tatsachenfrage", "Tatsachenfragen")}. Die Tatsachen kann ein Gutachten klären, die Wertungen entscheidet der Rat. ` },
          ...(core ? [{ text: "Am weitesten auseinander liegen die Lager hier", nr: core.nr }, { text: `: „${core.text}“` }] : []),
        ],
      };
    default:
      return { lead, rest: [{ text: "Keine Aussage trennt die Lager." }] };
  }
}

/** W5 in words, for one camp pair. */
export function diagnosisText(r: Ergebnis, names: CampNames, i = 0): string {
  const d = r.diagnoses[i];
  if (!d) return "";
  const [g, h] = d.camps;
  const pair = `das ${campLabel(names, g)} und das ${campLabel(names, h)}`;
  const s = {
    bruecke_gruende: `Über die Maßnahme selbst sind sich ${pair} einig, und auch über die Gründe der Stadt: eine Brücke der Gründe, die hält.`,
    bruecke_ergebnisse: `Über die Maßnahme selbst sind sich ${pair} einig, aber nicht über die Gründe dafür: eine Brücke der Ergebnisse, die bei der ersten Ausgestaltungsfrage brechen kann.`,
    streit: `Über die Maßnahme selbst sind sich ${pair} nicht einig.`,
    offen: `Über die Maßnahme selbst hat sich weder das ${campLabel(names, g)} noch das ${campLabel(names, h)} klar festgelegt.`,
  }[d.schluss];
  const a = {
    wertkonflikt: "Die Tatsachen sind zwischen ihnen nicht strittig; was sie trennt, sind Wertungen: ein klarer Wertkonflikt.",
    scheinfaktenstreit: "In den Wertungen trennt sie nichts; gestritten wird über Tatsachen, die sich klären lassen: ein Scheinfaktenstreit.",
    gemischt: "Sie trennen Wertungen und Tatsachen zugleich.",
    einig: "Keine Aussage trennt sie.",
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
      text: `Zu dieser Prüffrage in der Stufe „${label(g.step)}“ hat niemand etwas gesagt: weder ein Einwand noch eine Antwort. Das ist ein Ergebnis, kein Fehlen. Vor einem Beschluss zu schließen, durch die Verwaltung oder eine gezielte Nachfrage.`,
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
