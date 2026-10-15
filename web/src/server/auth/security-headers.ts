/**
 * The security headers of every response. Pure functions with no imports and no
 * configuration, so the proxy can call them on a deployment that has none.
 *
 * Pages get the policy built here, with a nonce that is new for every request
 * (src/proxy.ts). Responses the proxy does not see (API routes, static files)
 * get the fixed headers below from next.config.ts, which repeats these values
 * because it cannot import application modules. tests/unit/server/proxy.test.ts
 * fails if the two drift apart.
 */

export interface PolicyInput {
  /** Base64 text, new for every request. */
  nonce: string;
  /** True under `next dev`, where the React tooling needs eval and injects style tags. */
  development: boolean;
  /** True when the request arrived over https. */
  https: boolean;
}

export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

/** The headers that do not depend on the request. */
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
] as const;

/** For responses that are not pages: nothing may load or run, and nothing may frame them. */
export const STATIC_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const NONCE_SHAPE = /^[A-Za-z0-9+/_-]{8,}={0,2}$/;

/** A nonce as the Next.js guide builds it: a random UUID, base64 encoded. 122 random bits. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The policy for a page. Scripts run only from this site and only with the
 * nonce of this response; inline scripts are never allowed. No directive names
 * an origin other than this site.
 */
export function contentSecurityPolicy({ nonce, development, https }: PolicyInput): string {
  if (!NONCE_SHAPE.test(nonce)) throw new Error("The nonce must be base64 text.");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Every security header for a page response, as name and value pairs. */
export function securityHeaders(input: PolicyInput): Array<[name: string, value: string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", contentSecurityPolicy(input)],
    ...STATIC_SECURITY_HEADERS.map((header): [string, string] => [header.key, header.value]),
  ];
  if (input.https) headers.push(["Strict-Transport-Security", STRICT_TRANSPORT_SECURITY]);
  return headers;
}
