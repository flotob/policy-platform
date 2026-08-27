"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CGPoint } from "@/lib/types";

const CQ_KINDS = [
  "empirics",
  "alternatives",
  "goal_conflict",
  "feasibility",
  "value_conflict",
] as const;

const TRUNK = "übergreifend";

function byMeasure(a: CGPoint, b: CGPoint): number {
  return (a.measure ?? TRUNK).localeCompare(b.measure ?? TRUNK);
}

function DoorItem({ p }: { p: CGPoint }) {
  const chip = p.measure && p.measure !== TRUNK && (
    <span className="pointchip">{p.measure}</span>
  );
  return (
    <li className="pointitem">
      {p.summary ? (
        <details>
          <summary>
            {p.label}
            {chip}
          </summary>
          <p className="pointitem__summary">{p.summary}</p>
        </details>
      ) : (
        <span className="pointitem__plain">
          {p.label}
          {chip}
        </span>
      )}
    </li>
  );
}

/**
 * The five doors as expandable cards: closed = the ordering principle
 * (question, counts, one example), open = every objection of this kind
 * across all measures plus the solutions whose primary door this is —
 * same interaction grammar as the measure cards.
 */
export function Doors({ points }: { points: CGPoint[] }) {
  const t = useTranslations("Consultation");
  const td = useTranslations("Doors");
  const [open, setOpen] = useState<string | null>(null);

  const doors = CQ_KINDS.map((cq) => ({
    cq,
    objections: points.filter((p) => p.cq === cq).sort(byMeasure),
    solutions: points.filter((p) => p.answersCq?.[0] === cq).sort(byMeasure),
  })).filter((d) => d.objections.length > 0 || d.solutions.length > 0);

  return (
    <div className="doors">
      {doors.map((d) => {
        const isOpen = open === d.cq;
        return (
          <div key={d.cq} className={`doorcard ${isOpen ? "is-open" : ""}`}>
            <button
              className="doorcard__head"
              onClick={() => setOpen(isOpen ? null : d.cq)}
              aria-expanded={isOpen}
            >
              <h3 className="doorcard__title">{td(d.cq as "empirics")}</h3>
              <p className="doorcard__q">{td(`${d.cq}Q` as "empiricsQ")}</p>
              <p className="doorcard__counts">
                {t("doorObjections", { n: d.objections.length })} ·{" "}
                {t("doorSolutions", { n: d.solutions.length })}
              </p>
              {!isOpen && d.objections[0] && (
                <p className="doorcard__example">
                  <span>{t("doorExample")}</span> {d.objections[0].label}
                </p>
              )}
            </button>
            {isOpen && (
              <div className="doorcard__body">
                {d.objections.length > 0 && (
                  <>
                    <h4 className="door__title">
                      {t("doorObjectionsHeading", { n: d.objections.length })}
                    </h4>
                    <ul className="pointlist">
                      {d.objections.map((p) => (
                        <DoorItem key={p.id} p={p} />
                      ))}
                    </ul>
                  </>
                )}
                {d.solutions.length > 0 && (
                  <>
                    <p className="door__solutions">
                      ⚒ {t("doorSolutionsHeading", { n: d.solutions.length })}
                    </p>
                    <ul className="pointlist pointlist--solutions">
                      {d.solutions.map((p) => (
                        <DoorItem key={p.id} p={p} />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
