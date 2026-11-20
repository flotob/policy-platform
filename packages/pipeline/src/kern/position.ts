/**
 * Where one camp stands on one statement, where the camps stand together, and the diagnosis over camps.
 * Shared by the evaluation (befund.ts) and its words (befund-text.ts), so both apply exactly the same
 * rule. No Node modules here: the words also run in the browser (the results page).
 */
import { isSignificant, onePropTest } from "@policy/math";

import type { CampCount, Diagnosis, Profile, StatementOut } from "./befund.ts";

/** Fewer votes than this in a camp are not the camp's position (a statistical floor, not a policy threshold). */
export const MIN_CAMP_VOTES = 3;

const share = (n: number, of: number) => (of ? n / of : 0);

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

/** W5 for one pair of camps. */
export function diagnosePair(statements: StatementOut[], g: number, h: number, t: number): Diagnosis {
  return diagnoseCamps(statements, [g, h], t);
}

/** W5 across the given camps: the measure itself, and whether values, facts or both divide them. */
export function diagnoseCamps(statements: StatementOut[], gs: number[], t: number): Diagnosis {
  const pp = (s: StatementOut) => profileOf(gs.map((g) => s.camps[g]!), t);
  const root = statements.find((s) => s.rolle === "schluss");
  const premises = statements.filter((s) => s.rolle === "praemisse");
  const dividingPremises = premises.filter((s) => pp(s) === "trennt").map((s) => s.nr);
  let schluss: Diagnosis["schluss"] = "offen";
  let schlussNodes: number[] = [];
  if (root && pp(root) === "getragen") {
    schluss = dividingPremises.length ? "bruecke_ergebnisse" : "bruecke_gruende";
    schlussNodes = dividingPremises.length ? dividingPremises : premises.filter((s) => pp(s) === "getragen").map((s) => s.nr);
  } else if (root && pp(root) === "abgelehnt") {
    // Both camps reject the measure itself: agreement too — against it.
    schluss = "abgelehnt";
    schlussNodes = [root.nr];
  } else if (root && pp(root) === "trennt") {
    schluss = "streit";
    schlussNodes = [root.nr, ...dividingPremises];
  }
  const others = statements.filter((s) => s.rolle !== "schluss");
  const facts = others.filter((s) => s.typ === "T" && pp(s) === "trennt").map((s) => s.nr);
  const values = others.filter((s) => s.typ === "W" && pp(s) === "trennt").map((s) => s.nr);
  const art: Diagnosis["art"] = values.length && !facts.length ? "wertkonflikt" : facts.length && !values.length ? "scheinfaktenstreit" : facts.length ? "gemischt" : "einig";
  return { camps: gs, schluss, schlussNodes, art, artNodes: art === "wertkonflikt" ? values : art === "scheinfaktenstreit" ? facts : [...values, ...facts] };
}
