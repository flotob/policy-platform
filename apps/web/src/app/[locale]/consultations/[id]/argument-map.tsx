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
  const [mode, setMode] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const campLabel = (g: number) => campNames?.[String(g)]?.name ?? `G${g}`;
  const nodeText = (p: MapPoint) => p.statement ?? p.label;
  const q = query.trim().toLowerCase();
  const visiblePoints = q
    ? points.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          (p.statement ?? "").toLowerCase().includes(q) ||
          (p.summary ?? "").toLowerCase().includes(q),
      )
    : points;
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
          <button
            className={`argmap__mode ${mode === "map" ? "argmap__mode--on" : ""}`}
            onClick={() => setMode("map")}
          >
            {t("mapMode")}
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
            return (
              <section key={kind} className={`map-section map-section--${className}`}>
                <h2>{zoneTitle(kind)} ({list.length})</h2>
                {list.map((p) => (
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
                ))}
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
                  className={`argmap__slot ${selected?.slot === s ? "argmap__slot--active" : ""} ${s === "conclusion" ? "argmap__slot--conclusion" : ""}`}
                  onClick={() => setSelectedId(null)}
                >
                  {slotLabel(s)}
                </button>
              ))}
              <div ref={setNodeRef("slot:none")} className="argmap__slot argmap__slot--none">
                {t("slotNone")}
              </div>
            </aside>

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
                        q !== "" || expandedGroups.has(groupKey) || group.length <= GROUP_LIMIT;
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
                              open={themes.length <= 3 || q !== ""}
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
                        <span title={campLabel(g.group)}>{campLabel(g.group)}</span>
                        <span className="argmap__campbar-track">
                          <i style={{ width: `${Math.round(g.pa * 100)}%` }} />
                          <em />
                        </span>
                        <span>{Math.round(g.pa * 100)}% (n={g.ns})</span>
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
