import type { NextConfig } from "next";

/*
 * Security headers for every response.
 *
 * Pages get their Content-Security-Policy from src/proxy.ts, because it carries
 * a nonce that is new for each request. Everything the proxy does not run on
 * (API routes, the build output, the image optimizer, a file name at the root
 * as files from public/ are served) gets the fixed policy below: nothing may
 * load or run, nothing may frame it. A path that only resembles one of those,
 * such as /profiles/abc.png or /_next/staticfoo, is a page and belongs to the
 * proxy.
 *
 * The values repeat src/server/auth/security-headers.ts, since this file cannot
 * import application modules. tests/unit/server/proxy.test.ts compares the two
 * and checks that every path is covered by exactly one policy.
 */
const FIXED_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const FIXED_POLICY = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  },
];

const nextConfig: NextConfig = {
  // The header names this app sends are its own. Do not advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: FIXED_HEADERS },
      {
        // Only for a request that reached the platform over https.
        source: "/(.*)",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }],
      },
      // The four sets below are exactly the paths the proxy matcher leaves out. Keep the two in step.
      { source: "/api/:path*", headers: FIXED_POLICY },
      { source: "/_next/static/:path+", headers: FIXED_POLICY },
      { source: "/_next/image", headers: FIXED_POLICY },
      // A file name at the root, one path segment, as files from public/ are served.
      { source: "/:file([^/]+\\.(?:svg|png|ico|txt|xml))", headers: FIXED_POLICY },
    ];
  },
};

export default nextConfig;
