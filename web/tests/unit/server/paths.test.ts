import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  afterSignInPath,
  hasSessionCookie,
  isProtectedPath,
  NONCE_HEADER,
  PATHNAME_HEADER,
  PROTECTED_PREFIXES,
  requestedPathname,
  safeNextPath,
  signInPath,
  signInRedirect,
} from "@/server/auth/paths";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/profiles/3f2a?tab=history", "/profiles/3f2a?tab=history"],
    ["/settings#delete", "/settings#delete"],
    ["/", "/"],
    ["/onboarding?step=2&from=mail", "/onboarding?step=2&from=mail"],
  ])("keeps the site path %s", (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it.each([
    ["a full URL", "https://evil.example/dashboard"],
    ["a protocol-relative URL", "//evil.example/dashboard"],
    ["a backslash host", "/\\evil.example"],
    ["a backslash later in the path", "/dashboard\\..\\evil"],
    ["a path without a leading slash", "dashboard"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,hello"],
    ["an empty string", ""],
    ["a space", "/dash board"],
    ["a tab that a browser would drop", "/\t/evil.example"],
    ["a line break", "/dashboard\n//evil.example"],
    ["a character outside ASCII", "/däshboard"],
    ["dot segments that resolve to a protocol-relative URL", "/.//evil.example"],
    ["dot segments that climb to a protocol-relative URL", "/a/..//evil.example"],
    ["an API route", "/api/account/export"],
    ["the API root", "/api"],
  ])("refuses %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 7],
    ["a list", ["/dashboard"]],
    ["an object", { path: "/dashboard" }],
  ])("refuses %s", (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("refuses a path longer than 512 characters and accepts one of exactly 512", () => {
    expect(safeNextPath(`/${"a".repeat(511)}`)).toBe(`/${"a".repeat(511)}`);
    expect(safeNextPath(`/${"a".repeat(512)}`)).toBeNull();
  });

  it("returns the path with dot segments resolved", () => {
    expect(safeNextPath("/profiles/../settings")).toBe("/settings");
  });

  it("keeps an encoded slash encoded, so it stays a path on this site", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });
});

describe("isProtectedPath", () => {
  it("lists the five signed-in areas", () => {
    expect([...PROTECTED_PREFIXES]).toEqual(["/dashboard", "/profiles", "/settings", "/onboarding", "/admin"]);
  });

  it.each(["/dashboard", "/dashboard/", "/profiles/abc/history", "/settings", "/onboarding", "/admin", "/admin/users"])(
    "is true for %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(true);
    },
  );

  it.each(["/", "/sign-in", "/sign-up", "/legal/terms", "/dashboards", "/administrator", "/settings-help", "/api/profiles"])(
    "is false for %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false);
    },
  );
});

describe("hasSessionCookie", () => {
  it("recognizes the session cookie with and without the secure prefix", () => {
    expect(hasSessionCookie(["better-auth.session_token"])).toBe(true);
    expect(hasSessionCookie(["theme", "__Secure-better-auth.session_token"])).toBe(true);
  });

  it("is false without it", () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(["better-auth.mailbox_proof", "session_token", "better-auth.session_token.extra"])).toBe(
      false,
    );
  });
});

describe("signInRedirect", () => {
  it("sends a visitor without a session cookie to sign-in, remembering where they were going", () => {
    expect(signInRedirect({ pathname: "/dashboard", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Fdashboard",
    );
    expect(signInRedirect({ pathname: "/profiles/abc", search: "?tab=history", hasSession: false })).toBe(
      "/sign-in?next=%2Fprofiles%2Fabc%3Ftab%3Dhistory",
    );
  });

  it.each(["/dashboard", "/profiles/abc", "/settings", "/onboarding", "/admin"])(
    "lets %s through when a session cookie is present",
    (pathname) => {
      expect(signInRedirect({ pathname, search: "", hasSession: true })).toBeNull();
    },
  );

  it.each(["/", "/sign-in", "/sign-up", "/verify-email", "/legal/privacy", "/reset-password"])(
    "never redirects the public page %s",
    (pathname) => {
      expect(signInRedirect({ pathname, search: "", hasSession: false })).toBeNull();
    },
  );

  it("drops a destination that is not a safe site path instead of carrying it along", () => {
    expect(signInRedirect({ pathname: "/dashboard\\evil", search: "", hasSession: false })).toBeNull();
    expect(signInRedirect({ pathname: "/settings", search: "?q=ä", hasSession: false })).toBe("/sign-in");
    expect(signInRedirect({ pathname: "/settings", search: `?q=${"a".repeat(600)}`, hasSession: false })).toBe(
      "/sign-in",
    );
  });
});

describe("signInPath", () => {
  it("adds a safe destination and leaves out an unsafe one", () => {
    expect(signInPath("/settings")).toBe("/sign-in?next=%2Fsettings");
    expect(signInPath("https://evil.example")).toBe("/sign-in");
    expect(signInPath(null)).toBe("/sign-in");
  });

  it("does not point back at the sign-in page itself", () => {
    expect(signInPath("/sign-in?next=%2Fdashboard")).toBe("/sign-in");
  });
});

describe("afterSignInPath", () => {
  it("sends a user who is not onboarded to onboarding, whatever was asked for", () => {
    expect(afterSignInPath({ onboarded: false, next: "/settings" })).toBe("/onboarding");
    expect(afterSignInPath({ onboarded: false, next: null })).toBe("/onboarding");
  });

  it("sends an onboarded user to the safe destination", () => {
    expect(afterSignInPath({ onboarded: true, next: "/profiles/abc?tab=history" })).toBe("/profiles/abc?tab=history");
  });

  it("falls back to the dashboard without a destination or with an unsafe one", () => {
    expect(afterSignInPath({ onboarded: true, next: null })).toBe("/dashboard");
    expect(afterSignInPath({ onboarded: true, next: "//evil.example" })).toBe("/dashboard");
    expect(afterSignInPath({ onboarded: true, next: "https://evil.example/dashboard" })).toBe("/dashboard");
    expect(afterSignInPath({ onboarded: true, next: "/\\evil.example" })).toBe("/dashboard");
  });

  it("does not send a signed-in user back to a signed-out screen", () => {
    for (const next of ["/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password?token=abc"]) {
      expect(afterSignInPath({ onboarded: true, next })).toBe("/dashboard");
    }
  });
});

describe("requestedPathname: the path header counts only on a request that came through the proxy", () => {
  const NONCE = "bm9uY2UtZm9yLWEtdGVzdA==";
  const policy = (nonce: string) => `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  /** The three request headers the proxy sets together. */
  const throughProxy = (pathname: string) =>
    new Headers({ [PATHNAME_HEADER]: pathname, [NONCE_HEADER]: NONCE, "content-security-policy": policy(NONCE) });

  it("returns the path the proxy reported", () => {
    expect(requestedPathname(throughProxy("/onboarding"))).toBe("/onboarding");
    expect(requestedPathname(throughProxy("/profiles/abc"))).toBe("/profiles/abc");
  });

  it("ignores a path header on a request that carries no nonce: the proxy did not run on it", () => {
    expect(requestedPathname(new Headers({ [PATHNAME_HEADER]: "/onboarding" }))).toBeNull();
  });

  it("ignores a path header with an empty nonce", () => {
    const headers = throughProxy("/onboarding");
    headers.set(NONCE_HEADER, "");
    expect(requestedPathname(headers)).toBeNull();
  });

  it("ignores a path header with a nonce but without the policy the proxy sets beside it", () => {
    expect(requestedPathname(new Headers({ [PATHNAME_HEADER]: "/onboarding", [NONCE_HEADER]: NONCE }))).toBeNull();
  });

  it("ignores a path header whose policy names another nonce", () => {
    const headers = throughProxy("/onboarding");
    headers.set("content-security-policy", policy("c29tZS1vdGhlci1ub25jZQ=="));
    expect(requestedPathname(headers)).toBeNull();
  });

  it("returns null when the proxy reported no path", () => {
    const headers = throughProxy("/onboarding");
    headers.delete(PATHNAME_HEADER);
    expect(requestedPathname(headers)).toBeNull();
  });

  it("names the nonce header the Next.js guide reads", () => {
    expect(NONCE_HEADER).toBe("x-nonce");
  });
});

describe("the signed-in layout", () => {
  it("reads the path through requestedPathname, never straight from the header", () => {
    const layout = readFileSync(path.resolve(import.meta.dirname, "../../../src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain("requestedPathname(requestHeaders)");
    expect(layout).not.toContain("PATHNAME_HEADER");
  });
});
