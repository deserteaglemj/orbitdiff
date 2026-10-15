import type { MetadataRoute } from "next";

/**
 * robots.txt. The public pages (landing, legal, and the account screens) may
 * be crawled. The API and the signed-in areas may not: they hold nothing for a
 * crawler, and every one of them answers a visitor without a login with a
 * redirect or an error anyway.
 *
 * This is a courtesy to crawlers, not access control. The guards in
 * src/server/auth/guards.ts decide who may read what.
 *
 * The signed-in areas are the same list as PROTECTED_PREFIXES in
 * src/server/auth/paths.ts; tests/unit/rules/robots.test.ts keeps the two in step.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api", "/dashboard", "/profiles", "/settings", "/onboarding", "/admin"],
    },
  };
}
