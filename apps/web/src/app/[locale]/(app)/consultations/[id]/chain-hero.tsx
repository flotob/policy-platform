/**
 * Static Kette for the overview page: the same trunk-and-fork computation
 * as the interactive map view, rendered server-side as the consultation's
 * hero graphic. Clicking anywhere leads to the Karte (chain mode is the
 * default there for two-camp maps).
 */

import Link from "next/link";

import { computeChain, stationState, type ChainPoint } from "@policy/chain";

const SLOT_LABELS_DE: Record<string, string> = {
  P1: "P1 · Lage",
  P2: "P2 · Wirkungsprognose",
  P3: "P3 · Zielerreichung",
  P4: "P4 · Wertung",
  conclusion: "Also: Maßnahme",
};
const SLOT_LABELS_EN: Record<string, string> = {
  P1: "P1 · Situation",
  P2: "P2 · Effect prognosis",
  P3: "P3 · Goal attainment",
  P4: "P4 · Value",
  conclusion: "So: the measure",
};

export function ChainHero({
  points,
  campNames,
  de,
  href,
}: {
  points: ChainPoint[];
  campNames: Record<string, { name: string }> | undefined;
  de: boolean;
  href: string;
}) {
  const chain = computeChain(points);
  if (!chain) return null;
  const { stations, forkIdx, gA, gB } = chain;
  const labels = de ? SLOT_LABELS_DE : SLOT_LABELS_EN;
  const shared = forkIdx === -1 ? stations : stations.slice(0, forkIdx);
  const fork = forkIdx === -1 ? null : stations[forkIdx]!;
  const campLabel = (g: number) => campNames?.[String(g)]?.name ?? `G${g}`;

  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const W = 1000;
  const H = 230;
  const step = W / stations.length;
  const boxW = Math.min(178, step - 26);

  return (
    <section className="overview__chain">
      <p className="chain__verdict">
        {fork
          ? de
            ? `Die Lager teilen ${shared.map((s) => labels[s.slot]).join(" · ")} — ${shared.length} gemeinsame Schritte. Der Streit beginnt bei ${labels[fork.slot]}.`
            : `The camps share ${shared.map((s) => labels[s.slot]).join(" · ")} — ${shared.length} common steps. The dispute begins at ${labels[fork.slot]}.`
          : de
            ? "Kein Bruchpunkt auf dem Grundmuster — der Streit liegt in den Einwänden hinter den Türen."
            : "No breakpoint on the base pattern — the dispute lives in the objections behind the doors."}
      </p>
      <Link href={href} className="overview__chain-link" title={de ? "Zur Karte" : "Open the map"}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" className="chain__svg">
          {stations.map((s, i) => {
            const x = round2(i * step + (step - boxW) / 2);
            const cx = round2(i * step + step / 2);
            const state = stationState(s, i, forkIdx);
            const isShared = state === "shared";
            const isFork = state === "fork";
            const cls = `chain__box--${state}`;
            const barW = boxW - 30;
            return (
              <g key={s.slot}>
                {i > 0 && (
                  <line
                    x1={round2(cx - step + boxW / 2 + 6)}
                    y1={94}
                    x2={round2(cx - boxW / 2 - 6)}
                    y2={94}
                    className={isShared || isFork ? "chain__link chain__link--shared" : "chain__link"}
                  />
                )}
                {isFork && (
                  <>
                    <line x1={round2(cx - step / 2)} y1={16} x2={round2(cx - step / 2)} y2={H - 40} className="chain__breakline" />
                    <text x={round2(cx - step / 2)} y={H - 22} textAnchor="middle" className="chain__breaklabel">
                      {de
                        ? `Bruchpunkt · Distanz: ${shared.length} gemeinsame Schritte`
                        : `Breakpoint · distance: ${shared.length} common steps`}
                    </text>
                  </>
                )}
                <rect x={x} y={34} width={boxW} height={120} rx={10} className={`chain__box ${cls}`} />
                <text x={cx} y={60} textAnchor="middle" className="chain__slot">
                  {labels[s.slot]}
                </text>
                <text x={cx} y={78} textAnchor="middle" className="chain__n">
                  {s.claims.length} {de ? "Behauptungen" : "claims"}
                </text>
                <rect x={round2(cx - barW / 2)} y={90} width={barW} height={8} rx={4} className="chain__bar-bg" />
                {s.paA !== null && (
                  <rect x={round2(cx - barW / 2)} y={90} width={round2(barW * s.paA)} height={8} rx={4} className="chain__bar chain__bar--a" />
                )}
                <text x={round2(cx - barW / 2)} y={112} className="chain__pct">A {pct(s.paA)}</text>
                <rect x={round2(cx - barW / 2)} y={120} width={barW} height={8} rx={4} className="chain__bar-bg" />
                {s.paB !== null && (
                  <rect x={round2(cx - barW / 2)} y={120} width={round2(barW * s.paB)} height={8} rx={4} className="chain__bar chain__bar--b" />
                )}
                <text x={round2(cx - barW / 2)} y={142} className="chain__pct">B {pct(s.paB)}</text>
              </g>
            );
          })}
        </svg>
      </Link>
      <div className="chain__legend">
        <span><i className="dot dot--bridged" /> A · {campLabel(gA)}</span>
        <span><i className="dot dot--divisive" /> B · {campLabel(gB)}</span>
        <span className="chain__note">
          {de ? "Zum Reinklicken: die Karte öffnen" : "Click through on the map"} →
        </span>
      </div>
    </section>
  );
}
