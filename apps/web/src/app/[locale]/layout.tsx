import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
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
    <html lang={locale} dir={getDirection(locale)} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}',
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider>
          <header className="site-header">
            <div className="site-header__inner">
              <Link href="/" className="wordmark">
                policy
              </Link>
              <nav className="site-nav">
                <Link href="/consultations">{t("consultations")}</Link>
                <Link href="/how-it-works">{t("howItWorks")}</Link>
                <Link href="/methods">{t("methods")}</Link>
                <Link href="/tenants" prefetch={false}>{t("tenants")}</Link>
                <LocaleSwitcher />
                <ThemeToggle />
              </nav>
            </div>
          </header>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
