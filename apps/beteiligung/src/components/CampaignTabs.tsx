"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Setup · the argument as it stands · the editorial queue. */
export function CampaignTabs({ id, queue, showWork }: { id: string; queue: number; showWork: boolean }) {
  const path = usePathname();
  const base = `/verwaltung/${id}`;
  const tabs = [
    { href: base, label: "Einrichtung" },
    ...(showWork
      ? [
          { href: `${base}/punkte`, label: "Begründung und Einwände" },
          { href: `${base}/redaktion`, label: "Redaktion", badge: queue },
        ]
      : []),
  ];
  return (
    <nav className="cp-tabs" aria-label="Bereiche des Verfahrens">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          {t.label}
          {"badge" in t && t.badge ? <span className="badge num">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
