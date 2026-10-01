import type { ReactNode } from "react";

import { CampVoices, DIAG, DiagLabel, displayScope, slugOf, type Tone } from "@policy/landkarte";
import type { Camp, MapPoint, MeasureSummary } from "@policy/landkarte/data";

/** Reading column + margin note — the layout unit of every page. */
export function Row({ children, margin, id }: { children: ReactNode; margin?: ReactNode; id?: string }) {
  return (
    <div className="row" id={id}>
      <div className="row-main">{children}</div>
      <aside className="margin">{margin}</aside>
    </div>
  );
}

/** One Landkarten-Punkt as a finding: the statement, its question, and in the margin what the camps say. */
export function FindingRow({ p, base, camps, showMeasure = true }: { p: MapPoint; base: string; camps: Camp[]; showMeasure?: boolean }) {
  return (
    <Row
      margin={
        <>
          <DiagLabel diag={p.diag} />
          <CampVoices votes={p.votes} camps={camps} />
          {showMeasure ? (
            <div>
              <a href={`${base}/massnahmen/${slugOf(p.scope)}`}>{displayScope(p.scope)}</a>
            </div>
          ) : null}
        </>
      }
    >
      {p.question ? <p className="muted small" style={{ margin: "0 0 0.2rem" }}>{p.question}</p> : null}
      <p className="row-title">
        <a href={`${base}/punkt/${p.id}`}>{p.text}</a>
      </p>
    </Row>
  );
}

const TONE_ORDER: Tone[] = ["bridge", "evidence", "political", "design", "open"];

/** How a measure's Landkarten-Punkte split across the diagnosis colours. */
export function Strip({ m }: { m: MeasureSummary }) {
  const by: Record<Tone, number> = { bridge: 0, evidence: 0, political: 0, design: 0, open: 0 };
  for (const [k, n] of Object.entries(m.counts)) {
    if (k === "luecke") continue;
    by[DIAG[k as keyof typeof DIAG].tone] += n ?? 0;
  }
  const total = TONE_ORDER.reduce((s, t) => s + by[t], 0) || 1;
  return (
    <span className="strip" aria-hidden>
      {TONE_ORDER.map((t) => (by[t] ? <i key={t} className={`s-${t}`} style={{ width: `${(by[t] / total) * 100}%` }} /> : null))}
    </span>
  );
}
