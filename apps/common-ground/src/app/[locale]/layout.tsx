import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Fraunces, Public_Sans, Source_Serif_4 } from "next/font/google";

import { routing } from "@/i18n/routing";
import { Link } from "@/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

import "../globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "SOFT", "WONK"],
});
const prose = Source_Serif_4({ subsets: ["latin"], variable: "--font-prose" });
const data = Public_Sans({ subsets: ["latin"], variable: "--font-data" });

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
  const t = await getTranslations("Shell");
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${display.variable} ${prose.variable} ${data.variable}`}
    >
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
          <header className="shell-header">
            <Link href="/" className="shell-header__brand">
              <span className="shell-header__mark" aria-hidden>
                ⏚
              </span>
              Common Ground
            </Link>
            <div className="shell-header__side">
              <span className="shell-header__claim">{t("claim")}</span>
              <ThemeToggle />
            </div>
          </header>
          {children}
          <footer className="shell-footer">
            <span>{t("footer")}</span>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
