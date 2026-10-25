"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page while the machine works in the background; stops once it is done. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
