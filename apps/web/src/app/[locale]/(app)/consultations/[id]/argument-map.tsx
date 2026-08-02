"use client";

/**
 * The Landkarte: spatial argument map after the concept demo
 * (docs/landkarte1.html). Schema spine (P1–P4 → conclusion) on the left,
 * zone bands with point nodes in the middle, detail panel on the right.
 * Selecting a node draws its argumentative edges and its link to the
 * schema slot it negotiates.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface MapPoint {
  id: string;
  kind: "fact" | "value" | "design" | "gap";
  slot: "P1" | "P2" | "P3" | "P4" | "conclusion" | null;
  label: string;
  summary: string | null;
  finding: string | null;
  status: string;
  statement: string | null;
  theme: string | null;
  sources: { quote: string | null; org: string | null }[];
  profile?: "bridged" | "divisive" | "open";
  perGroup?: { group: number; pa: number; ns: number }[];
  conclusionDiagnosis?: "bridge_of_reasons" | "bridge_of_results" | "contested" | "open";
  tally?: { agree: number; disagree: number; pass: number } | null;
}

export type CampNames = Record<string, { name: string; summary?: string }>;

/** How many nodes a slot group shows before collapsing behind "+N more". */
const GROUP_LIMIT = 8;

function pointWeight(p: MapPoint): number {
  const votes = p.tally ? p.tally.agree + p.tally.disagree + p.tally.pass : 0;
  return p.sources.length * 2 + votes;
}

export interface MapEdgeData {
  from: string;
  to: string;
  kind:
    | "supports"
    | "empirics"
    | "alternatives"
    | "goal_conflict"
    | "feasibility"
    | "value_conflict";
}

export interface SaturationData {
  /** Share of candidates that were NEW points over the window. */
  newRate: number;
  /** Number of trailing submissions in the window. */
  window: number;
  reached: boolean;
}

const SLOTS = ["P1", "P2", "P3", "P4", "conclusion", null] as const;
const ZONES: { kind: MapPoint["kind"]; className: string }[] = [
  { kind: "fact", className: "fact" },
  { kind: "value", className: "value" },
  { kind: "design", className: "design" },
  { kind: "gap", className: "gap" },
];

function slotKey(slot: MapPoint["slot"]): string {
  return slot ?? "none";
}

/** Deterministic 0..1 jitter from a point id (stable across renders). */
function hashJitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Barycentric triangle for THREE camps: each camp is a corner; a point sits
 * at the weighted average of the corners by relative agreement. Center =
 * all camps agree alike; an edge = two camps share it against the third.
 * Dot opacity = the WEAKEST camp's agreement (the bridge criterion);
 * a teal ring marks true bridges (every camp ≥ 60%).
 */
function TriangleField({
  points,
  selectedId,
  relatedIds,
  onSelect,
  campLabel,
  nodeText,
  t,
}: {
  points: MapPoint[];
  selectedId: string | null;
  relatedIds: Set<string>;
  onSelect: (id: string | null) => void;
  campLabel: (g: number) => string;
  nodeText: (p: MapPoint) => string;
  t: ReturnType<typeof useTranslations<"MapView">>;
}) {
  const voted = points.filter((p) => (p.perGroup?.length ?? 0) >= 3);
  if (voted.length === 0) return <p className="placeholder-note">{t("scatterEmpty")}</p>;
  const groups = [...new Set(voted.flatMap((p) => p.perGroup!.map((g) => g.group)))]
    .sort((a, b) => a - b)
    .slice(0, 3) as [number, number, number];

  const W = 1000;
  const H = 780;
  const cTop: [number, number] = [W / 2, 64];
  const cLeft: [number, number] = [96, H - 110];
  const cRight: [number, number] = [W - 96, H - 110];
  const corners = [cTop, cLeft, cRight];
  const GAMMA = 2.5; // sharpen relative weights so dots spread from center
  const coords = voted.map((p) => {
    const pas = groups.map((g) => p.perGroup!.find((x) => x.group === g)?.pa ?? 0);
    const powed = pas.map((v) => Math.pow(Math.max(v, 0.001), GAMMA));
    const sum = powed.reduce((s, v) => s + v, 0);
    const w = powed.map((v) => v / sum);
    const minPa = Math.min(...pas);
    const round2 = (v: number) => Math.round(v * 100) / 100;
    return {
      p,
      pas,
      minPa,
      x: round2(corners.reduce((s, c, i) => s + c[0] * w[i]!, 0) + (hashJitter(p.id) - 0.5) * 22),
      y: round2(corners.reduce((s, c, i) => s + c[1] * w[i]!, 0) + (hashJitter(p.id + "y") - 0.5) * 22),
      r: round2(4 + Math.min(9, Math.sqrt(pointWeight(p)) * 0.6)),
    };
  });
  const labeled = new Set(
    [...coords]
      .sort((a, b) => pointWeight(b.p) - pointWeight(a.p))
      .slice(0, 12)
      .map((c) => c.p.id),
  );
  if (selectedId) labeled.add(selectedId);

  return (
    <div className="scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <polygon
          points={corners.map((c) => c.join(",")).join(" ")}
          className="scatter__triangle"
        />
        <text x={cTop[0]} y={cTop[1] - 18} textAnchor="middle" className="scatter__camp">
          {campLabel(groups[0])}
        </text>
        <text x={cLeft[0] - 6} y={cLeft[1] + 34} textAnchor="start" className="scatter__camp">
          {campLabel(groups[1])}
        </text>
        <text x={cRight[0] + 6} y={cRight[1] + 34} textAnchor="end" className="scatter__camp">
          {campLabel(groups[2])}
        </text>
        <text
          x={(cTop[0] + cLeft[0] + cRight[0]) / 3}
          y={(cTop[1] + cLeft[1] + cRight[1]) / 3 + 4}
          textAnchor="middle"
          className="scatter__caption"
        >
          {t("triangleCenter")}
        </text>
        {coords.map((c) => (
          <g
            key={c.p.id}
            className="scatter__dotg"
            onClick={() => onSelect(c.p.id === selectedId ? null : c.p.id)}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={c.r}
              style={{ opacity: Math.round((0.35 + 0.65 * c.minPa) * 100) / 100 }}
              className={[
                "scatter__dot",
                `scatter__dot--${c.p.kind}`,
                c.minPa >= 0.6 ? "scatter__dot--bridge" : "",
                selectedId === c.p.id ? "scatter__dot--sel" : "",
                relatedIds.has(c.p.id) ? "scatter__dot--rel" : "",
              ].join(" ")}
            />
            {labeled.has(c.p.id) && (
              <text x={c.x} y={c.y + c.r + 11} textAnchor="middle" className="scatter__label">
                {c.p.label.slice(0, 34)}
                {c.p.label.length > 34 ? "…" : ""}
              </text>
            )}
            <title>
              {`${nodeText(c.p)}\n${groups.map((g, i) => `${campLabel(g)}: ${Math.round(c.pas[i]! * 100)}%`).join(" · ")}`}
            </title>
          </g>
        ))}
      </svg>
      <div className="scatter__footer">
        <span className="scatter__legend">
          <i className="dot scatter__key--fact" /> {t("kindFact")}
          <i className="dot scatter__key--value" /> {t("kindValue")}
          <i className="dot scatter__key--design" /> {t("kindDesign")}
          <i className="dot scatter__key--gap" /> {t("kindGap")}
        </span>
        <span className="scatter__note">{t("triangleLegend")}</span>
        {points.length > voted.length && (
          <span className="scatter__note">
            {t("scatterUnvoted", { n: points.length - voted.length })}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The conflict field: horizontal = which camp a point belongs to (camp A
 * territory left, camp B right, shared ground in the middle), vertical =
 * overall agreement. Dot size = weight (sources + votes), color = zone.
 */
function ScatterField({
  points,
  edges,
  selectedId,
  relatedIds,
  onSelect,
  campLabel,
  nodeText,
  t,
}: {
  points: MapPoint[];
  edges: MapEdgeData[];
  selectedId: string | null;
  relatedIds: Set<string>;
  onSelect: (id: string | null) => void;
  campLabel: (g: number) => string;
  nodeText: (p: MapPoint) => string;
  t: ReturnType<typeof useTranslations<"MapView">>;
}) {
  const voted = points.filter((p) => (p.perGroup?.length ?? 0) >= 2);
  if (voted.length === 0) return <p className="placeholder-note">{t("scatterEmpty")}</p>;

  const nsByGroup = new Map<number, number>();
  for (const p of voted)
    for (const g of p.perGroup!) nsByGroup.set(g.group, (nsByGroup.get(g.group) ?? 0) + g.ns);
  const top2 = [...nsByGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);
  const [gA, gB] = top2.sort((a, b) => a - b) as [number, number];

  const W = 1000;
  const H = 640;
  const M = 46;
  const PW = W - 2 * M;
  const PH = H - 2 * M - 26;
  const coords = voted.map((p) => {
    const paA = p.perGroup!.find((g) => g.group === gA)?.pa ?? 0;
    const paB = p.perGroup!.find((g) => g.group === gB)?.pa ?? 0;
    // Unweighted mean of the two camps: top of the field = BOTH camps
    // agree (a bridge), independent of camp sizes.
    const overall = (paA + paB) / 2;
    const round2 = (v: number) => Math.round(v * 100) / 100;
    return {
      p,
      paA,
      paB,
      x: round2(M + ((paB - paA + 1) / 2) * PW + (hashJitter(p.id) - 0.5) * 26),
      y: round2(M + (1 - overall) * PH + (hashJitter(p.id + "y") - 0.5) * 26),
      r: round2(4 + Math.min(9, Math.sqrt(pointWeight(p)) * 1.4)),
    };
  });
  const byId = new Map(coords.map((c) => [c.p.id, c]));
  const labeled = new Set(
    [...coords]
      .sort((a, b) => pointWeight(b.p) - pointWeight(a.p))
      .slice(0, 14)
      .map((c) => c.p.id),
  );
  if (selectedId) labeled.add(selectedId);
  const selEdges = selectedId
    ? edges.filter(
        (e) =>
          (e.from === selectedId || e.to === selectedId) &&
          byId.has(e.from) &&
          byId.has(e.to),
      )
    : [];

  return (
    <div className="scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <line x1={W / 2} y1={M} x2={W / 2} y2={M + PH} className="scatter__guide" />
        <line
          x1={M} y1={M + 0.4 * PH} x2={W - M} y2={M + 0.4 * PH}
          className="scatter__guide scatter__guide--bridge"
        />
        <text x={W - M} y={M + 0.4 * PH - 7} textAnchor="end" className="scatter__caption">
          {t("bridgeThreshold")}
        </text>
        <text x={M} y={M - 16} className="scatter__camp">◀ {campLabel(gA)}</text>
        <text x={W - M} y={M - 16} textAnchor="end" className="scatter__camp">
          {campLabel(gB)} ▶
        </text>
        <text x={W / 2} y={M + PH + 24} textAnchor="middle" className="scatter__caption">
          {t("scatterBottom")}
        </text>
        {selEdges.map((e) => {
          const f = byId.get(e.from)!;
          const o = byId.get(e.to)!;
          return (
            <line
              key={`${e.from}-${e.to}-${e.kind}`}
              x1={f.x} y1={f.y} x2={o.x} y2={o.y}
              className={`mapedge mapedge--${e.kind === "supports" ? "supports" : "attack"}`}
            />
          );
        })}
        {coords.map((c) => (
          <g
            key={c.p.id}
            className="scatter__dotg"
            onClick={() => onSelect(c.p.id === selectedId ? null : c.p.id)}
          >
            <circle
              cx={c.x}
              cy={c.y}
              r={c.r}
              className={[
                "scatter__dot",
                `scatter__dot--${c.p.kind}`,
                selectedId === c.p.id ? "scatter__dot--sel" : "",
                relatedIds.has(c.p.id) ? "scatter__dot--rel" : "",
              ].join(" ")}
            />
            {labeled.has(c.p.id) && (
              <text x={c.x} y={c.y + c.r + 11} textAnchor="middle" className="scatter__label">
                {c.p.label.slice(0, 34)}
                {c.p.label.length > 34 ? "…" : ""}
              </text>
            )}
            <title>
              {`${nodeText(c.p)}\n${campLabel(gA)}: ${Math.round(c.paA * 100)}% · ${campLabel(gB)}: ${Math.round(c.paB * 100)}%`}
            </title>
          </g>
        ))}
      </svg>
      <div className="scatter__footer">
        <span className="scatter__legend">
          <i className="dot scatter__key--fact" /> {t("kindFact")}
          <i className="dot scatter__key--value" /> {t("kindValue")}
          <i className="dot scatter__key--design" /> {t("kindDesign")}
          <i className="dot scatter__key--gap" /> {t("kindGap")}
        </span>
        {points.length > voted.length && (
          <span className="scatter__note">
            {t("scatterUnvoted", { n: points.length - voted.length })}
          </span>
        )}
      </div>
    </div>
  );
}

export function ArgumentMap({
  title,
  points,
  edges,
  saturation,
  campNames,
}: {
  title: string;
  points: MapPoint[];
  edges: MapEdgeData[];
  saturation: SaturationData | null;
  campNames?: CampNames;
}) {
  const t = useTranslations("MapView");
  const tMap = useTranslations("Map");
  const hasVotes = points.some((p) => (p.perGroup?.length ?? 0) >= 2);
  const campCount = new Set(points.flatMap((p) => (p.perGroup ?? []).map((g) => g.group))).size;
  const [mode, setMode] = useState<"scatter" | "map" | "list">(
    hasVotes ? "scatter" : "map",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Structure-tree filters: click a slot or theme in the left panel to
  // narrow the canvas to it.
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<string | null>(null);
  const campLabel = (g: number) => campNames?.[String(g)]?.name ?? `G${g}`;
  const nodeText = (p: MapPoint) => p.statement ?? p.label;
  const q = query.trim().toLowerCase();
  const filtering = q !== "" || slotFilter !== null || themeFilter !== null;
  const visiblePoints = points.filter((p) => {
    if (
      q &&
      !p.label.toLowerCase().includes(q) &&
      !(p.statement ?? "").toLowerCase().includes(q) &&
      !(p.summary ?? "").toLowerCase().includes(q)
    )
      return false;
    if (slotFilter && slotKey(p.slot) !== slotFilter) return false;
    if (themeFilter && (p.theme ?? "") !== themeFilter) return false;
    return true;
  });
  const allThemes = [...new Set(points.map((p) => p.theme).filter(Boolean))] as string[];
  allThemes.sort(
    (a, b) =>
      points.filter((p) => p.theme === b).length -
      points.filter((p) => p.theme === a).length,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<{ d: string; cls: string; key: string }[]>([]);

  const selected = points.find((p) => p.id === selectedId) ?? null;
  const byId = new Map(points.map((p) => [p.id, p]));
  const selectedEdges = selected
    ? edges.filter((e) => e.from === selected.id || e.to === selected.id)
    : [];
  const relatedIds = new Set(
    selectedEdges.flatMap((e) => [e.from, e.to]).filter((id) => id !== selectedId),
  );

  const counters = {
    bridges: points.filter((p) => p.profile === "bridged").length,
    conflicts: points.filter((p) => p.profile === "divisive").length,
    gaps: points.filter((p) => p.kind === "gap").length,
    warnings: points.filter((p) => p.conclusionDiagnosis === "bridge_of_results").length,
  };

  const setNodeRef = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      if (el) nodeRefs.current.set(id, el);
      else nodeRefs.current.delete(id);
    };
  }, []);

  const recomputePaths = useCallback(() => {
    const container = containerRef.current;
    if (!container || !selectedId) {
      setPaths([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const center = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - cRect.left + r.width / 2,
        y: r.top - cRect.top + r.height / 2,
        left: r.left - cRect.left,
        right: r.right - cRect.left,
        midY: r.top - cRect.top + r.height / 2,
      };
    };
    const from = nodeRefs.current.get(selectedId);
    if (!from) {
      setPaths([]);
      return;
    }
    const f = center(from);
    const next: { d: string; cls: string; key: string }[] = [];

    // Link to the schema slot the point negotiates.
    const sel = points.find((p) => p.id === selectedId);
    const slotEl = sel ? nodeRefs.current.get(`slot:${slotKey(sel.slot)}`) : null;
    if (slotEl) {
      const s = center(slotEl);
      next.push({
        key: "slot",
        cls: "mapedge mapedge--slot",
        d: `M ${s.right} ${s.midY} C ${s.right + 40} ${s.midY}, ${f.left - 40} ${f.y}, ${f.left} ${f.y}`,
      });
    }

    for (const e of selectedEdges) {
      const otherId = e.from === selectedId ? e.to : e.from;
      const other = nodeRefs.current.get(otherId);
      if (!other) continue;
      const o = center(other);
      next.push({
        key: `${e.from}-${e.to}-${e.kind}`,
        cls: `mapedge mapedge--${e.kind === "supports" ? "supports" : "attack"}`,
        d: `M ${f.x} ${f.y} C ${f.x} ${(f.y + o.y) / 2}, ${o.x} ${(f.y + o.y) / 2}, ${o.x} ${o.y}`,
      });
    }
    setPaths(next);
  }, [selectedId, points, selectedEdges]);

  useEffect(() => {
    recomputePaths();
    window.addEventListener("resize", recomputePaths);
    return () => window.removeEventListener("resize", recomputePaths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mode]);

  const profileClass = (p: MapPoint) =>
    p.conclusionDiagnosis === "bridge_of_results"
      ? "warn"
      : p.profile === "bridged"
        ? "bridged"
        : p.profile === "divisive"
          ? "divisive"
          : p.kind === "gap"
            ? "gap"
            : "open";

  const zoneTitle = (kind: MapPoint["kind"]) =>
    kind === "fact" ? tMap("factZone")
    : kind === "value" ? tMap("valueZone")
    : kind === "design" ? tMap("designZone")
    : t("zoneGap");

  const slotLabel = (slot: MapPoint["slot"]) =>
    slot === "P1" ? t("slotP1")
    : slot === "P2" ? t("slotP2")
    : slot === "P3" ? t("slotP3")
    : slot === "P4" ? t("slotP4")
    : slot === "conclusion" ? t("slotConclusion")
    : t("slotNone");

  return (
    <div className="argmap">
      <div className="argmap__toolbar">
        <div className="argmap__counters">
          <span><i className="dot dot--bridged" /> {counters.bridges} {t("counterBridges")}</span>
          <span><i className="dot dot--divisive" /> {counters.conflicts} {t("counterConflicts")}</span>
          <span><i className="dot dot--gap" /> {counters.gaps} {t("counterGaps")}</span>
          {counters.warnings > 0 && (
            <span><i className="dot dot--warn" /> {counters.warnings} ⚠</span>
          )}
          {saturation && (
            <span
              className={`argmap__saturation ${saturation.reached ? "argmap__saturation--reached" : ""}`}
              title={t("saturationDetail", {
                rate: Math.round(saturation.newRate * 100),
                n: saturation.window,
              })}
            >
              {saturation.reached
                ? t("saturationReached")
                : `${t("saturation")} ${Math.round((1 - saturation.newRate) * 100)}%`}
            </span>
          )}
        </div>
        <input
          className="argmap__search"
          type="search"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="argmap__modes">
          {hasVotes && (
            <button
              className={`argmap__mode ${mode === "scatter" ? "argmap__mode--on" : ""}`}
              onClick={() => setMode("scatter")}
            >
              {t("mapMode")}
            </button>
          )}
          <button
            className={`argmap__mode ${mode === "map" ? "argmap__mode--on" : ""}`}
            onClick={() => setMode("map")}
          >
            {t("zonesMode")}
          </button>
          <button
            className={`argmap__mode ${mode === "list" ? "argmap__mode--on" : ""}`}
            onClick={() => setMode("list")}
          >
            {t("listMode")}
          </button>
        </div>
      </div>

      {mode === "list" ? (
        <div className="argmap__list">
          {ZONES.map(({ kind, className }) => {
            const list = visiblePoints.filter((p) => p.kind === kind);
            if (list.length === 0) return null;
            // Same theme clusters as the map — the zoom level applies to
            // both presentations.
            const listThemes = [...new Set(list.map((p) => p.theme ?? ""))].sort(
              (a, b) =>
                list.filter((p) => (p.theme ?? "") === b).length -
                list.filter((p) => (p.theme ?? "") === a).length,
            );
            const hasThemes = listThemes.some((th) => th !== "");
            const renderChips = (chips: MapPoint[]) =>
              chips.map((p) => (
                <details key={p.id} className={`chip chip--${className}`}>
                  <summary>
                    <span className="chip__label">{p.label}</span>
                    {p.slot && <span className={`badge badge--${className}`}>{p.slot}</span>}
                    {p.status === "draft" && <span className="badge badge--draft">{t("draft")}</span>}
                  </summary>
                  <div className="chip__detail">
                    {p.summary && <p>{p.summary}</p>}
                    {p.sources.slice(0, 3).map((s, i) =>
                      s.quote ? (
                        <blockquote key={i} className="quote">
                          „{s.quote}"{s.org && <cite>— {s.org}</cite>}
                        </blockquote>
                      ) : null,
                    )}
                  </div>
                </details>
              ));
            return (
              <section key={kind} className={`map-section map-section--${className}`}>
                <h2>{zoneTitle(kind)} ({list.length})</h2>
                {hasThemes
                  ? listThemes.map((th) => {
                      const themePoints = list.filter((p) => (p.theme ?? "") === th);
                      return (
                        <details
                          key={th || "_other"}
                          className="argmap__theme"
                          open={listThemes.length <= 3 || filtering}
                        >
                          <summary>
                            {th || t("themeOther")}{" "}
                            <span className="argmap__theme-count">{themePoints.length}</span>
                          </summary>
                          {renderChips(themePoints)}
                        </details>
                      );
                    })
                  : renderChips(list)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="argmap__layout">
          <div className="argmap__canvas" ref={containerRef}>
            <svg className="argmap__edges" aria-hidden>
              {paths.map((p) => (
                <path key={p.key} d={p.d} className={p.cls} />
              ))}
            </svg>

            <aside className="argmap__spine">
              <div className="argmap__measure" ref={setNodeRef("slot:conclusionHead")}>
                <span className="argmap__spine-eyebrow">{t("measure")}</span>
                <strong>{title}</strong>
              </div>
              <span className="argmap__spine-eyebrow">{t("schemaTitle")}</span>
              {(["P1", "P2", "P3", "P4", "conclusion"] as const).map((s) => (
                <button
                  key={s}
                  ref={setNodeRef(`slot:${s}`)}
                  className={`argmap__slot ${slotFilter === s || selected?.slot === s ? "argmap__slot--active" : ""} ${s === "conclusion" ? "argmap__slot--conclusion" : ""}`}
                  onClick={() => setSlotFilter(slotFilter === s ? null : s)}
                  title={t("filterHint")}
                >
                  {slotLabel(s)}
                </button>
              ))}
              <button
                ref={setNodeRef("slot:none")}
                className={`argmap__slot argmap__slot--none ${slotFilter === "none" ? "argmap__slot--active" : ""}`}
                onClick={() => setSlotFilter(slotFilter === "none" ? null : "none")}
              >
                {t("slotNone")}
              </button>

              {allThemes.length > 0 && (
                <>
                  <span className="argmap__spine-eyebrow argmap__spine-eyebrow--themes">
                    {t("themesHeading")}
                  </span>
                  {filtering && (
                    <button
                      className="argmap__clearfilter"
                      onClick={() => {
                        setSlotFilter(null);
                        setThemeFilter(null);
                        setQuery("");
                      }}
                    >
                      {t("clearFilters")} ({visiblePoints.length})
                    </button>
                  )}
                  <div className="argmap__themetree">
                    {allThemes.map((th) => (
                      <button
                        key={th}
                        className={`argmap__themelink ${themeFilter === th ? "argmap__themelink--on" : ""}`}
                        onClick={() => setThemeFilter(themeFilter === th ? null : th)}
                      >
                        <span>{th}</span>
                        <em>{points.filter((p) => p.theme === th).length}</em>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </aside>

            {mode === "scatter" ? (
              <div className="argmap__zones">
                {campCount >= 3 ? (
                  <TriangleField
                    points={visiblePoints}
                    selectedId={selectedId}
                    relatedIds={relatedIds}
                    onSelect={setSelectedId}
                    campLabel={campLabel}
                    nodeText={nodeText}
                    t={t}
                  />
                ) : (
                  <ScatterField
                    points={visiblePoints}
                    edges={edges}
                    selectedId={selectedId}
                    relatedIds={relatedIds}
                    onSelect={setSelectedId}
                    campLabel={campLabel}
                    nodeText={nodeText}
                    t={t}
                  />
                )}
              </div>
            ) : (
            <div className="argmap__zones">
              {ZONES.map(({ kind, className }) => {
                const zonePoints = visiblePoints.filter((p) => p.kind === kind);
                if (zonePoints.length === 0) return null;
                // Zoom level: theme clusters (when the theming pass has run),
                // each holding slot groups; unthemed points form one block.
                const themes = [...new Set(zonePoints.map((p) => p.theme ?? ""))].sort(
                  (a, b) =>
                    zonePoints.filter((p) => (p.theme ?? "") === b).length -
                    zonePoints.filter((p) => (p.theme ?? "") === a).length,
                );
                const renderSlotGroups = (themePoints: MapPoint[], themeKey: string) => (
                  <div className="argmap__slotgroups">
                    {SLOTS.map((slot) => {
                      const group = themePoints
                        .filter((p) => p.slot === slot)
                        .sort((a, b) => pointWeight(b) - pointWeight(a));
                      if (group.length === 0) return null;
                      const groupKey = `${kind}:${themeKey}:${slotKey(slot)}`;
                      const expanded =
                        filtering || expandedGroups.has(groupKey) || group.length <= GROUP_LIMIT;
                      const shown = expanded ? group : group.slice(0, GROUP_LIMIT);
                      return (
                        <div key={groupKey} className="argmap__slotgroup">
                          <span className="argmap__slotchip">{slotLabel(slot)}</span>
                          <div className="argmap__nodes">
                            {shown.map((p) => (
                              <button
                                key={p.id}
                                ref={setNodeRef(p.id)}
                                className={[
                                  "mapnode",
                                  `mapnode--${profileClass(p)}`,
                                  p.status === "draft" ? "mapnode--draft" : "",
                                  selectedId === p.id ? "mapnode--selected" : "",
                                  relatedIds.has(p.id) ? "mapnode--related" : "",
                                ].join(" ")}
                                onClick={() =>
                                  setSelectedId(selectedId === p.id ? null : p.id)
                                }
                                title={nodeText(p)}
                              >
                                {nodeText(p)}
                              </button>
                            ))}
                            {!expanded && (
                              <button
                                className="mapnode mapnode--more"
                                onClick={() =>
                                  setExpandedGroups(new Set([...expandedGroups, groupKey]))
                                }
                              >
                                +{group.length - GROUP_LIMIT} {t("showMore")}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
                const hasThemes = themes.some((th) => th !== "");
                return (
                  <section key={kind} className={`argmap__zone argmap__zone--${className}`}>
                    <header>
                      <h3>{zoneTitle(kind)} ({zonePoints.length})</h3>
                      {kind === "design" && <small>{t("designNote")}</small>}
                    </header>
                    {hasThemes
                      ? themes.map((th) => {
                          const themePoints = zonePoints.filter((p) => (p.theme ?? "") === th);
                          return (
                            <details
                              key={th || "_other"}
                              className="argmap__theme"
                              open={themes.length <= 3 || filtering}
                            >
                              <summary>
                                {th || t("themeOther")}{" "}
                                <span className="argmap__theme-count">{themePoints.length}</span>
                              </summary>
                              {renderSlotGroups(themePoints, th || "_other")}
                            </details>
                          );
                        })
                      : renderSlotGroups(zonePoints, "_all")}
                  </section>
                );
              })}
            </div>
            )}
          </div>

          <aside className="argmap__detail">
            {!selected ? (
              <p className="argmap__detail-empty">{t("detailPrompt")}</p>
            ) : (
              <>
                <div className="argmap__detail-badges">
                  <span className={`badge badge--${selected.kind === "gap" ? "design" : selected.kind}`}>
                    {selected.kind}
                  </span>
                  {selected.slot && <span className="badge badge--design">{selected.slot}</span>}
                  {selected.status === "draft" && (
                    <span className="badge badge--draft">{t("draft")}</span>
                  )}
                </div>
                <h3>{selected.label}</h3>
                {(selected.profile || selected.conclusionDiagnosis) && (
                  <p className={`argmap__verdict argmap__verdict--${profileClass(selected)}`}>
                    {selected.conclusionDiagnosis
                      ? t(`conclusion_${selected.conclusionDiagnosis}`)
                      : t(`profile_${selected.profile!}`)}
                  </p>
                )}
                {selected.summary && <p>{selected.summary}</p>}

                {selected.perGroup && selected.perGroup.length > 0 && (
                  <div className="argmap__camps">
                    <span className="argmap__detail-heading">
                      {t("campProfile")} · {t("bridgeThreshold")}
                    </span>
                    {selected.perGroup.map((g) => (
                      <div key={g.group} className="argmap__campbar">
                        <div className="argmap__campbar-name">{campLabel(g.group)}</div>
                        {g.ns > 0 ? (
                          <div className="argmap__campbar-row">
                            <span className="argmap__campbar-track">
                              <i style={{ width: `${Math.round(g.pa * 100)}%` }} />
                              <em />
                            </span>
                            <span className="argmap__campbar-val">
                              {Math.round(g.pa * 100)} % · n={g.ns}
                            </span>
                          </div>
                        ) : (
                          <div className="argmap__campbar-row argmap__campbar-row--empty">
                            {t("noVotesCamp")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {selected.tally && (
                  <p className="argmap__tally">
                    {t("votes")}: ✓ {selected.tally.agree} · ✗ {selected.tally.disagree} · –{" "}
                    {selected.tally.pass}
                  </p>
                )}

                {selected.statement && (
                  <div className="argmap__statement">
                    <span className="argmap__detail-heading">{t("statementLabel")}</span>
                    <p>{selected.statement}</p>
                  </div>
                )}

                {selected.finding && (
                  <div className="argmap__finding">
                    <span className="argmap__detail-heading">{t("finding")}</span>
                    <p>{selected.finding}</p>
                  </div>
                )}

                {selectedEdges.length > 0 && (
                  <div className="argmap__relations">
                    <span className="argmap__detail-heading">{t("relations")}</span>
                    <ul>
                      {selectedEdges.map((e) => {
                        const otherId = e.from === selected.id ? e.to : e.from;
                        const other = byId.get(otherId);
                        if (!other) return null;
                        return (
                          <li key={`${e.from}-${e.to}-${e.kind}`}>
                            <em>{t(`edge_${e.kind}`)}</em>{" "}
                            <button
                              className="argmap__jump"
                              onClick={() => setSelectedId(otherId)}
                            >
                              {other.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {selected.sources.filter((s) => s.quote).length > 0 && (
                  <div className="argmap__quotes">
                    <span className="argmap__detail-heading">{t("quotes")}</span>
                    {selected.sources.slice(0, 4).map((s, i) =>
                      s.quote ? (
                        <blockquote key={i} className="quote">
                          „{s.quote}"{s.org && <cite>— {s.org}</cite>}
                        </blockquote>
                      ) : null,
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
