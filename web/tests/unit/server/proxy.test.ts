import { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";
import { PATHNAME_HEADER } from "@/server/auth/paths";
import {
  STATIC_CONTENT_SECURITY_POLICY,
  STATIC_SECURITY_HEADERS,
} from "@/server/auth/security-headers";

import nextConfig from "../../../next.config";

const ORIGIN = "http://localhost:3201";
const SESSION = "better-auth.session_token=opaque.value";

function request(path: string, init: { cookie?: string; headers?: Record<string, string>; origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`${init.origin ?? ORIGIN}${path}`, { headers });
}

/** The request headers the proxy hands on to the page, as Next.js encodes them on the response. */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

function nonceOf(policy: string | null): string | null {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;
}

describe("proxy: security headers", () => {
  it("sets every security header on a public page", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("uses a new nonce for every request and hands the same one to the page", () => {
    const first = proxy(request("/sign-in"));
    const second = proxy(request("/sign-in"));
    const nonce = nonceOf(first.headers.get("content-security-policy"));
    expect(nonce).toBeTruthy();
    expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(nonce);
    expect(forwarded(first, "x-nonce")).toBe(nonce);
    expect(forwarded(first, "content-security-policy")).toBe(first.headers.get("content-security-policy"));
  });

  it("does not allow inline scripts", () => {
    const policy = proxy(request("/")).headers.get("content-security-policy") ?? "";
    const scripts = policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
    expect(scripts).not.toContain("unsafe-inline");
  });

  it("adds strict transport security only when the request came over https", () => {
    expect(proxy(request("/")).headers.has("strict-transport-security")).toBe(false);
    expect(
      proxy(request("/", { origin: "https://web.orbitdiff.test" })).headers.get("strict-transport-security"),
    ).toBe("max-age=63072000; includeSubDomains");
    expect(
      proxy(request("/", { headers: { "x-forwarded-proto": "https" } })).headers.get("strict-transport-security"),
    ).toBe("max-age=63072000; includeSubDomains");
  });

  it("sets the security headers on a redirect as well", () => {
    const response = proxy(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("tells the page which path was requested, replacing anything the client sent", () => {
    const response = proxy(
      request("/dashboard", { cookie: SESSION, headers: { [PATHNAME_HEADER]: "/onboarding", "x-nonce": "forged" } }),
    );
    expect(forwarded(response, PATHNAME_HEADER)).toBe("/dashboard");
    expect(forwarded(response, "x-nonce")).not.toBe("forged");
  });

  it("needs no configuration: it works with no variable set", () => {
    const saved = { ...process.env };
    for (const name of ["APP_STAGE", "APP_BASE_URL", "DATABASE_URL", "BETTER_AUTH_SECRET", "JOBS_TICK_SECRET"]) {
      delete process.env[name];
    }
    try {
      expect(proxy(request("/")).status).toBe(200);
      expect(proxy(request("/settings")).status).toBe(307);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});

describe("proxy: optimistic redirect to sign-in", () => {
  it.each(["/dashboard", "/profiles/abc", "/settings", "/onboarding", "/admin"])(
    "redirects %s to sign-in when there is no session cookie",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin).toBe(ORIGIN);
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("next")).toBe(path);
    },
  );

  it("keeps the query of the page that was asked for", () => {
    const response = proxy(request("/profiles/abc?tab=history"));
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("next")).toBe("/profiles/abc?tab=history");
  });

  it.each(["/dashboard", "/profiles/abc", "/settings", "/onboarding", "/admin"])(
    "lets %s through when a session cookie is present",
    (path) => {
      const response = proxy(request(path, { cookie: SESSION }));
      expect(response.status).toBe(200);
      expect(response.headers.has("location")).toBe(false);
    },
  );

  it("recognizes the secure session cookie", () => {
    const response = proxy(
      request("/dashboard", {
        origin: "https://web.orbitdiff.test",
        cookie: "__Secure-better-auth.session_token=opaque.value",
      }),
    );
    expect(response.status).toBe(200);
  });

  it.each(["/", "/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password", "/legal/terms"])(
    "never redirects the public page %s",
    (path) => {
      expect(proxy(request(path)).status).toBe(200);
    },
  );

  it("always redirects to this site, whatever host the path names", () => {
    const response = proxy(request("/dashboard//evil.example/%2F%2Fevil.example?next=https://evil.example"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/sign-in");
  });
});

describe("proxy: which requests it runs on", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

  it.each(["/", "/sign-in", "/dashboard", "/profiles/abc/history", "/legal/privacy", "/onboarding"])(
    "runs on the page %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each([
    "/api/health",
    "/api/auth/sign-in/email",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/orbitdiff-mark.svg",
    "/favicon.ico",
  ])("does not run on %s, which gets its headers from the static rules", (url) => {
    expect(matches(url)).toBe(false);
  });
});

describe("next.config: headers for every response", () => {
  const respond = (url: string, headers: Record<string, string> = {}) =>
    unstable_getResponseFromNextConfig({ url: `https://web.orbitdiff.test${url}`, nextConfig, headers });

  it.each(["/", "/dashboard", "/api/health", "/_next/static/chunks/main.js", "/orbitdiff-mark.svg"])(
    "sets the fixed security headers on %s",
    async (url) => {
      const response = await respond(url);
      for (const header of STATIC_SECURITY_HEADERS) {
        expect(response.headers.get(header.key), header.key).toBe(header.value);
      }
    },
  );

  it.each(["/api/health", "/api/auth/sign-in/email", "/_next/static/chunks/main.js", "/orbitdiff-mark.svg", "/favicon.ico"])(
    "sets the fixed policy on %s, which the proxy does not see",
    async (url) => {
      expect((await respond(url)).headers.get("content-security-policy")).toBe(STATIC_CONTENT_SECURITY_POLICY);
    },
  );

  it.each(["/", "/sign-in", "/dashboard", "/legal/terms"])(
    "leaves the policy of the page %s to the proxy, so a page never gets two policies",
    async (url) => {
      expect((await respond(url)).headers.has("content-security-policy")).toBe(false);
    },
  );

  it("adds strict transport security only when the request was forwarded as https", async () => {
    expect((await respond("/api/health")).headers.has("strict-transport-security")).toBe(false);
    expect(
      (await respond("/api/health", { "x-forwarded-proto": "https" })).headers.get("strict-transport-security"),
    ).toBe("max-age=63072000; includeSubDomains");
  });

  it("covers every path with either the proxy or the fixed policy", async () => {
    const paths = ["/", "/sign-up", "/settings", "/api/me", "/_next/static/a.css", "/_next/image", "/orbitdiff-mark.svg"];
    for (const url of paths) {
      const byProxy = unstable_doesMiddlewareMatch({ config, nextConfig, url });
      const byRule = (await respond(url)).headers.has("content-security-policy");
      expect(byProxy !== byRule, url).toBe(true);
    }
  });
});
