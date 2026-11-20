/**
 * Counting attempts in memory (one server process): staff log-ins and password-reset mails. Better Auth
 * limits requests that reach its HTTP routes, but our server actions call it directly, past that limiter.
 */
import { headers } from "next/headers";

const hits = new Map<string, number[]>();

/** How many times `key` was recorded in the last `windowMs`. */
export function recent(key: string, windowMs: number): number {
  const now = Date.now();
  const r = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  hits.set(key, r);
  return r.length;
}

export function record(key: string): void {
  const now = Date.now();
  hits.set(key, [...(hits.get(key) ?? []), now]);
  if (hits.size > 50_000) for (const [k, v] of hits) if (!v.some((t) => t > now - 3_600_000)) hits.delete(k);
}

/** True while `key` has had fewer than `max` attempts in the last `windowMs`; counts this one. */
export function allow(key: string, max: number, windowMs: number): boolean {
  if (recent(key, windowMs) >= max) return false;
  record(key);
  return true;
}

/**
 * The client's address as our own proxy reports it (only for counting, never stored). The LAST entry of
 * X-Forwarded-For is the one the proxy in front of the app wrote; anything before it came with the
 * request and can be made up (Traefik drops such entries today, a CDN in front would keep them).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return chain.at(-1) || h.get("x-real-ip") || "local";
}
