import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as health } from "@/app/api/health/route";
import { handleAuthRequest } from "@/server/auth/handler";
import { readPublicRegistration } from "@/server/auth/public-state";
import { getRegistrationState } from "@/server/auth/registration";
import { closeDb, getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const ORIGIN = "http://127.0.0.1:3100";
const STORAGE = "Registration is closed: storage is not configured.";

/** The helpers need a working configuration to build a URL, so these requests are built by hand. */
function getHealth(): Promise<Response> {
  return health(new Request(`${ORIGIN}/api/health`), {});
}

function postSignUp(): Promise<Response> {
  return handleAuthRequest(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        email: "atlas@orbitdiff.test",
        name: "Atlas",
        password: "orbit-test-pw-1",
        timezone: "UTC",
        acceptedTermsVersion: "2026-09-30",
      }),
    }),
  );
}

describe("GET /api/health on a deployment that is not configured", () => {
  it("answers 503 with the names of the missing variables instead of throwing", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    const response = await getHealth();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unconfigured", missing: ["DATABASE_URL"] });
  });

  it("lists every missing or invalid variable by name and leaks no value", async () => {
    const authValue = process.env.BETTER_AUTH_SECRET ?? "";
    setTestEnv({ DATABASE_URL: "mysql://orbit:hunter2@db/app", JOBS_TICK_SECRET: undefined, APP_STAGE: "prod-ish" });
    const response = await getHealth();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: "unconfigured",
      missing: ["APP_STAGE", "DATABASE_URL", "JOBS_TICK_SECRET"],
    });
    for (const value of ["hunter2", "mysql", "prod-ish", authValue]) expect(text).not.toContain(value);
  });

  it("writes no error line for it: an unconfigured deployment is a known state", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await getHealth();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("answers normally again once the configuration is complete", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    expect((await getHealth()).status).toBe(503);
    restoreTestEnv();
    const response = await getHealth();
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});

describe("readPublicRegistration: what the account screens show", () => {
  it("is open, with captured mail, on a configured deployment with a named operator", async () => {
    expect(await readPublicRegistration()).toEqual({
      configured: true,
      open: true,
      reason: null,
      accessCodeRequired: false,
      mailCaptured: true,
    });
  });

  it("is closed for storage when the database URL is missing, without throwing", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    expect(await readPublicRegistration()).toEqual({
      configured: false,
      open: false,
      reason: STORAGE,
      accessCodeRequired: false,
      mailCaptured: false,
    });
  });

  it("is closed when another required variable is missing", async () => {
    setTestEnv({ BETTER_AUTH_SECRET: undefined });
    expect(await readPublicRegistration()).toMatchObject({
      configured: false,
      open: false,
      reason: "Registration is closed: this deployment is not fully configured.",
    });
  });

  it("gives the same answer as the sign-up gate when no operator is named", async () => {
    setTestEnv({ OPERATOR_NAME: undefined });
    const gate = await getRegistrationState();
    expect(gate.open).toBe(false);
    expect(await readPublicRegistration()).toMatchObject({ open: gate.open, reason: gate.reason });
  });

  it("gives the same answer as the sign-up gate when mail cannot be delivered", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const gate = await getRegistrationState();
    expect(await readPublicRegistration()).toEqual({
      configured: true,
      open: false,
      reason: gate.reason,
      accessCodeRequired: false,
      mailCaptured: false,
    });
  });

  it("says when an access code is needed", async () => {
    setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    expect(await readPublicRegistration()).toMatchObject({ open: true, accessCodeRequired: true });
  });

  it("is closed, without throwing, when the database cannot be reached", async () => {
    await closeDb();
    setTestEnv({ DATABASE_URL: "postgres://orbit:orbit@127.0.0.1:1/unreachable" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await readPublicRegistration()).toMatchObject({
        open: false,
        reason: "Registration is unavailable: the service cannot reach its database.",
      });
    } finally {
      logged.mockRestore();
      await closeDb();
    }
  });
});

describe("the auth endpoints on a deployment that is not configured", () => {
  // Regression probes: the guarded entry point already answers the generic 500
  // (see route.test.ts) and logs the variable name for the operator.
  it("refuse sign-up with a server error, create nothing, and do not throw", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await postSignUp();
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "internal" } });
      expect(logged.mock.calls[0]?.join(" ")).toContain("DATABASE_URL");
    } finally {
      logged.mockRestore();
    }
    restoreTestEnv();
    expect(await getDb().select({ id: user.id }).from(user)).toEqual([]);
  });

  it("leak no configured value and no variable name in that answer", async () => {
    setTestEnv({ DATABASE_URL: "mysql://orbit:hunter2@db/app" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const text = await (await postSignUp()).text();
      for (const value of ["hunter2", "mysql", "DATABASE_URL"]) expect(text).not.toContain(value);
      expect(logged.mock.calls.flat().join(" ")).not.toContain("hunter2");
    } finally {
      logged.mockRestore();
    }
  });
});
