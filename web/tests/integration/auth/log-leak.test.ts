import { inspect } from "node:util";

import { like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/[...all]/route";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { verification } from "@/server/db/schema";

import { authRequest, createVerifiedUser, TEST_PASSWORD } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.restoreAllMocks();
});
afterAll(closeDb);

const EMAIL = "victim@orbitdiff.test";
const LEVELS = ["error", "warn", "log", "info", "debug"] as const;

/** Everything written to the console, rendered the way the console would render it (error fields included). */
function captureConsole(): { text: () => string; calls: () => unknown[][] } {
  const spies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
  const calls = () => spies.flatMap((spy) => spy.mock.calls as unknown[][]);
  return {
    calls,
    text: () =>
      calls()
        .map((args) => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 8 }))).join(" "))
        .join("\n"),
  };
}

async function expectGenericFailure(response: Response): Promise<void> {
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "internal", message: "Something went wrong. Try again shortly." },
  });
}

/** Every console call is one string: no error object, whose fields would be printed in full. */
function expectPlainLines(calls: unknown[][]): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const args of calls) {
    expect(args).toHaveLength(1);
    expect(typeof args[0]).toBe("string");
  }
}

describe("a failing query inside a Better Auth endpoint", () => {
  it("does not log a live reset token when the token lookup fails", async () => {
    await createVerifiedUser({ email: EMAIL });
    await authRequest("/request-password-reset", { json: { email: EMAIL, redirectTo: "/reset-password" } });
    const db = getDb();
    const [pending] = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(like(verification.identifier, "reset-password:%"));
    const token = pending!.identifier.slice("reset-password:".length);
    expect(token.length).toBeGreaterThan(10);

    const logs = captureConsole();
    await db.execute(sql`alter table verification rename column identifier to identifier_off`);
    let response: Response | undefined;
    try {
      response = await callRoute(POST, {
        method: "POST",
        url: "/api/auth/reset-password",
        json: { newPassword: "a-brand-new-password", token },
      });
    } finally {
      await db.execute(sql`alter table verification rename column identifier_off to identifier`);
    }
    expect(logs.text()).not.toContain(token);
    expect(logs.text()).not.toContain("params");
    expectPlainLines(logs.calls());
    await expectGenericFailure(response!);
    // The token is still valid, which is why it must not be readable from a log.
    expect(await db.select().from(verification).where(like(verification.identifier, "reset-password:%"))).toHaveLength(1);
  });

  it("does not log the password hash when the credential insert fails at sign-up", async () => {
    const db = getDb();
    const logs = captureConsole();
    await db.execute(sql`
      create function refuse_account() returns trigger language plpgsql as
      $$ begin raise exception 'credential store is unavailable'; end $$`);
    await db.execute(sql`
      create trigger refuse_account before insert on account
      for each row execute function refuse_account()`);
    let response: Response | undefined;
    try {
      response = await callRoute(POST, {
        method: "POST",
        url: "/api/auth/sign-up/email",
        json: {
          email: EMAIL,
          name: "Victim",
          password: TEST_PASSWORD,
          timezone: "UTC",
          acceptedTermsVersion: CONSENT_VERSIONS.terms,
        },
      });
    } finally {
      await db.execute(sql`drop trigger refuse_account on account`);
      await db.execute(sql`drop function refuse_account()`);
    }
    const text = logs.text();
    // Better Auth stores the password as <hex salt>:<hex key>.
    expect(text).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{32}/);
    expect(text).not.toContain("params");
    expect(text).not.toContain(EMAIL);
    expectPlainLines(logs.calls());
    await expectGenericFailure(response!);
  });

  it("does not log the new token, the client address, or the user agent when the login insert fails", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    const db = getDb();
    const logs = captureConsole();
    await db.execute(sql`
      create function refuse_login() returns trigger language plpgsql as
      $$ begin raise exception 'login store is unavailable'; end $$`);
    await db.execute(sql`
      create trigger refuse_login before insert on session
      for each row execute function refuse_login()`);
    let response: Response | undefined;
    try {
      response = await callRoute(POST, {
        method: "POST",
        url: "/api/auth/sign-in/email",
        json: { email: EMAIL, password: TEST_PASSWORD },
        headers: { "x-forwarded-for": "203.0.113.77", "user-agent": "ProbeAgent/1.0" },
      });
    } finally {
      await db.execute(sql`drop trigger refuse_login on session`);
      await db.execute(sql`drop function refuse_login()`);
    }
    const text = logs.text();
    expect(text).not.toContain("203.0.113.77");
    expect(text).not.toContain("ProbeAgent");
    expect(text).not.toContain(created.userId);
    expect(text).not.toContain("params");
    expectPlainLines(logs.calls());
    await expectGenericFailure(response!);
  });

  it("does not log the address when the user lookup fails at sign-in", async () => {
    await createVerifiedUser({ email: EMAIL });
    const db = getDb();
    const logs = captureConsole();
    await db.execute(sql`alter table "user" rename column email to email_off`);
    let response: Response | undefined;
    try {
      response = await callRoute(POST, {
        method: "POST",
        url: "/api/auth/sign-in/email",
        json: { email: EMAIL, password: TEST_PASSWORD },
      });
    } finally {
      await db.execute(sql`alter table "user" rename column email_off to email`);
    }
    const text = logs.text();
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("victim");
    expect(text).not.toContain("params");
    expectPlainLines(logs.calls());
    await expectGenericFailure(response!);
  });
});
