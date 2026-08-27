"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DOOR_ANCHORS,
  chainPattern,
  computeChain,
  stationState,
  type ChainStation,
  type SpineSlot,
} from "@policy/chain";

import type { CGPoint, CampRef } from "@/lib/types";

const CQ_KINDS = [
  "empirics",
  "alternatives",
  "goal_conflict",
  "feasibility",
  "value_conflict",
] as const;

/** Camp identity for rendering: color mod "a"/"b" follows the page-wide camp
 * order (largest camp = a), never the internal group index. */
interface CampCtx {
  group: number;
  name: string;
  mod: "a" | "b";
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 100)} %`;
}

function paOf(p: CGPoint, group: number): number | null {
  const g = p.perGroup?.find((x) => x.group === group && x.ns > 0);
  return g ? g.pa : null;
}

function useSlotLabel() {
  const t = useTranslations("Chain");
  return (slot: SpineSlot) =>
    slot === "conclusion" ? t("slotConclusion") : t(`slot${slot}` as "slotP1");
}

/** "A, B und C" (locale word passed in via messages). */
function joinAnd(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function CampDot({ mod }: { mod: "a" | "b" }) {
  return <i className={`dot dot--${mod}`} aria-hidden />;
}

function CampLegend({ ctx }: { ctx: CampCtx[] }) {
  return (
    <p className="chain__camps">
      {ctx.map((c) => (
        <span key={c.group} className="chain__campsitem">
          <CampDot mod={c.mod} /> {c.name}
        </span>
      ))}
    </p>
  );
}

function PointItem({
  p,
  ctx,
  showPct = false,
}: {
  p: CGPoint;
  ctx?: CampCtx[];
  showPct?: boolean;
}) {
  const pcts =
    showPct && ctx
      ? ctx.map((c) => ({ mod: c.mod, pa: paOf(p, c.group) }))
      : null;
  const pctSpan = pcts && pcts.every((x) => x.pa !== null) && (
    <span className="pointitem__pcts">
      {pcts.map((x) => (
        <span key={x.mod}>
          <CampDot mod={x.mod} /> {pct(x.pa)}
        </span>
      ))}
    </span>
  );
  return (
    <li className="pointitem">
      {p.summary ? (
        <details>
          <summary>
            {p.label}
            {pctSpan}
          </summary>
          <p className="pointitem__summary">{p.summary}</p>
        </details>
      ) : (
        <span className="pointitem__plain">
          {p.label}
          {pctSpan}
        </span>
      )}
    </li>
  );
}

/** One door's block: guiding question, its objections, and the instruments
 * whose PRIMARY door this is (multi-door instruments appear once). */
function DoorBlock({
  cq,
  points,
  ctx,
  showPct = false,
}: {
  cq: string;
  points: CGPoint[];
  ctx?: CampCtx[];
  showPct?: boolean;
}) {
  const td = useTranslations("Doors");
  const t = useTranslations("Chain");
  const objections = points.filter((p) => p.cq === cq);
  const solutions = points.filter((p) => p.answersCq?.[0] === cq);
  if (objections.length === 0 && solutions.length === 0) return null;
  return (
    <div className="door">
      <h4 className="door__title">
        {td(cq as "empirics")}
        <span className="door__q">{td(`${cq}Q` as "empiricsQ")}</span>
      </h4>
      <ul className="pointlist">
        {objections.map((p) => (
          <PointItem key={p.id} p={p} ctx={ctx} showPct={showPct} />
        ))}
      </ul>
      {solutions.length > 0 && (
        <>
          <p className="door__solutions">⚒ {t("solutionsLabel")}</p>
          <ul className="pointlist pointlist--solutions">
            {solutions.map((p) => (
              <PointItem key={p.id} p={p} ctx={ctx} showPct={showPct} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Content dossier without camp comparison — for scopes with too few votes. */
function FallbackDossier({ points }: { points: CGPoint[] }) {
  const t = useTranslations("Chain");
  const claims = points.filter(
    (p) => !p.cq && (p.answersCq?.length ?? 0) === 0 && p.kind !== "design" && p.kind !== "gap",
  );
  return (
    <div className="chainfallback">
      <p className="chain__verdict">{t("verdictNoData")}</p>
      {claims.length > 0 && (
        <>
          <h4 className="door__title">
            {t("claimsFallbackHeading", { n: claims.length })}
          </h4>
          <ul className="pointlist">
            {claims.map((p) => (
              <PointItem key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
      {CQ_KINDS.map((cq) => (
        <DoorBlock key={cq} cq={cq} points={points} />
      ))}
    </div>
  );
}

function StationPanel({
  station,
  points,
  ctx,
  lens,
  setLens,
}: {
  station: ChainStation<CGPoint>;
  points: CGPoint[];
  ctx: CampCtx[];
  lens: "dossier" | "analysis";
  setLens: (l: "dossier" | "analysis") => void;
}) {
  const t = useTranslations("Chain");
  const anchors = DOOR_ANCHORS[station.slot];
  const anchored = points.filter(
    (p) =>
      (p.cq && anchors.includes(p.cq)) ||
      (p.answersCq?.[0] !== undefined && anchors.includes(p.answersCq[0])),
  );

  const analysisItems = [...station.claims, ...anchored]
    .map((p) => ({
      p,
      pas: ctx.map((c) => paOf(p, c.group)),
    }))
    .filter((x): x is { p: CGPoint; pas: number[] } => x.pas.every((v) => v !== null))
    .sort(
      (a, b) =>
        Math.abs(b.pas[0]! - b.pas[1]!) - Math.abs(a.pas[0]! - a.pas[1]!),
    );
  const unvoted = station.claims.length + anchored.length - analysisItems.length;

  return (
    <div className="stationpanel">
      <div className="stationpanel__tabs" role="tablist">
        {(["dossier", "analysis"] as const).map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={lens === l}
            className={lens === l ? "is-active" : ""}
            onClick={() => setLens(l)}
          >
            {l === "dossier" ? t("tabDossier") : t("tabAnalysis")}
          </button>
        ))}
      </div>

      {lens === "dossier" ? (
        <div className="stationpanel__body">
          <h4 className="door__title">
            {t("claimsHeading", { n: station.claims.length })}
          </h4>
          <ul className="pointlist">
            {station.claims.map((p) => (
              <PointItem key={p.id} p={p} />
            ))}
          </ul>
          {anchors.length === 0 ? (
            <p className="stationpanel__nodoor">{t("noDoor")}</p>
          ) : (
            anchors.map((cq) => (
              <DoorBlock key={cq} cq={cq} points={points} />
            ))
          )}
        </div>
      ) : (
        <div className="stationpanel__body">
          <h4 className="door__title">
            {t("analysisHeading", { n: analysisItems.length })}
          </h4>
          <p className="stationpanel__legend">
            {ctx.map((c) => (
              <span key={c.group} className="chain__campsitem">
                <CampDot mod={c.mod} /> {c.name}
              </span>
            ))}
          </p>
          <ul className="pointlist">
            {analysisItems.map(({ p }) => (
              <PointItem key={p.id} p={p} ctx={ctx} showPct />
            ))}
          </ul>
          {unvoted > 0 && (
            <p className="stationpanel__unvoted">
              {t("analysisUnvoted", { n: unvoted })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The chain: vertical spine of stations, camp bars per station, the visible
 * tear where the camps part, and a two-lens panel per station.
 */
export function Chain({
  points,
  camps,
}: {
  points: CGPoint[];
  /** Largest camp first — its color is "a" everywhere on the page. */
  camps: CampRef[];
}) {
  const t = useTranslations("Chain");
  const slotLabel = useSlotLabel();
  const [open, setOpen] = useState<SpineSlot | null>(null);
  const [lens, setLens] = useState<"dossier" | "analysis">("dossier");

  const chain = computeChain(points);
  if (!chain) return <FallbackDossier points={points} />;
  const { stations, forkIdx, gA, gB } = chain;

  const ctx: CampCtx[] = camps
    .filter((c) => c.group === gA || c.group === gB)
    .slice(0, 2)
    .map((c, i) => ({ group: c.group, name: c.name, mod: i === 0 ? "a" : "b" }));
  const paFor = (s: ChainStation<CGPoint>, group: number) =>
    group === gA ? s.paA : group === gB ? s.paB : null;

  const pattern = chainPattern(stations, forkIdx);
  const fork = forkIdx >= 0 ? stations[forkIdx]! : null;

  const sharedLabels = stations
    .slice(0, forkIdx === -1 ? stations.length : forkIdx)
    .map((s) => slotLabel(s.slot));

  const verdict =
    forkIdx === -1
      ? t("verdictNoFork")
      : forkIdx === 0
        ? t("verdictForkStart", { fork: slotLabel(fork!.slot) })
        : t("verdictFork", {
            shared: joinAnd(sharedLabels, t("and")),
            n: forkIdx,
            fork: slotLabel(fork!.slot),
          });

  const toggle = (slot: SpineSlot) => {
    if (open === slot) {
      setOpen(null);
    } else {
      setOpen(slot);
      setLens("dossier");
    }
  };

  return (
    <div className="chain">
      <p className="chain__verdict">{verdict}</p>
      {pattern === "pseudo_consensus" && (
        <p className="chain__verdict chain__verdict--warn">{t("verdictReconverge")}</p>
      )}
      {fork && open === null && (
        <button
          className="chain__shortcut"
          onClick={() => {
            setOpen(fork.slot);
            setLens("analysis");
          }}
        >
          {t("toAnalysis", { fork: slotLabel(fork.slot) })}
        </button>
      )}

      <CampLegend ctx={ctx} />
      <ol className="kette">
        {stations.map((s, i) => {
          const state = stationState(s, i, forkIdx);
          return (
            <li key={s.slot} className={`kstation kstation--${state}`}>
              {i === forkIdx && i > 0 && (
                <div className="kette__riss" aria-hidden>
                  <span>{t("breakLabel")}</span>
                </div>
              )}
              <button
                className={`kstation__head ${open === s.slot ? "is-open" : ""}`}
                onClick={() => toggle(s.slot)}
                aria-expanded={open === s.slot}
              >
                <span className="kstation__node" aria-hidden />
                <span className="kstation__title">
                  {slotLabel(s.slot)}
                  <span className="kstation__meta">
                    {t("claims", { n: s.claims.length })}
                    {s.gapAbs !== null && s.gapAbs >= 0.05 && (
                      <> · {t("gap", { n: Math.round(s.gapAbs * 100) })}</>
                    )}
                  </span>
                </span>
                <span className="bars">
                  {ctx.map((c) => {
                    const pa = paFor(s, c.group);
                    return (
                      <span key={c.group} className="bars__row">
                        <CampDot mod={c.mod} />
                        <span className="bars__track">
                          <i
                            className={`bars__fill bars__fill--${c.mod}`}
                            style={{ width: `${Math.round((pa ?? 0) * 100)}%` }}
                          />
                          <i className="bars__floor" aria-hidden />
                        </span>
                        <span className="bars__pct">{pct(pa)}</span>
                      </span>
                    );
                  })}
                </span>
              </button>
              {open === s.slot && (
                <StationPanel
                  station={s}
                  points={points}
                  ctx={ctx}
                  lens={lens}
                  setLens={setLens}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="chain__hint">{t("hint")}</p>
    </div>
  );
}
