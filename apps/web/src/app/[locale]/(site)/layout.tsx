import type { ReactNode } from "react";

import { SiteHeader } from "@/components/SiteHeader";

/** Document-style pages: reading layout under the global header. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
