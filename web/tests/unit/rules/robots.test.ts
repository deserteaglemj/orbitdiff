import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import { PROTECTED_PREFIXES } from "@/server/auth/paths";

/** A crawler rule matches a path when the path starts with it, as the robots standard defines. */
function blocked(path: string, disallow: readonly string[]): boolean {
  return disallow.some((prefix) => path.startsWith(prefix));
}

describe("robots", () => {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0]! : rules;
  const disallow = [rule.disallow ?? []].flat();

  it("has one rule for every crawler", () => {
    expect(Array.isArray(rules) ? rules : [rules]).toHaveLength(1);
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
  });

  it("keeps crawlers out of exactly the API and the signed-in areas", () => {
    expect(disallow).toEqual(["/api", "/dashboard", "/profiles", "/settings", "/onboarding", "/admin"]);
  });

  it("covers every area the proxy treats as signed-in", () => {
    for (const prefix of PROTECTED_PREFIXES) expect(disallow).toContain(prefix);
  });

  it.each(["/", "/sign-up", "/sign-in", "/legal/terms", "/legal/privacy"])("leaves the public page %s open", (path) => {
    expect(blocked(path, disallow)).toBe(false);
  });

  it.each(["/api/health", "/api/auth/sign-in/email", "/dashboard", "/profiles/abc", "/settings", "/onboarding", "/admin"])(
    "blocks %s",
    (path) => {
      expect(blocked(path, disallow)).toBe(true);
    },
  );

  it("names no sitemap and no host, because none is configured", () => {
    expect(Object.keys(robots()).sort()).toEqual(["rules"]);
  });
});
