/**
 * Server-safe building blocks shared by the Landkarte apps (Auswertung for
 * ministries, Beteiligung for municipalities). Styling: styles.css (lk-*).
 * No hooks here — interactive pieces live in the apps.
 */

import type { ReactNode } from "react";

import type { Camp, CampCount, MapPoint, Quote } from "../data/types.ts";
import { BEZIRK, DIAG, DOOR, TYP, type Bezirk, type Diag } from "../vocab.ts";

/** The diagnosis as a small square (dashed for Scheinbrücke and Lücke). */
export function DiagMark({ diag, title }: { diag: Diag | null; title?: boolean }) {
  const d = DIAG[diag ?? "offen"];
  return (
    <span className={`lk-mark lk-tone-${d.tone}${d.dashed ? " lk-dashed" : ""}`} title={title === false ? undefined : `${d.label}: ${d.explain}`} aria-hidden={title === false} />
  );
}

export function DiagLabel({ diag }: { diag: Diag | null }) {
  const d = DIAG[diag ?? "offen"];
  return (
    <span className={`lk-diag lk-tone-${d.tone}${d.dashed ? " lk-dashed" : ""}`}>
      <DiagMark diag={diag} title={false} />
      {d.label}
    </span>
  );
}

export function TypTag({ typ }: { typ: MapPoint["typ"] }) {
  return <span className="lk-typ" title={TYP[typ].explain}>{TYP[typ].label}</span>;
}

/**
 * One camp's voices on a point, one circle per organisation in the camp:
 * filled = stimmt zu, ring with stroke = lehnt ab, faint = äußert sich nicht.
 * Counts, not percentages ("4 von 6") — the votes are inferred from a few statements.
 */
/** Above this camp size one circle per sender stops being readable: a bar in the same vocabulary. */
const DOTS_UP_TO = 40;

export function Voices({ count, side, name }: { count: CampCount; side: "a" | "b"; name: string }) {
  const silent = Math.max(0, count.size - count.agree - count.disagree);
  if (count.size > DOTS_UP_TO) {
    const said = count.agree + count.disagree;
    const w = (n: number) => `${Math.round((n / Math.max(1, count.size)) * 1000) / 10}%`;
    return (
      <div className={`lk-voices lk-side-${side}`}>
        <span className="lk-voices-name">{name}</span>
        <span className="lk-voices-bar" aria-hidden>
          <i className="lk-bar-agree" style={{ width: w(count.agree) }} />
          <i className="lk-bar-disagree" style={{ width: w(count.disagree) }} />
        </span>
        <span className="lk-voices-count">
          {said === 0 ? "äußert sich nicht" : `${count.agree} von ${said} dafür`}
        </span>
      </div>
    );
  }
  const dots = [
    ...Array.from({ length: count.agree }, () => "agree"),
    ...Array.from({ length: count.disagree }, () => "disagree"),
    ...Array.from({ length: silent }, () => "silent"),
  ];
  const said = count.agree + count.disagree;
  return (
    <div className={`lk-voices lk-side-${side}`}>
      <span className="lk-voices-name">{name}</span>
      <span className="lk-voices-dots" aria-hidden>
        {dots.map((k, i) => (
          <i key={i} className={`lk-dot lk-dot-${k}`} />
        ))}
      </span>
      <span className="lk-voices-count">
        {said === 0 ? "äußert sich nicht" : `${count.agree} von ${said} dafür`}
      </span>
    </div>
  );
}

export function CampVoices({ votes, camps }: { votes: MapPoint["votes"]; camps: Camp[] }) {
  if (!votes || camps.length < 2) return null;
  return (
    <div className="lk-campvoices">
      <Voices count={votes.a} side="a" name={camps[0]!.name} />
      <Voices count={votes.b} side="b" name={camps[1]!.name} />
    </div>
  );
}

export function QuoteBlock({ quote }: { quote: Quote }) {
  return (
    <blockquote className="lk-quote">
      <p>„{quote.text}“</p>
      <footer>
        {quote.quelle}
        {quote.lager && quote.lager !== "—" ? <span className="lk-quote-camp">{quote.lager}</span> : null}
      </footer>
    </blockquote>
  );
}

function Chip({ p, href }: { p: MapPoint; href: (p: MapPoint) => string }) {
  const d = DIAG[p.diag ?? "offen"];
  return (
    <a href={href(p)} className={`lk-chip lk-tone-${d.tone}${d.dashed ? " lk-dashed" : ""}${p.diag === "kern" ? " lk-chip-kern" : ""}`} title={`${d.label}: ${p.text}`}>
      <span className="lk-chip-label">{p.label}</span>
      {p.diag === "kern" ? <span className="lk-chip-sub">Kernkonflikt: hier liegen die Lager am weitesten auseinander</span> : null}
    </a>
  );
}

function District({ bezirk, points, href }: { bezirk: Bezirk; points: MapPoint[]; href: (p: MapPoint) => string }) {
  if (points.length === 0) return null;
  return (
    <div className="lk-district">
      <div className="lk-district-head">
        <strong>{BEZIRK[bezirk].label}</strong>
        <span>{BEZIRK[bezirk].question}</span>
      </div>
      {points.map((p) => (
        <Chip key={p.id} p={p} href={href} />
      ))}
    </div>
  );
}

/**
 * The Landkarte of one measure in the prototype's form (docs/landkarte1.html):
 * the zone of the experts (facts, by district), the zone of the council
 * (values, the core conflict on its own line), and the design instruments.
 */
export function Landkarte({ points, href }: { points: MapPoint[]; href: (p: MapPoint) => string }) {
  const by = (b: Bezirk) => points.filter((p) => p.bezirk === b);
  const values = by("wert");
  const kern = values.filter((p) => p.diag === "kern");
  return (
    <div className="lk-map">
      <section className="lk-zone lk-zone-evidence" aria-label="Zone der Gutachter">
        <header>
          <h3>Zone der Gutachter</h3>
          <p>Tatsachenfragen: durch Daten, Gutachten und Vergleichsfälle klärbar</p>
        </header>
        <div className="lk-districts">
          {(["wirkung", "machbarkeit", "kosten", "alternativen"] as Bezirk[]).map((b) => (
            <District key={b} bezirk={b} points={by(b)} href={href} />
          ))}
        </div>
      </section>
      <section className="lk-zone lk-zone-political" aria-label="Zone der Politik">
        <header>
          <h3>Zone der Politik</h3>
          <p>Wertungen: keine Studie kann sie entscheiden</p>
        </header>
        {kern.length > 0 ? <div className="lk-kern">{kern.map((p) => <Chip key={p.id} p={p} href={href} />)}</div> : null}
        <div className="lk-grid2">
          {values.filter((p) => p.diag !== "kern").map((p) => (
            <Chip key={p.id} p={p} href={href} />
          ))}
        </div>
      </section>
      {by("ausgestaltung").length > 0 ? (
        <section className="lk-zone lk-zone-design" aria-label="Ausgestaltung">
          <header>
            <h3>Ausgestaltung</h3>
            <p>Instrumente: wie die Regel aussehen soll, wenn sie kommt</p>
          </header>
          <div className="lk-grid2">
            {by("ausgestaltung").map((p) => (
              <Chip key={p.id} p={p} href={href} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function Legend({ only }: { only?: Diag[] }) {
  const keys = only ?? (["bruecke", "warnung", "klaerbar", "wert", "kern", "gestaltung", "offen", "luecke"] as Diag[]);
  return (
    <ul className="lk-legend">
      {keys.map((k) => (
        <li key={k}>
          <DiagMark diag={k} title={false} /> {DIAG[k].label}
        </li>
      ))}
    </ul>
  );
}

export function DoorNote({ door }: { door: MapPoint["door"] }) {
  if (!door) return null;
  return <span className="lk-door">antwortet auf die {DOOR[door].label}: {DOOR[door].question}</span>;
}

/** A labelled number in running prose ("1.062 Argumente"). */
export function Figure({ n, children }: { n: number | string; children: ReactNode }) {
  return (
    <span className="lk-figure">
      <b>{typeof n === "number" ? n.toLocaleString("de-DE") : n}</b> {children}
    </span>
  );
}
