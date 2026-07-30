import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { getDirection, routing } from "@/i18n/routing";
import { Link } from "@/navigation";

import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const t = await getTranslations("Nav");
  return (
    <html lang={locale} dir={getDirection(locale)}>
      <body>
        <NextIntlClientProvider>
          <header className="site-header">
            <div className="site-header__inner">
              <Link href="/" className="wordmark">
                policy
              </Link>
              <nav className="site-nav">
                <Link href="/consultations">{t("consultations")}</Link>
                <Link href="/tenants">{t("tenants")}</Link>
                <LocaleSwitcher />
              </nav>
            </div>
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
