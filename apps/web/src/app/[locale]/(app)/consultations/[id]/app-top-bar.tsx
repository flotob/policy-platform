"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppTopBar({
  locale,
  currentId,
  consultations,
}: {
  locale: string;
  currentId: string;
  consultations: { id: string; title: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("AppShell");
  const base = `/${locale}/consultations/${currentId}`;
  const views = [
    { href: base, label: t("viewMap"), exact: true },
    { href: `${base}/vote`, label: t("viewVote"), exact: false },
    { href: `${base}/review`, label: t("viewReview"), exact: false, prefetch: false },
    { href: `${base}/report`, label: t("viewReport"), exact: false },
  ];

  return (
    <header className="appbar">
      <Link href={`/${locale}`} className="wordmark wordmark--compact">
        policy
      </Link>
      <select
        className="appbar__switcher"
        value={currentId}
        aria-label={t("switcher")}
        onChange={(e) => {
          const rest = pathname?.endsWith("/vote") ? "/vote" : "";
          router.push(`/${locale}/consultations/${e.target.value}${rest}`);
        }}
      >
        {consultations.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <nav className="appbar__views">
        {views.map((v) => {
          const active = v.exact ? pathname === v.href : pathname?.startsWith(v.href);
          return (
            <Link
              key={v.href}
              href={v.href}
              prefetch={v.prefetch}
              className={`appbar__view ${active ? "appbar__view--on" : ""}`}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>
      <div className="appbar__meta">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
