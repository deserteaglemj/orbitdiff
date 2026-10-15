/**
 * Where a person may be sent before and after signing in. Pure functions with no
 * imports, shared by the proxy, the server layout, and the browser screens, so
 * this module must stay free of server-only code.
 *
 * None of this is authorization. The guards in guards.ts decide who may read
 * what. These functions only pick a destination, and the one rule they enforce
 * is that a destination is always a path on this site.
 */

export const SIGN_IN_PATH = "/sign-in";
export const DASHBOARD_PATH = "/dashboard";
export const ONBOARDING_PATH = "/onboarding";
export const VERIFY_EMAIL_PATH = "/verify-email";

/**
 * Request header the proxy sets to the requested path. On a request the proxy
 * runs on, it replaces whatever the client sent. On a request the proxy does
 * not run on, the header still holds the client's own value: read it through
 * requestedPathname(), never directly.
 */
export const PATHNAME_HEADER = "x-orbitdiff-pathname";

/** Request header the proxy sets to the nonce of the policy it sends with the page. */
export const NONCE_HEADER = "x-nonce";

const POLICY_HEADER = "content-security-policy";

/**
 * The path the proxy reported for this request, or null.
 *
 * The path header is read only on a request that carries the proxy's other
 * marks as well: the nonce, and the policy that names that nonce. The proxy
 * sets the three together. A request that lacks them did not come through the
 * proxy, so its path header is whatever the client chose, and the answer is
 * null. The signed-in layout treats null as any page other than onboarding.
 *
 * This is a second line, not a proof: a client that reached a page without
 * passing the proxy could send all three headers itself. What prevents that is
 * the matcher in src/proxy.ts, which runs the proxy on every page path, and the
 * pages, which call the guards themselves before loading data.
 */
export function requestedPathname(headers: Pick<Headers, "get">): string | null {
  const nonce = headers.get(NONCE_HEADER);
  if (typeof nonce !== "string" || nonce.length === 0) return null;
  const policy = headers.get(POLICY_HEADER);
  if (typeof policy !== "string" || !policy.includes(`'nonce-${nonce}'`)) return null;
  const pathname = headers.get(PATHNAME_HEADER);
  return typeof pathname === "string" && pathname.length > 0 ? pathname : null;
}

/** Areas that need a login. The proxy redirects a visitor without a session cookie away from them. */
export const PROTECTED_PREFIXES = ["/dashboard", "/profiles", "/settings", "/onboarding", "/admin"] as const;

/** Screens for people who are not signed in. Never a destination after sign-in. */
const SIGNED_OUT_SCREENS = ["/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password"] as const;

/**
 * Longest path a redirect target or a mail link may carry. The auth gate uses
 * the same bound: the value is stored in captured mail, so it is bounded.
 */
export const SITE_PATH_MAX = 512;
/** One leading slash, then printable ASCII without a space or a backslash. Never "//host" or "/\host". */
const SITE_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;
const PARSE_BASE = "http://site.invalid";

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

/**
 * The value resolved the way a browser resolves it, or null when it is not a
 * path on this site. It must be a string of at most 512 characters that starts
 * with exactly one slash and holds only printable ASCII without a backslash,
 * and it must still be on this site after resolution. The shape alone is not
 * enough: "/.//host", "/a/..//host", and "/%2e//host" all start with one slash
 * and all resolve to "//host", which a browser reads as another host.
 */
function resolveOnSite(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > SITE_PATH_MAX || !SITE_PATH.test(value)) return null;
  let resolved: URL;
  try {
    resolved = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== PARSE_BASE || resolved.pathname.startsWith("//")) return null;
  return resolved;
}

function serialize(resolved: URL): string {
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * True for a value that may be used as a redirect target or in a mail link: a
 * bounded path that a browser keeps on this site. The auth gate refuses every
 * other value before it is redirected to, stored, or mailed.
 */
export function isSitePath(value: unknown): value is string {
  return resolveOnSite(value) !== null;
}

/**
 * The path with `error=<code>` in its query, for a redirect that reports a
 * failure. The result is built from the resolved path, so it never starts with
 * two slashes. A value that is not a path on this site is not repaired: the
 * answer is the home page with the error.
 */
export function withErrorCode(path: unknown, code: string): string {
  const resolved = resolveOnSite(path) ?? new URL("/", PARSE_BASE);
  resolved.searchParams.set("error", code);
  return serialize(resolved);
}

/**
 * The value as a destination after sign-in, or null. It must be a path on this
 * site (see resolveOnSite) that does not point at an API route. The resolved
 * form is what is returned.
 */
export function safeNextPath(value: unknown): string | null {
  const resolved = resolveOnSite(value);
  if (resolved === null || under(resolved.pathname, "/api")) return null;
  return serialize(resolved);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => under(pathname, prefix));
}

function isSignedOutScreen(path: string): boolean {
  const pathname = pathnameOf(path);
  return SIGNED_OUT_SCREENS.some((screen) => under(pathname, screen));
}

/** True when the request carries a Better Auth session cookie. Presence only: the guards verify it. */
export function hasSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (name === "better-auth.session_token" || name === "__Secure-better-auth.session_token") return true;
  }
  return false;
}

/** The sign-in page, remembering `next` when it is a safe destination. */
export function signInPath(next: unknown): string {
  const safe = safeNextPath(next);
  if (safe === null || isSignedOutScreen(safe)) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(safe)}`;
}

/**
 * The proxy's decision: where to send a request for a protected page that
 * carries no session cookie, or null to let the request through. Optimistic
 * only, a forged cookie passes here and is refused by the guards.
 */
export function signInRedirect(input: { pathname: string; search: string; hasSession: boolean }): string | null {
  if (input.hasSession || !isProtectedPath(input.pathname)) return null;
  return signInPath(`${input.pathname}${input.search}`);
}

/**
 * Where to go after a successful sign-in: onboarding until it is complete, then
 * the safe destination that was asked for, then the dashboard.
 */
export function afterSignInPath(input: { onboarded: boolean; next: unknown }): string {
  if (!input.onboarded) return ONBOARDING_PATH;
  const safe = safeNextPath(input.next);
  if (safe === null || isSignedOutScreen(safe)) return DASHBOARD_PATH;
  return safe;
}
