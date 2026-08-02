import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link } from "@/navigation";

/** The one global header — identical on document pages and in the app shell. */
export async function SiteHeader() {
  const t = await getTranslations("Nav");
  return (
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
  );
}
