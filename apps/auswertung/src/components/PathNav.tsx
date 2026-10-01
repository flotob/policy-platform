"use client";

import { usePathname } from "next/navigation";

export interface PathItem {
  href: string;
  label: string;
  /** Verdict tone of a measure (coloured mark before the name). */
  tone?: string;
  sub?: boolean;
  group?: string;
}

/** The left column: Frau K.'s path through the consultation. */
export function PathNav({ items }: { items: PathItem[] }) {
  const path = usePathname();
  return (
    <ul>
      {items.map((it) => (
        <li key={it.href} className={it.sub ? "path-sub" : undefined}>
          {it.group ? <div className="path-group">{it.group}</div> : null}
          <a href={it.href} aria-current={path === it.href ? "page" : undefined}>
            {it.tone ? <span className={`lk-mark lk-tone-${it.tone}`} aria-hidden /> : null}
            <span>{it.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
