import { describe, expect, it } from "vitest";

import { isSitePath, SITE_PATH_MAX, withErrorCode } from "@/server/auth/paths";

const BASE = "https://app.orbitdiff.test";

/** Where a browser ends up when it follows `location` from a page of the app. */
function originOf(location: string): string {
  return new URL(location, `${BASE}/api/auth/verify-email`).origin;
}

/** Values that pass a "one leading slash" test and still leave the site once a browser resolves them. */
const LEAVES_THE_SITE: Array<[label: string, value: string]> = [
  ["a dot segment before a double slash", "/.//evil.example"],
  ["a dot segment, then a path on the other host", "/.//evil.example/sign-in"],
  ["a parent segment before a double slash", "/..//evil.example"],
  ["a parent segment with a query", "/..//evil.example/x?y=1"],
  ["a segment that is climbed out of", "/a/..//evil.example"],
  ["an encoded dot segment", "/%2e//evil.example"],
  ["an encoded dot segment in capitals", "/%2E//evil.example"],
  ["an encoded parent segment", "/%2e%2e//evil.example"],
  ["a half encoded parent segment", "/.%2e//evil.example"],
  ["a dot segment with a fragment", "/.//evil.example#frag"],
  ["two dot segments in a row", "/././/evil.example"],
];

describe("isSitePath", () => {
  it.each([
    ["/"],
    ["/sign-in"],
    ["/verify-email?step=opened"],
    ["/reset-password?from=settings#form"],
    ["/a/../sign-in"],
    ["/profiles/3f2a//history"],
    ["/api/account/export"],
  ])("accepts the site path %s", (value) => {
    expect(isSitePath(value)).toBe(true);
  });

  it.each(LEAVES_THE_SITE)("refuses %s", (_label, value) => {
    expect(isSitePath(value)).toBe(false);
  });

  it.each([
    ["a full URL", "https://evil.example/sign-in"],
    ["a protocol-relative URL", "//evil.example/sign-in"],
    ["a backslash host", "/\\evil.example"],
    ["a path without a leading slash", "sign-in"],
    ["an empty string", ""],
    ["a space", "/sign in"],
    ["a tab that a browser would drop", "/\t/evil.example"],
    ["a line break", "/sign-in\n//evil.example"],
    ["a character outside ASCII", "/sign-în"],
  ])("refuses %s", (_label, value) => {
    expect(isSitePath(value)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 7],
    ["a list", ["/sign-in"]],
    ["an object", { path: "/sign-in" }],
  ])("refuses %s", (_label, value) => {
    expect(isSitePath(value)).toBe(false);
  });

  it("accepts a path of exactly the longest length and refuses one character more", () => {
    expect(SITE_PATH_MAX).toBe(512);
    expect(isSitePath(`/${"a".repeat(SITE_PATH_MAX - 1)}`)).toBe(true);
    expect(isSitePath(`/${"a".repeat(SITE_PATH_MAX)}`)).toBe(false);
  });
});

describe("withErrorCode", () => {
  it("adds the error to a plain path", () => {
    expect(withErrorCode("/sign-in", "INVALID_TOKEN")).toBe("/sign-in?error=INVALID_TOKEN");
  });

  it("keeps the query and the fragment of the path", () => {
    expect(withErrorCode("/verify-email?step=opened#top", "INVALID_TOKEN")).toBe(
      "/verify-email?step=opened&error=INVALID_TOKEN#top",
    );
  });

  it("replaces an error the path already carries", () => {
    expect(withErrorCode("/sign-in?error=OLD", "USER_NOT_FOUND")).toBe("/sign-in?error=USER_NOT_FOUND");
  });

  it.each(LEAVES_THE_SITE)("never returns another host for %s", (_label, value) => {
    const location = withErrorCode(value, "INVALID_TOKEN");
    expect(location).toBe("/?error=INVALID_TOKEN");
    expect(originOf(location)).toBe(BASE);
  });

  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["a full URL", "https://evil.example/"],
    ["a backslash host", "/\\evil.example"],
    ["a value that is not text", 7],
    ["a missing value", undefined],
  ])("falls back to the home page for %s", (_label, value) => {
    const location = withErrorCode(value, "INVALID_TOKEN");
    expect(location).toBe("/?error=INVALID_TOKEN");
    expect(originOf(location)).toBe(BASE);
  });

  it("never returns a value that starts with two slashes", () => {
    for (const [, value] of LEAVES_THE_SITE) {
      expect(withErrorCode(value, "INVALID_TOKEN").startsWith("//")).toBe(false);
    }
  });
});
