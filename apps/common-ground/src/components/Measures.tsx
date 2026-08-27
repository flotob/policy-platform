"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { computeChain } from "@policy/chain";

import type { CGPoint, CampRef } from "@/lib/types";
import { Chain } from "./Chain";

/**
 * The sub-decisions as cards, each expandable into its own full chain.
 * Scopes stay clean: a measure's chain sees only its own points; the shared
 * trunk lives in the page's main chain above.
 */
export function Measures({
  measures,
  points,
  camps,
}: {
  measures: { name: string; count: number }[];
  points: CGPoint[];
  camps: CampRef[];
}) {
  const t = useTranslations("Chain");
  const tc = useTranslations("Consultation");
  const [open, setOpen] = useState<string | null>(null);

  const slotLabelOf = (slot: string) =>
    slot === "conclusion" ? t("slotConclusion") : t(`slot${slot}` as "slotP1");

  return (
    <div className="measures">
      {measures.map((m) => {
        const scoped = points.filter((p) => p.measure === m.name);
        const chain = computeChain(scoped);
        const fork = chain && chain.forkIdx >= 0 ? chain.stations[chain.forkIdx]! : null;
        const verdict = !chain
          ? t("cardNoData")
          : fork
            ? t("cardBreak", { fork: slotLabelOf(fork.slot) })
            : t("cardNoBreak");
        const isOpen = open === m.name;
        return (
          <div key={m.name} className={`mcard ${isOpen ? "is-open" : ""}`}>
            <button
              className="mcard__head"
              onClick={() => setOpen(isOpen ? null : m.name)}
              aria-expanded={isOpen}
            >
              <span className="mcard__name">{m.name}</span>
              <span className="mcard__meta">
                {tc("measurePoints", { n: m.count })}
              </span>
              <span
                className={`mcard__verdict ${
                  fork ? "mcard__verdict--break" : chain ? "mcard__verdict--ok" : ""
                }`}
              >
                {verdict}
              </span>
            </button>
            {isOpen && (
              <div className="mcard__body">
                <Chain points={scoped} camps={camps} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
