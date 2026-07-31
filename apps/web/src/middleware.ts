import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/**
 * Editorial surfaces (review, tenants) are gated by HTTP Basic auth when
 * EDIT_PASSWORD is set — the public demo stays read+vote only. Unset in
 * dev = open. Proper OIDC auth replaces this (roadmap).
 */
const PROTECTED = /^\/(?:[a-z]{2})(?:\/tenants|\/consultations\/[^/]+\/review)/;

export default function middleware(request: NextRequest) {
  const password = process.env.EDIT_PASSWORD;
  if (password && PROTECTED.test(request.nextUrl.pathname)) {
    const header = request.headers.get("authorization") ?? "";
    const [scheme, encoded] = header.split(" ");
    let ok = false;
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      ok = decoded.slice(decoded.indexOf(":") + 1) === password;
    }
    if (!ok) {
      // Only challenge real navigations: a WWW-Authenticate on prefetch
      // responses makes browsers pop the credential dialog on pages that
      // merely LINK here.
      const isDocument = request.headers.get("sec-fetch-dest") === "document";
      return new NextResponse("Authentication required", {
        status: 401,
        headers: isDocument
          ? { "WWW-Authenticate": 'Basic realm="policy editorial"' }
          : undefined,
      });
    }
  }
  return intl(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
