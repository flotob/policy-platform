"use client";

import { useLocale } from "next-intl";

import { routing } from "@/i18n/routing";
import { Link, usePathname } from "@/navigation";

export function LocaleSwitcher() {
  const pathname = usePathname();
  const active = useLocale();
  return (
    <span className="locale-switch">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === active ? "true" : undefined}
        >
          {locale}
        </Link>
      ))}
    </span>
  );
}
