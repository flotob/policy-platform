"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** The header's links. On phones the quieter links fold into a menu below the bar; the main button stays in view. */
export function SiteNav({ staff }: { staff: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <nav className="site-nav" aria-label="Hauptnavigation" ref={ref}>
      <div id="site-menu" className={open ? "site-menu open" : "site-menu"}>
        <Link href="/#ablauf" onClick={close}>
          So funktioniert es
        </Link>
        <Link href="/musterstadt" onClick={close}>
          Beispiel
        </Link>
        {staff ? null : (
          <Link href="/anmelden" onClick={close}>
            Anmelden
          </Link>
        )}
      </div>
      {staff ? (
        <Link href="/verwaltung" className="btn btn-small">
          Meine Kommune
        </Link>
      ) : (
        <Link href="/registrieren" className="btn btn-small">
          Für Kommunen
        </Link>
      )}
      <button type="button" className="site-menu-btn" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" aria-hidden>
          {open ? <path d="M5 5l10 10M15 5 5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
        </svg>
        <span className="visually-hidden">{open ? "Menü schließen" : "Menü"}</span>
      </button>
    </nav>
  );
}
