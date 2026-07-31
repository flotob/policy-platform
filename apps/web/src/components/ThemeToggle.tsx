"use client";

import { useEffect, useState } from "react";

/** Light/dark toggle: system preference by default, choice persisted. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? null);
  }, []);

  const effectiveDark =
    theme === "dark" ||
    (theme === null &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

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
      {effectiveDark ? "☀" : "☾"}
    </button>
  );
}
