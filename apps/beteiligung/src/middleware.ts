import { NextResponse, type NextRequest } from "next/server";

/** The one public address (since 2026-11-19). */
const CANONICAL_HOST = "streit.bar";

/**
 * Other names that reach this app on the server: the old address (links already handed out
 * to stakeholders) and www. They go on to the same path on streit.bar. Hard-coded rather than
 * env so the edge middleware cannot miss them; localhost never matches.
 */
const REDIRECT_HOSTS = new Set(["beteiligung.saskana.org", "www.streit.bar"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
  if (!REDIRECT_HOSTS.has(host)) return NextResponse.next();
  const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${CANONICAL_HOST}`);
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
