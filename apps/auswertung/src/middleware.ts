import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * The whole app behind HTTP Basic auth when SITE_PASSWORD is set (the hosted
 * demo); unset in dev = open. Any user name works, the password decides.
 */
export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Anmeldung erforderlich.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Landkarte des Streits", charset="UTF-8"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
