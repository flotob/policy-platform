/**
 * Shared model for the Kette (Stamm & Gabelung): per spine stage, the mean
 * agreement of the two largest camps over that stage's voted GRAMMAR CLAIMS
 * (objections and instruments live behind the doors). The first stage whose
 * camp profiles diverge by >= FORK_THRESHOLD is the Bruchpunkt.
 *
 * Doors anchor to the stage they canonically attack (concept paper):
 * Empirie -> P2, Zielkonflikt -> P3, Wertkonflikt -> P4,
 * Alternativen + Machbarkeit -> the measure itself. P1 carries no door —
 * disputes about the Lage are ordinary claim disagreements.
 */

export const FORK_THRESHOLD = 0.15;

export const SPINE = ["P1", "P2", "P3", "P4", "conclusion"] as const;
export type SpineSlot = (typeof SPINE)[number];

export const DOOR_ANCHORS: Record<SpineSlot, string[]> = {
  P1: [],
  P2: ["empirics"],
  P3: ["goal_conflict"],
  P4: ["value_conflict"],
  conclusion: ["alternatives", "feasibility"],
};

export interface ChainPoint {
  id: string;
  slot: SpineSlot | null;
  kind: string;
  cq: string | null;
  answersCq: string[] | null;
  perGroup?: { group: number; pa: number; ns: number }[];
}

export interface ChainStation<P extends ChainPoint = ChainPoint> {
  slot: SpineSlot;
  claims: P[];
  paA: number | null;
  paB: number | null;
  gapAbs: number | null;
}

export function isGrammarClaim(p: ChainPoint): boolean {
  return (
    !p.cq &&
    (p.answersCq?.length ?? 0) === 0 &&
    p.kind !== "design" &&
    p.kind !== "gap"
  );
}

export function computeChain<P extends ChainPoint>(points: P[]): {
  stations: ChainStation<P>[];
  forkIdx: number;
  gA: number;
  gB: number;
} | null {
  const voted = points.filter((p) => (p.perGroup?.length ?? 0) >= 2);
  const nsByGroup = new Map<number, number>();
  for (const p of voted)
    for (const g of p.perGroup!) nsByGroup.set(g.group, (nsByGroup.get(g.group) ?? 0) + g.ns);
  const top2 = [...nsByGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
  if (top2.length < 2) return null;
  const [gA, gB] = top2.sort((a, b) => a - b) as [number, number];

  const stations = SPINE.map((slot) => {
    const claims = voted.filter((p) => p.slot === slot && isGrammarClaim(p));
    const mean = (g: number) => {
      const pas = claims
        .map((p) => p.perGroup!.find((x) => x.group === g))
        .filter((x): x is { group: number; pa: number; ns: number } => !!x && x.ns > 0);
      if (pas.length === 0) return null;
      return pas.reduce((s, x) => s + x.pa, 0) / pas.length;
    };
    const paA = mean(gA);
    const paB = mean(gB);
    const gapAbs = paA !== null && paB !== null ? Math.abs(paA - paB) : null;
    return { slot, claims, paA, paB, gapAbs };
  }).filter((s) => s.claims.length > 0);

  if (stations.length < 2) return null;
  const forkIdx = stations.findIndex((s) => (s.gapAbs ?? 0) >= FORK_THRESHOLD);
  return { stations, forkIdx, gA, gB };
}

/**
 * How a station reads relative to the Bruchpunkt: shared trunk, the fork
 * itself — and beyond it, each station keeps its own meaning: still split
 * (gap above threshold) or re-converging (gap closed again = the
 * Scheinkonsens signal).
 */
export function stationState(
  station: ChainStation,
  i: number,
  forkIdx: number,
): "shared" | "fork" | "split" | "reconverge" | "after" {
  if (forkIdx === -1 || i < forkIdx) return "shared";
  if (i === forkIdx) return "fork";
  // No computable gap (one camp has no votes here): neutral, neither
  // split nor re-converged.
  if (station.gapAbs === null) return "after";
  return station.gapAbs >= FORK_THRESHOLD ? "split" : "reconverge";
}

export type ChainPattern =
  | "bridge_reasons"
  | "pseudo_consensus"
  | "value_conflict"
  | "pseudo_fact"
  | "contested";

/**
 * Which of the concept paper's four dispute patterns the chain shows.
 * - no fork at all → Brücke der Gründe (long shared stretch)
 * - fork, but the conclusion re-converges → Scheinkonsens
 * - empirical trunk shared, fork at P4 → klarer Wertkonflikt
 * - fork in P1–P3 while P4 is shared → Scheinfaktenstreit
 * - otherwise → plain contested chain
 */
export function chainPattern(
  stations: ChainStation[],
  forkIdx: number,
): ChainPattern {
  if (forkIdx === -1) return "bridge_reasons";
  const last = stations[stations.length - 1]!;
  if (
    last.slot === "conclusion" &&
    forkIdx < stations.length - 1 &&
    (last.gapAbs ?? 1) < FORK_THRESHOLD
  )
    return "pseudo_consensus";
  if (stations[forkIdx]!.slot === "P4") return "value_conflict";
  const p4 = stations.find((s) => s.slot === "P4");
  if (p4 && (p4.gapAbs ?? 1) < FORK_THRESHOLD) return "pseudo_fact";
  return "contested";
}
