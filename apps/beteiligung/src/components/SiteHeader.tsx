import Link from "next/link";

import { getStaff } from "@/lib/session";

import { SiteNav } from "./SiteNav";

/** Public header: the product, the way in for municipalities. */
export async function SiteHeader() {
  const staff = await getStaff();
  return (
    <header className="site-head">
      <div className="wrap site-head-in">
        <Link href="/" className="wordmark">
          <span className="wordmark-mark" aria-hidden>
            <i className="ga" />
            <i className="gb" />
          </span>
          streit.bar
        </Link>
        <SiteNav staff={!!staff} />
      </div>
    </header>
  );
}
