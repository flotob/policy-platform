import Link from "next/link";

import type { Beitrag } from "@/lib/beitraege";

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });

/**
 * "Ihre Beiträge": this browser's points and statements in this procedure, each with where it stands and a
 * link to its Laufzettel. Only the browser that sent them sees the list.
 */
export function Beitraege({ items, base, title = "Ihre Beiträge", className = "" }: { items: Beitrag[]; base: string; title?: string; className?: string }) {
  if (!items.length) return null;
  return (
    <section className={`mine-list ${className}`.trim()} aria-label={title}>
      <h2>
        {title} <span className="num muted">({items.length})</span>
      </h2>
      <ul>
        {items.map((b) => (
          <li key={b.token}>
            <Link href={`${base}/${b.href}`}>
              <span className="ml-meta">
                {b.kind === "punkt" ? "Ihr Punkt" : "Ihre Stellungnahme"} vom {day.format(new Date(b.at))}
              </span>
              <span className="ml-text">{b.label}</span>
              <span className={`ml-status ml-${b.tone}`}>{b.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Diese Liste sieht nur dieser Browser. Auf einem anderen Gerät öffnen Sie einen Laufzettel über seinen Link, oder Sie lassen sich die Links per
        E-Mail schicken.
      </p>
    </section>
  );
}
