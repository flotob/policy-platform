/**
 * Module W of the Gesamtmodell: the evaluation, without a language model.
 *
 *   W2  camps from the vote matrix (the Polis math in @policy/math)
 *   W3  each statement's profile per camp: agree / disagree / pass, counted
 *   W4  the profile hung on the node: its finding ("Nach Befund") and, per
 *       step of the justification, whether it supports or attacks the step
 *       and how the attack stands ("Nach Argument")
 *   W5  the four diagnoses per camp pair
 *   W6  gaps: questions nobody raised, questions only one side spoke to
 *   W7  evidence balance per statement: by class, not by head count (I10)
 *
 * Same matrix, graph and parameters → same result (I7). The rules are the
 * tables below, not prose; the threshold is a procedure parameter (I12).
 * The result is stored once when the participation closes (W9) and is the
 * only source of the report (I8).
 */

import { createHash } from "node:crypto";

import {
  buildRawMatrix,
  clusterableParticipantIds,
  findBestKmeans,
  isSignificant,
  onePropTest,
  runPca,
  type VoteRecord,
} from "@policy/math";

import type { Richtung, StepKey, Typ } from "./prompts.ts";

export type Rolle = "schluss" | "praemisse" | "beitrag";
export type BelegKey = "keine" | "behauptung" | "vergleichsfall" | "studie" | "messdaten";

/** Evidence that is more than a claim (Belegklassen with a source). */
export const PROOF: readonly BelegKey[] = ["vergleichsfall", "studie", "messdaten"];

/** Fewer votes than this in a camp are not the camp's position (a statistical floor, not a policy threshold). */
export const MIN_CAMP_VOTES = 3;
/** A participant needs this many votes to be placed in a camp (Polis default). */
const MIN_VOTES = 7;

// ———— Input ————

export interface NodeIn {
  id: string;
  ord: number;
  text: string;
  typ: Typ;
  rolle: Rolle;
  schritt: StepKey | null;
  frage: string | null;
  richtung: Richtung | null;
  version: number;
}

/** Where a quote comes from, as the source chain shows it (Bericht → Aussage → Zitat → Original). */
export interface SourceIn {
  /** Stellungnahme of an organisation, a private person's upload, an own point from door 2. */
  kind: "organisation" | "privat" | "kurzaussage";
  title: string;
  date: string;
  /** The paragraph around the quote — empty for private persons (only the quoted words are shown). */
  before: string;
  after: string;
}

/** A contribution linked to a released statement. */
export interface MoveIn {
  id: string;
  node: string;
  stance: 1 | -1;
  richtung: Richtung | null;
  schritt: StepKey | null;
  frage: string | null;
  beleg: BelegKey | null;
  aussage: string;
  quote: string;
  participant: string | null;
  sender: string;
  source: SourceIn | null;
  /** Names or describes a private person: counts as a vote, never shown as a quote. */
  personal?: boolean;
  /** Who attached it: the author at door 2 ("teilnehmer"), the rule ("regel"), the machine ("ki…"), the editors (anyone else). */
  decidedBy?: string | null;
}

export interface VoteIn {
  participant: string;
  node: string;
  value: -1 | 0 | 1;
}

export interface ParticipantIn {
  id: string;
  /** tuer (door 1/2), datei (a statement the town uploaded), stellungnahme (door 3), simulation (fictional demo). */
  via: string | null;
}

export interface Context {
  steps: { key: StepKey; label: string; these: string }[];
  questions: { key: string; label: string; steps: readonly string[] }[];
}

export interface EvaluateInput {
  nodes: NodeIn[];
  moves: MoveIn[];
  votes: VoteIn[];
  participants: ParticipantIn[];
  context: Context;
  params: { bridgeThreshold: number; minParticipants: number };
  /** Z10/W8, computed from the order of inputs (passed through). */
  saturation: Saturation;
  /** Participation figures beyond the matrix (passed through). */
  inputs: { shortPoints: number; uploads: number; files: number };
}

export interface Saturation {
  inputs: number;
  newPoints: number;
  streak: number;
  window: number;
  saturated: boolean;
  series: boolean[];
}

// ———— Output (the result object, W9) ————

export interface CampCount {
  agree: number;
  disagree: number;
  pass: number;
  /** Members of the camp who voted on the statement (agree + disagree + pass). */
  seen: number;
}

export type Profile = "getragen" | "abgelehnt" | "trennt" | "unentschieden" | "ohne";
export type Category = "bruecke" | "streit" | "warnung" | "klaerbar" | "offen";
export type Status = "getragen" | "einseitig" | "schwach" | "abgelehnt" | "abgewehrt" | "klaerbar" | "offen" | "haelt" | "verdeckt";
export type Verdict = "haelt" | "wackelt" | "faellt";

export interface Entry {
  step: StepKey;
  question: string | null;
  role: Richtung;
  status: Status;
  /** The attack as it was raised (a contradicting or opposite-reading contribution), when it is not the statement itself. */
  attack: string | null;
  /** The camp whose members read the statement this way (Scheinkonsens), if their senders are placed. */
  camp: number | null;
}

export interface Quote {
  move: string;
  text: string;
  aussage: string;
  stance: 1 | -1;
  richtung: Richtung | null;
  beleg: BelegKey | null;
  sender: string;
  /** Display number of the sender in the opinion space, if placed. */
  person: number | null;
  camp: number | null;
  source: SourceIn | null;
  /** Who decided that the quote belongs to this statement. */
  confirmedBy?: "verfasser" | "regel" | "maschine" | "redaktion";
}

export interface StatementOut {
  nr: number;
  id: string;
  text: string;
  typ: Typ;
  rolle: Rolle;
  schritt: StepKey | null;
  frage: string | null;
  richtung: Richtung | null;
  version: number;
  camps: CampCount[];
  total: CampCount;
  profile: Profile;
  category: Category;
  /** Largest difference in agreement between two camps, percentage points. */
  gap: number;
  /** Agreeing contributions by what they want for the measure — both > 0 is the Scheinkonsens signal. */
  readings: { stuetzt: number; greift_an: number };
  evidence: { dafuer: Partial<Record<BelegKey, number>>; dagegen: Partial<Record<BelegKey, number>> };
  entries: Entry[];
  quotes: Quote[];
}

export interface StepOut {
  key: StepKey;
  label: string;
  these: string;
  verdict: Verdict;
  supports: number;
  attacks: number;
  counts: Partial<Record<Status, number>>;
  /** Critical questions of this step nobody raised as an objection (there may be supporting answers). */
  unasked: string[];
}

export interface Diagnosis {
  camps: [number, number];
  /** About the measure itself (the root) and the town's premises. */
  schluss: "bruecke_gruende" | "bruecke_ergebnisse" | "streit" | "offen";
  schlussNodes: number[];
  /** What kind of dispute it is, over facts and values. */
  art: "wertkonflikt" | "scheinfaktenstreit" | "gemischt" | "einig";
  artNodes: number[];
}

export interface Gaps {
  /** Critical questions with neither an objection nor an answer. */
  unasked: { step: StepKey; question: string }[];
  /** Questions spoken to from one direction only: only attacks, nobody answered — or only support, nobody objected. */
  oneSided: { step: StepKey; question: string; direction: Richtung; nodes: number[] }[];
  /** Premises of the town nobody attacked. */
  unattacked: number[];
}

export interface Person {
  n: number;
  /** -1: voted, but too little to be placed in a camp (not in the opinion space). */
  camp: number;
  /** 0–1000 in both directions; -1 when not placed. */
  x: number;
  y: number;
  /** One character per statement in display order: a(gree) d(isagree) p(ass) . (no vote). */
  v: string;
  via: string | null;
}

export interface Ergebnis {
  computedAt: string;
  matrixHash: string;
  graphHash: string;
  params: { bridgeThreshold: number; minParticipants: number };
  participation: {
    /** Everyone with at least one vote, incl. senders whose statements count as votes. */
    voters: number;
    /** Voted themselves at door 1. */
    direct: number;
    simulated: number;
    /** Senders of statements (town uploads, door 3) whose contributions count as votes (assumption 3). */
    senders: number;
    votes: number;
    shortPoints: number;
    uploads: number;
    files: number;
  };
  ready: boolean;
  /** Placed participants and how many were needed. */
  clusterable: number;
  needed: number;
  camps: { k: number; silhouette: number; sizes: number[] } | null;
  people: Person[];
  statements: StatementOut[];
  steps: StepOut[];
  conclusion: Verdict;
  diagnoses: Diagnosis[];
  gaps: Gaps;
  saturation: Saturation;
  /** The core of the dispute: dividing value statements between the two largest camps, largest gap first. */
  core: number[];
}

// ———— The rules ————

const share = (n: number, of: number) => (of ? n / of : 0);
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

/** A camp holds a position when enough of it voted, the share reaches the threshold and it is not chance. */
export function carries(c: CampCount, t: number): boolean {
  return c.seen >= MIN_CAMP_VOTES && share(c.agree, c.seen) >= t && isSignificant(onePropTest(c.agree, c.seen));
}
export function rejects(c: CampCount, t: number): boolean {
  return c.seen >= MIN_CAMP_VOTES && share(c.disagree, c.seen) >= t && isSignificant(onePropTest(c.disagree, c.seen));
}

/** W3: the statement across camps — two numbers per camp and the threshold. */
export function profileOf(camps: CampCount[], t: number): Profile {
  if (camps.length < 2) return "ohne";
  const car = camps.map((c) => carries(c, t));
  const rej = camps.map((c) => rejects(c, t));
  if (car.every(Boolean)) return "getragen";
  if (rej.every(Boolean)) return "abgelehnt";
  if (car.some(Boolean) || rej.some(Boolean)) return "trennt";
  return "unentschieden";
}

/**
 * "Nach Befund" — the finding follows from the profile and the type:
 *
 *   profile        typ        → finding
 *   getragen       any           bruecke, or warnung when the agreeing
 *                                contributions want opposite things for
 *                                the measure (Scheinkonsens)
 *   abgelehnt      any           bruecke (both camps reject it)
 *   trennt         T             klaerbar (a fact dispute: a study can settle it)
 *   trennt         W, verfahren  streit (the council decides)
 *   unentschieden  T with proof  klaerbar (evidence lies on the table, nobody is convinced yet)
 *   unentschieden  otherwise     offen
 */
export function categoryOf(profile: Profile, typ: Typ, readings: { stuetzt: number; greift_an: number }, proven: boolean): Category {
  if (profile === "getragen") return readings.stuetzt > 0 && readings.greift_an > 0 ? "warnung" : "bruecke";
  if (profile === "abgelehnt") return "bruecke";
  if (profile === "trennt") return typ === "T" ? "klaerbar" : "streit";
  return typ === "T" && proven ? "klaerbar" : "offen";
}

/** A supporting statement in its step: carried by every camp, by some, by none, or rejected by all. */
export function supportStatus(camps: CampCount[], t: number): Status {
  if (camps.every((c) => carries(c, t))) return "getragen";
  if (camps.every((c) => rejects(c, t))) return "abgelehnt";
  if (camps.some((c) => carries(c, t))) return "einseitig";
  return "schwach";
}

/**
 * An attack on a step. `onThesis` = the statement voted on is the thesis side
 * (a premise or support that someone contradicted); otherwise the statement
 * is the attack itself.
 *
 *   every camp backs the thesis side          → abgewehrt
 *   every camp backs the attack               → hält (nobody disputes it)
 *   some camps back the attack, a fact        → klärbar (a study settles it)
 *   some camps back the attack, a value       → hält (evidence cannot repel it)
 *   no camp backs it, a fact with evidence    → klärbar
 *   otherwise                                 → offen
 */
export function attackStatus(camps: CampCount[], t: number, onThesis: boolean, typ: Typ, evidence: boolean): Status {
  const thesis = camps.map((c) => (onThesis ? carries(c, t) : rejects(c, t)));
  const attack = camps.map((c) => (onThesis ? rejects(c, t) : carries(c, t)));
  if (thesis.every(Boolean)) return "abgewehrt";
  if (attack.every(Boolean)) return "haelt";
  if (attack.some(Boolean)) return typ === "T" ? "klaerbar" : "haelt";
  return typ === "T" && evidence ? "klaerbar" : "offen";
}

/**
 * A step's verdict:
 *   fällt    an attack on a value holds, or a value premise of the town is
 *            not carried by every camp — evidence cannot fix either
 *   wackelt  an attack on a fact or the design holds, an agreement hides an
 *            attack (verdeckt), or every camp rejects a premise
 *   hält     otherwise (attacks repelled, clarifiable or open)
 */
export function verdictOf(entries: { entry: Entry; typ: Typ; rolle: Rolle }[]): Verdict {
  const valueFails = entries.some(
    ({ entry: e, typ, rolle }) =>
      typ === "W" &&
      ((e.role === "greift_an" && e.status === "haelt") || (rolle === "praemisse" && e.role === "stuetzt" && e.status !== "getragen")),
  );
  if (valueFails) return "faellt";
  const shaky = entries.some(
    ({ entry: e, rolle }) =>
      (e.role === "greift_an" && (e.status === "haelt" || e.status === "verdeckt")) || (rolle === "praemisse" && e.status === "abgelehnt"),
  );
  return shaky ? "wackelt" : "haelt";
}

/** W5 for one pair of camps. */
export function diagnosePair(statements: StatementOut[], g: number, h: number, t: number): Diagnosis {
  const pp = (s: StatementOut) => profileOf([s.camps[g]!, s.camps[h]!], t);
  const root = statements.find((s) => s.rolle === "schluss");
  const premises = statements.filter((s) => s.rolle === "praemisse");
  const dividingPremises = premises.filter((s) => pp(s) === "trennt").map((s) => s.nr);
  let schluss: Diagnosis["schluss"] = "offen";
  let schlussNodes: number[] = [];
  if (root && pp(root) === "getragen") {
    schluss = dividingPremises.length ? "bruecke_ergebnisse" : "bruecke_gruende";
    schlussNodes = dividingPremises.length ? dividingPremises : premises.filter((s) => pp(s) === "getragen").map((s) => s.nr);
  } else if (root && pp(root) === "trennt") {
    schluss = "streit";
    schlussNodes = [root.nr, ...dividingPremises];
  }
  const others = statements.filter((s) => s.rolle !== "schluss");
  const facts = others.filter((s) => s.typ === "T" && pp(s) === "trennt").map((s) => s.nr);
  const values = others.filter((s) => s.typ === "W" && pp(s) === "trennt").map((s) => s.nr);
  const art: Diagnosis["art"] = values.length && !facts.length ? "wertkonflikt" : facts.length && !values.length ? "scheinfaktenstreit" : facts.length ? "gemischt" : "einig";
  return { camps: [g, h], schluss, schlussNodes, art, artNodes: art === "wertkonflikt" ? values : art === "scheinfaktenstreit" ? facts : [...values, ...facts] };
}

// ———— The evaluation ————

const STEP_ORDER: StepKey[] = ["lage", "wirkung", "weg", "eingriff"];
const ROLE_ORDER: Record<Rolle, number> = { schluss: 0, praemisse: 1, beitrag: 2 };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The vote matrix as the result was computed from it — sorted, so the hash only changes with the votes. */
export function matrixHash(votes: VoteIn[], nodes: NodeIn[]): string {
  const version = new Map(nodes.map((n) => [n.id, n.version]));
  return sha(
    votes
      .map((v) => `${v.participant}|${v.node}|${version.get(v.node)}|${v.value}`)
      .sort()
      .join("\n"),
  );
}

export function graphHash(nodes: NodeIn[], moves: MoveIn[]): string {
  const n = [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, x.version, x.text, x.typ, x.rolle, x.schritt, x.frage, x.richtung]);
  const m = [...moves].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, x.node, x.stance, x.richtung, x.schritt, x.frage, x.beleg]);
  return sha(JSON.stringify({ n, m }));
}

function countIn(members: Set<string> | null, votes: VoteIn[]): CampCount {
  const c: CampCount = { agree: 0, disagree: 0, pass: 0, seen: 0 };
  for (const v of votes) {
    if (members && !members.has(v.participant)) continue;
    c.seen++;
    if (v.value === 1) c.agree++;
    else if (v.value === -1) c.disagree++;
    else c.pass++;
  }
  return c;
}

export function evaluate(input: EvaluateInput): Ergebnis {
  const t = input.params.bridgeThreshold;
  // Display order: the measure first, then step by step, the town's premises before the contributions.
  const rank = (n: NodeIn) => [n.rolle === "schluss" ? 0 : 1, n.schritt ? STEP_ORDER.indexOf(n.schritt) : 9, ROLE_ORDER[n.rolle], n.ord];
  const nodes = [...input.nodes].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  });
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const votes = input.votes.filter((v) => nodeIndex.has(v.node));

  // W2: the matrix, participants sorted by id so the same votes give the same picture.
  const pids = [...new Set(votes.map((v) => v.participant))].sort();
  const pIndex = new Map(pids.map((p, i) => [p, i]));
  const records: VoteRecord[] = votes.map((v) => ({ participantId: pIndex.get(v.participant)!, statementId: nodeIndex.get(v.node)!, vote: v.value, modified: 1 }));
  const minVotes = Math.min(MIN_VOTES, Math.max(2, Math.floor(nodes.length / 2)));
  const needed = Math.max(input.params.minParticipants, 6);

  const campOf = new Map<string, number>();
  let camps: Ergebnis["camps"] = null;
  let people: Person[] = [];
  let clusterable = 0;
  if (records.length) {
    const matrix = buildRawMatrix(records);
    const ok = clusterableParticipantIds(matrix, minVotes);
    clusterable = ok.length;
    const pca = ok.length >= needed ? runPca(matrix) : null;
    const row = new Map(matrix.participantIds.map((id, i) => [id, i]));
    const pts = pca ? ok.map((id) => pca.participantProjections[row.get(id)!]! as unknown as number[]) : [];
    // k-means needs at least as many distinct positions as camps; everyone voting alike is no camp structure.
    const distinct = new Set(pts.map((p) => p.join(","))).size;
    if (pca && distinct >= 2) {
      const kMax = Math.max(2, Math.min(5, Math.floor(ok.length / 3), distinct));
      const { best, silhouette } = findBestKmeans(pts, 2, kMax);
      // Camp A is the largest.
      const raw: number[] = [];
      for (const l of best.labels) raw[l] = (raw[l] ?? 0) + 1;
      const order = raw.map((n, l) => ({ n: n ?? 0, l })).sort((a, b) => b.n - a.n || a.l - b.l);
      const relabel = new Map(order.map((o, i) => [o.l, i]));
      ok.forEach((id, i) => campOf.set(pids[id]!, relabel.get(best.labels[i]!)!));
      camps = { k: order.length, silhouette: Math.round(silhouette * 1000) / 1000, sizes: order.map((o) => o.n) };
      // The opinion space: placed participants, scaled into 0–1000.
      const xs = pts.map((p) => p[0]!);
      const ys = pts.map((p) => p[1]!);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const sx = (x: number) => Math.round(((x - x0) / (x1 - x0 || 1)) * 1000);
      const sy = (y: number) => Math.round(((y - y0) / (y1 - y0 || 1)) * 1000);
      const voteOf = new Map<string, string[]>();
      for (const v of votes) {
        const a = voteOf.get(v.participant) ?? nodes.map(() => ".");
        a[nodeIndex.get(v.node)!] = v.value === 1 ? "a" : v.value === -1 ? "d" : "p";
        voteOf.set(v.participant, a);
      }
      const via = new Map(input.participants.map((p) => [p.id, p.via]));
      // Everyone who voted is in the open matrix (W1); only the placed ones have a camp and a position.
      const at = new Map(ok.map((id, i) => [id, i]));
      people = pids.map((pid, id) => {
        const i = at.get(id);
        return {
          n: id + 1,
          camp: i === undefined ? -1 : campOf.get(pid)!,
          x: i === undefined ? -1 : sx(pts[i]![0]!),
          y: i === undefined ? -1 : sy(pts[i]![1]!),
          v: voteOf.get(pid)!.join(""),
          via: via.get(pid) ?? null,
        };
      });
    }
  }
  const k = camps?.k ?? 0;
  const members = Array.from({ length: k }, (_, g) => new Set([...campOf].filter(([, c]) => c === g).map(([p]) => p)));
  const personOf = (p: string | null) => (p && pIndex.has(p) && campOf.has(p) ? pIndex.get(p)! + 1 : null);

  // W3/W4 per statement.
  const votesOf = new Map<string, VoteIn[]>();
  for (const v of votes) votesOf.set(v.node, [...(votesOf.get(v.node) ?? []), v]);
  const movesOf = new Map<string, MoveIn[]>();
  for (const m of input.moves) movesOf.set(m.node, [...(movesOf.get(m.node) ?? []), m]);

  const statements: StatementOut[] = nodes.map((n, i) => {
    const vs = votesOf.get(n.id) ?? [];
    const cc = members.map((m) => countIn(m, vs));
    const profile = profileOf(cc, t);
    const ms = movesOf.get(n.id) ?? [];
    const agreeing = ms.filter((m) => m.stance === 1);
    const readings = {
      stuetzt: agreeing.filter((m) => m.richtung === "stuetzt").length,
      greift_an: agreeing.filter((m) => m.richtung === "greift_an").length,
    };
    const evidence: StatementOut["evidence"] = { dafuer: {}, dagegen: {} };
    for (const m of ms) {
      const side = m.stance === 1 ? evidence.dafuer : evidence.dagegen;
      const b = m.beleg ?? "keine";
      side[b] = (side[b] ?? 0) + 1;
    }
    const proven = ms.some((m) => m.beleg && PROOF.includes(m.beleg));
    const known = cc.filter((c) => c.seen >= MIN_CAMP_VOTES).map((c) => pct(c.agree, c.seen));
    const category = profile === "ohne" ? "offen" : categoryOf(profile, n.typ, readings, proven);

    // "Nach Argument": where the statement stands in the four steps.
    const entries: Entry[] = [];
    if (n.rolle !== "schluss" && n.schritt && k >= 2) {
      const own: Richtung = n.rolle === "beitrag" && n.richtung === "greift_an" ? "greift_an" : "stuetzt";
      const campOfMove = (m: MoveIn) => (m.participant ? (campOf.get(m.participant) ?? null) : null);
      if (own === "stuetzt") {
        const opposite = category === "warnung" ? agreeing.filter((m) => m.richtung === "greift_an") : [];
        const sameCamp = agreeing.find((m) => m.richtung === "stuetzt");
        entries.push({
          step: n.schritt,
          question: n.frage,
          role: "stuetzt",
          status: supportStatus(cc, t),
          attack: null,
          camp: opposite.length && sameCamp ? campOfMove(sameCamp) : null,
        });
        // Someone contradicted it: an attack on the step, decided by the votes on the statement itself.
        const contra = ms.filter((m) => m.stance === -1);
        if (contra.length) {
          entries.push({
            step: n.schritt,
            question: contra[0]!.frage ?? n.frage,
            role: "greift_an",
            status: attackStatus(cc, t, true, n.typ, proven),
            attack: contra[0]!.aussage,
            camp: null,
          });
        }
        // Scheinkonsens: the same yes, read as an attack by the other side.
        for (const m of opposite.slice(0, 1)) {
          entries.push({ step: m.schritt ?? n.schritt, question: m.frage ?? n.frage, role: "greift_an", status: "verdeckt", attack: m.aussage, camp: campOfMove(m) });
        }
      } else {
        entries.push({ step: n.schritt, question: n.frage, role: "greift_an", status: attackStatus(cc, t, false, n.typ, proven), attack: null, camp: null });
      }
    }

    const quotes: Quote[] = ms
      .filter((m) => !m.personal)
      .sort((a, b) => b.stance - a.stance || Number(!!b.source && b.source.kind === "organisation") - Number(!!a.source && a.source.kind === "organisation"))
      .map((m) => ({
        move: m.id,
        text: m.quote,
        aussage: m.aussage,
        stance: m.stance,
        richtung: m.richtung,
        beleg: m.beleg,
        sender: m.sender,
        person: personOf(m.participant),
        camp: m.participant ? (campOf.get(m.participant) ?? null) : null,
        source: m.source,
        confirmedBy:
          m.decidedBy === "teilnehmer" ? "verfasser" : m.decidedBy === "regel" ? "regel" : m.decidedBy?.startsWith("ki") ? "maschine" : "redaktion",
      }));

    return {
      nr: i + 1,
      id: n.id,
      text: n.text,
      typ: n.typ,
      rolle: n.rolle,
      schritt: n.schritt,
      frage: n.frage,
      richtung: n.richtung,
      version: n.version,
      camps: cc,
      total: countIn(null, vs),
      profile,
      category,
      gap: known.length >= 2 ? Math.max(...known) - Math.min(...known) : 0,
      readings,
      evidence,
      entries,
      quotes,
    };
  });

  // The four steps.
  const flat = statements.flatMap((s) => s.entries.map((entry) => ({ entry, typ: s.typ, rolle: s.rolle })));
  const steps: StepOut[] = input.context.steps.map((st) => {
    const es = flat.filter((x) => x.entry.step === st.key);
    const counts: Partial<Record<Status, number>> = {};
    for (const { entry } of es) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    const asked = new Set(es.filter((x) => x.entry.role === "greift_an").map((x) => x.entry.question));
    const unasked = input.context.questions.filter((q) => q.steps.includes(st.key) && !asked.has(q.key)).map((q) => q.key);
    return {
      key: st.key,
      label: st.label,
      these: st.these,
      verdict: k >= 2 ? verdictOf(es) : "haelt",
      supports: es.filter((x) => x.entry.role === "stuetzt").length,
      attacks: es.filter((x) => x.entry.role === "greift_an").length,
      counts,
      unasked,
    };
  });
  const conclusion: Verdict = steps.some((s) => s.verdict === "faellt") ? "faellt" : steps.some((s) => s.verdict === "wackelt") ? "wackelt" : "haelt";

  // W5 per pair of camps.
  const diagnoses: Diagnosis[] = [];
  for (let g = 0; g < k; g++) for (let h = g + 1; h < k; h++) diagnoses.push(diagnosePair(statements, g, h, t));

  // W6: gaps.
  // Unasked in the strict sense: neither an objection nor an answer. A question with only supporting
  // contributions was raised from one side — it is listed there, not here.
  const spoken = (st: StepKey, q: string) => statements.some((s) => s.rolle === "beitrag" && s.schritt === st && s.frage === q);
  const unasked = steps.flatMap((s) => s.unasked.filter((q) => !spoken(s.key, q)).map((q) => ({ step: s.key, question: q })));
  const oneSided: Gaps["oneSided"] = [];
  for (const st of STEP_ORDER) {
    for (const q of input.context.questions.filter((x) => x.steps.includes(st))) {
      const cs = statements.filter((s) => s.rolle === "beitrag" && s.schritt === st && s.frage === q.key);
      const dirs = new Set(cs.map((s) => s.richtung));
      if (cs.length && dirs.size === 1) oneSided.push({ step: st, question: q.key, direction: [...dirs][0] ?? "stuetzt", nodes: cs.map((s) => s.nr) });
    }
  }
  const unattacked = statements.filter((s) => s.rolle === "praemisse" && !s.entries.some((e) => e.role === "greift_an")).map((s) => s.nr);

  const core =
    k >= 2
      ? statements
          .filter((s) => s.rolle !== "schluss" && s.typ === "W" && profileOf([s.camps[0]!, s.camps[1]!], t) === "trennt")
          .sort((a, b) => b.gap - a.gap || a.nr - b.nr)
          .map((s) => s.nr)
      : [];

  const via = new Map(input.participants.map((p) => [p.id, p.via]));
  const voters = pids.length;
  return {
    computedAt: new Date().toISOString(),
    matrixHash: matrixHash(votes, nodes),
    graphHash: graphHash(nodes, input.moves),
    params: { bridgeThreshold: t, minParticipants: input.params.minParticipants },
    participation: {
      voters,
      direct: pids.filter((p) => via.get(p) === "tuer").length,
      simulated: pids.filter((p) => via.get(p) === "simulation").length,
      senders: pids.filter((p) => via.get(p) === "datei" || via.get(p) === "stellungnahme").length,
      votes: votes.length,
      ...input.inputs,
    },
    ready: k >= 2,
    clusterable,
    needed,
    camps,
    people,
    statements,
    steps,
    conclusion,
    diagnoses,
    gaps: { unasked, oneSided, unattacked },
    saturation: input.saturation,
    core,
  };
}
