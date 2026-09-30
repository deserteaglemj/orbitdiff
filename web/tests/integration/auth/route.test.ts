import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/auth/[...all]/route";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { rateLimit } from "@/server/db/schema";

import { TEST_PASSWORD } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";
import { latestMail } from "../../helpers/mail";

const BASE = "http://127.0.0.1:3100";

async function errorCode(response: Response): Promise<unknown> {
  return ((await response.json()) as { error?: { code?: unknown } }).error?.code;
}

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.restoreAllMocks();
});
afterAll(closeDb);

describe("/api/auth catch-all route", () => {
  it("serves Better Auth POST endpoints", async () => {
    const response = await callRoute(POST, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      json: {
        email: "atlas@orbitdiff.test",
        name: "Atlas",
        password: TEST_PASSWORD,
        timezone: "UTC",
        acceptedTermsVersion: CONSENT_VERSIONS.terms,
      },
    });
    expect(response.status).toBe(200);
    expect(await latestMail("atlas@orbitdiff.test", "verify_email")).not.toBeNull();
  });

  it("serves Better Auth GET endpoints", async () => {
    const response = await callRoute(GET, { url: "/api/auth/get-session" });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("answers a generic 500 when the configuration is invalid", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setTestEnv({ BETTER_AUTH_SECRET: undefined });
    // callRoute() needs a valid configuration to build the URL, so the request is built by hand.
    const response = await GET(new Request("http://127.0.0.1:3100/api/auth/get-session"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("internal");
    expect(text).not.toContain("BETTER_AUTH_SECRET");
    expect(logged.mock.calls[0]?.join(" ")).toContain("BETTER_AUTH_SECRET");
  });

  it("refuses a body above 16 KiB before Better Auth reads or logs it", async () => {
    const logged = (["error", "warn", "log"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const started = performance.now();
    const response = await callRoute(POST, {
      method: "POST",
      url: "/api/auth/sign-out",
      json: { callbackURL: "a".repeat(80_000) },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "invalid_input", message: "The request body is too large.", details: { maxBytes: 16_384 } },
    });
    expect(performance.now() - started).toBeLessThan(500);
    expect(logged.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });

  it("refuses an oversized body that declares no length", async () => {
    const chunk = new TextEncoder().encode("a".repeat(8_192));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 4) controller.close();
        else controller.enqueue(chunk);
        sent += 1;
      },
    });
    const request = new Request(`${BASE}/api/auth/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request);
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe("invalid_input");
  });

  it("still accepts a body just under the cap", async () => {
    const response = await callRoute(POST, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      json: { email: "atlas@orbitdiff.test", password: TEST_PASSWORD, filler: "a".repeat(15_000) },
    });
    expect(response.status).toBe(401);
  });

  it("answers 404 for paths that are not enabled endpoints and counts nothing for them", async () => {
    setTestEnv({ APP_STAGE: "development" });
    const paths = [
      ...Array.from({ length: 40 }, (_, index) => `/api/auth/junk-${index}`),
      "/api/auth/sign-in/%65mail=1",
      "/api/auth/sign-in/email/",
      `/api/auth/${"p".repeat(6_000)}`,
      "/api/auth/callback/github",
      "/api/auth/reset-password/some-token",
      "/api/auth/delete-user/callback",
      "/api/auth/ok",
      "/api/auth/error",
      "/api/auth",
    ];
    for (const url of paths) {
      const response = await callRoute(GET, { url });
      expect(response.status, url.slice(0, 60)).toBe(404);
      expect(await errorCode(response)).toBe("not_found");
    }
    const posted = await callRoute(POST, { method: "POST", url: "/api/auth/junk", json: {} });
    expect(posted.status).toBe(404);
    expect(await getDb().select().from(rateLimit)).toEqual([]);
  });

  it("answers 404 to the wrong method without counting it", async () => {
    setTestEnv({ APP_STAGE: "development" });
    expect((await callRoute(GET, { url: "/api/auth/sign-in/email" })).status).toBe(404);
    expect((await callRoute(POST, { method: "POST", url: "/api/auth/verify-email", json: {} })).status).toBe(404);
    expect(await getDb().select().from(rateLimit)).toEqual([]);
  });

  it("answers 404 when the request line is longer than any real request", async () => {
    setTestEnv({ APP_STAGE: "development" });
    const response = await callRoute(GET, {
      url: `/api/auth/verify-email?token=x&callbackURL=/${"a".repeat(5_000)}`,
    });
    expect(response.status).toBe(404);
    expect(await getDb().select().from(rateLimit)).toEqual([]);
  });

  it("counts a request to an enabled endpoint once the limiter is on", async () => {
    setTestEnv({ APP_STAGE: "development" });
    expect((await callRoute(GET, { url: "/api/auth/get-session" })).status).toBe(200);
    const rows = await getDb().select().from(rateLimit);
    expect(rows.map((row) => row.key)).toEqual(["127.0.0.1|/get-session"]);
  });
});
