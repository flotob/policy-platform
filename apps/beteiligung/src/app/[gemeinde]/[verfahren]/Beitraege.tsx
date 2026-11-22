import Link from "next/link";

import type { Beitrag } from "@/lib/beitraege";

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });
const dayShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

/** In the sidebar: the newest few, the rest behind "Alle anzeigen". */
const SIDE_SHOWN = 3;

function SideItem({ b, base }: { b: Beitrag; base: string }) {
  return (
    <li>
      <Link href={`${base}/${b.href}`}>
        <span className="ms-text">{b.kind === "punkt" ? b.label : `Stellungnahme ${b.label}`}</span>
        <span className="ms-meta">
          <span className={`ml-status ml-${b.tone}`}>{b.status}</span> · {dayShort.format(new Date(b.at))}
        </span>
      </Link>
    </li>
  );
}

/**
 * "Ihre Beiträge": this browser's points and statements in this procedure, each with where it stands and a
 * link to its Laufzettel. Only the browser that sent them sees the list. `side` = the compact form for the
 * procedure page's sidebar.
 */
export function Beitraege({
  items,
  base,
  title = "Ihre Beiträge",
  className = "",
  side = false,
}: {
  items: Beitrag[];
  base: string;
  title?: string;
  className?: string;
  side?: boolean;
}) {
  if (!items.length) return null;
  if (side) {
    const rest = items.slice(SIDE_SHOWN);
    return (
      <section className={`mine-side ${className}`.trim()} aria-label={title}>
        <h3>
          {title} <span className="num muted">({items.length})</span>
        </h3>
        <ul>
          {items.slice(0, SIDE_SHOWN).map((b) => (
            <SideItem key={b.token} b={b} base={base} />
          ))}
        </ul>
        {rest.length ? (
          <details>
            <summary>Alle {items.length} anzeigen</summary>
            <ul>
              {rest.map((b) => (
                <SideItem key={b.token} b={b} base={base} />
              ))}
            </ul>
          </details>
        ) : null}
        <p className="small muted">Nur in diesem Browser sichtbar. Jeder Beitrag führt zu seinem Laufzettel.</p>
      </section>
    );
  }
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
