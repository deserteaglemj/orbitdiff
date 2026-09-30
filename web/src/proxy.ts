import { NextResponse, type NextRequest } from "next/server";

import { hasSessionCookie, PATHNAME_HEADER, signInRedirect } from "@/server/auth/paths";
import { createNonce, securityHeaders } from "@/server/auth/security-headers";

/**
 * Runs before every page. It needs no configuration and no database, so it
 * behaves the same on a deployment that has neither.
 *
 * 1. Security headers, with a Content-Security-Policy whose nonce is new for
 *    each request. Next.js reads the nonce from the policy on the request and
 *    puts it on the scripts it renders.
 * 2. An optimistic redirect to sign-in for the signed-in areas when the request
 *    carries no session cookie. It only checks that a cookie is present. Who
 *    may see what is decided by the guards (src/server/auth/guards.ts), which
 *    read the session from the database.
 * 3. The requested path, handed to the page as a request header, so the
 *    signed-in layout knows which page it is guarding. The value a client sends
 *    in that header is always replaced.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search, protocol } = request.nextUrl;
  const https = protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const nonce = createNonce();
  const headers = securityHeaders({ nonce, development: process.env.NODE_ENV === "development", https });

  const destination = signInRedirect({
    pathname,
    search,
    hasSession: hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name)),
  });

  let response: NextResponse;
  if (destination !== null) {
    response = NextResponse.redirect(new URL(destination, request.nextUrl.origin));
  } else {
    const forwarded = new Headers(request.headers);
    forwarded.set("x-nonce", nonce);
    forwarded.set(PATHNAME_HEADER, pathname);
    for (const [name, value] of headers) {
      if (name === "Content-Security-Policy") forwarded.set(name, value);
    }
    response = NextResponse.next({ request: { headers: forwarded } });
  }
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except API routes, the build output, the image optimizer, and
     * files served from public/. Those are not pages: next.config.ts gives them
     * the fixed security headers.
     */
    "/((?!api/|api$|_next/static|_next/image|.*\\.svg$|.*\\.png$|.*\\.ico$|.*\\.txt$|.*\\.xml$).*)",
  ],
};
