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
  // The first item (the Lagebild) is the consultation root: exact match only; the others also own their sub-pages.
  const active = (href: string, i: number) => path === href || (i > 0 && path.startsWith(`${href}/`));
  return (
    <ul>
      {items.map((it, i) => (
        <li key={it.href} className={it.sub ? "path-sub" : undefined}>
          {it.group ? <div className="path-group">{it.group}</div> : null}
          <a href={it.href} aria-current={active(it.href, i) ? "page" : undefined}>
            {it.tone ? <span className={`lk-mark lk-tone-${it.tone}`} aria-hidden /> : null}
            <span>{it.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
