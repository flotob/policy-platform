"use client";

import { useEffect, useState } from "react";

/** Light/dark toggle: system preference by default, choice persisted. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? null);
    setMounted(true);
  }, []);

  // The server can't know the visitor's scheme — until mounted, render a
  // neutral glyph so SSR and first client render agree (no hydration diff).
  const effectiveDark =
    mounted &&
    (theme === "dark" ||
      (theme === null && window.matchMedia("(prefers-color-scheme: dark)").matches));

  const toggle = () => {
    const next = effectiveDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setTheme(next);
  };

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle color scheme"
      title="Hell/Dunkel"
    >
      {!mounted ? "◐" : effectiveDark ? "☀" : "☾"}
    </button>
  );
}
