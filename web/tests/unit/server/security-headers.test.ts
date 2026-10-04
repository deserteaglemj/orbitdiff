import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createNonce,
  securityHeaders,
  STATIC_CONTENT_SECURITY_POLICY,
  STATIC_SECURITY_HEADERS,
} from "@/server/auth/security-headers";

const NONCE = "bm9uY2UtZm9yLXRlc3Q=";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name as string, values];
      }),
  );
}

function headerMap(entries: ReadonlyArray<readonly [string, string]>): Map<string, string> {
  return new Map(entries.map(([name, value]) => [name.toLowerCase(), value]));
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy({ nonce: NONCE, development: false, https: true }));
  const development = directives(contentSecurityPolicy({ nonce: NONCE, development: true, https: false }));

  it("allows scripts only from this site and by the nonce of this response", () => {
    expect(production.get("script-src")).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it("never allows inline scripts, in production or in development", () => {
    for (const policy of [production, development]) {
      expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
      expect(policy.get("default-src")).not.toContain("'unsafe-inline'");
    }
  });

  it("allows eval only in development, where the React tooling needs it", () => {
    expect(production.get("script-src")).not.toContain("'unsafe-eval'");
    expect(development.get("script-src")).toContain("'unsafe-eval'");
  });

  it("allows styles by nonce in production and inline styles only in development", () => {
    expect(production.get("style-src")).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(development.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("names no external origin in any directive", () => {
    for (const policy of [production, development]) {
      for (const [name, values] of policy) {
        for (const value of values) {
          expect(value, name).not.toMatch(/^https?:|^wss?:|\*|\.[a-z]{2,}/i);
        }
      }
    }
  });

  it("defaults to this site and forbids plugins, framing, foreign bases, and foreign form targets", () => {
    expect(production.get("default-src")).toEqual(["'self'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.get("connect-src")).toEqual(["'self'"]);
    expect(production.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(production.get("font-src")).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only when the page itself was served over https", () => {
    expect(production.has("upgrade-insecure-requests")).toBe(true);
    expect(development.has("upgrade-insecure-requests")).toBe(false);
  });

  it("is a single line", () => {
    expect(contentSecurityPolicy({ nonce: NONCE, development: false, https: true })).not.toMatch(/[\r\n]/);
  });

  it("refuses a nonce that could end the directive or add a source", () => {
    for (const nonce of ["", "abc def", "abc'; script-src *", "abc;def", "a\nb"]) {
      expect(() => contentSecurityPolicy({ nonce, development: false, https: true })).toThrow("nonce");
    }
  });
});

describe("securityHeaders", () => {
  const https = headerMap(securityHeaders({ nonce: NONCE, development: false, https: true }));
  const http = headerMap(securityHeaders({ nonce: NONCE, development: true, https: false }));

  it("carries the content security policy with the nonce", () => {
    expect(https.get("content-security-policy")).toBe(
      contentSecurityPolicy({ nonce: NONCE, development: false, https: true }),
    );
  });

  it("forbids content type sniffing", () => {
    expect(https.get("x-content-type-options")).toBe("nosniff");
  });

  it("forbids framing", () => {
    expect(https.get("x-frame-options")).toBe("DENY");
  });

  it("limits the referrer across origins", () => {
    expect(https.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies camera, microphone, and geolocation", () => {
    expect(https.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("sends strict transport security only for an https request", () => {
    expect(https.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
    expect(http.has("strict-transport-security")).toBe(false);
  });

  it("sends the other headers for an http request as well", () => {
    for (const name of [
      "content-security-policy",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "permissions-policy",
    ]) {
      expect(http.has(name), name).toBe(true);
    }
  });
});

describe("static headers for responses the proxy does not see", () => {
  it("are the same fixed headers, without a nonce", () => {
    const fixed = headerMap(STATIC_SECURITY_HEADERS.map((header) => [header.key, header.value] as const));
    expect(fixed.get("x-content-type-options")).toBe("nosniff");
    expect(fixed.get("x-frame-options")).toBe("DENY");
    expect(fixed.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(fixed.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(fixed.has("content-security-policy")).toBe(false);
  });

  it("use a policy that allows nothing to load or run and forbids framing", () => {
    const policy = directives(STATIC_CONTENT_SECURITY_POLICY);
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'none'"]);
    expect(STATIC_CONTENT_SECURITY_POLICY).not.toContain("unsafe");
  });
});

describe("createNonce", () => {
  it("returns a value that fits in a policy and differs on every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(seen.size).toBe(50);
    for (const nonce of seen) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/_-]{16,}={0,2}$/);
      expect(() => contentSecurityPolicy({ nonce, development: false, https: true })).not.toThrow();
    }
  });
});
