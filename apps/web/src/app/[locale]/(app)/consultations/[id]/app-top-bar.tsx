"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/** Second-level bar: the consultation's identity and its views. */
export function ConsultationBar({
  locale,
  currentId,
  title,
}: {
  locale: string;
  currentId: string;
  title: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("AppShell");
  const base = `/${locale}/consultations/${currentId}`;
  const views = [
    { href: base, label: t("viewOverview"), exact: true },
    { href: `${base}/map`, label: t("viewMap"), exact: false },
    { href: `${base}/vote`, label: t("viewVote"), exact: false },
    { href: `${base}/review`, label: t("viewReview"), exact: false, prefetch: false },
  ];

  return (
    <div className="appbar">
      <span className="appbar__title" title={title}>
        {title}
      </span>
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
    </div>
  );
}
