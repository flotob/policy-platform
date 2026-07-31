"use client";

/**
 * Tabbed presentation for the consultation page: each tab carries a short
 * explainer so first-time readers know what they are looking at. Content
 * is server-rendered and passed in as ReactNodes.
 */

import { type ReactNode, useState } from "react";

export interface TabDef {
  key: string;
  label: string;
  explainer: string;
  content: ReactNode;
}

export function ConsultationTabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  if (tabs.length === 0) return null;
  const current = tabs.find((t) => t.key === active) ?? tabs[0]!;
  return (
    <div className="ctabs">
      {tabs.length > 1 && (
        <div className="ctabs__bar" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === current.key}
              className={`ctabs__tab ${t.key === current.key ? "ctabs__tab--on" : ""}`}
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <p className="ctabs__explainer">{current.explainer}</p>
      <div role="tabpanel">{current.content}</div>
    </div>
  );
}
