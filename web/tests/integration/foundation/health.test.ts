import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { closeDb, getDb } from "@/server/db/client";
import { systemState } from "@/server/db/schema";
import { LAST_TICK_STATE_KEY } from "@/server/http/health";

import { createVerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const health = () => callRoute(GET, { url: "/api/health", origin: null });

describe("GET /api/health", () => {
  it("reports stage, commit, database, mail, registration, and last tick without a session", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      stage: "test",
      commit: null,
      database: { ok: true },
      mail: { available: true, mode: "captured" },
      registration: { open: true, reason: null, accessCodeRequired: false },
      lastTick: null,
    });
  });

  it("reports the configured commit and whether an access code is needed", async () => {
    setTestEnv({ APP_COMMIT_SHA: "0a1b2c3", SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    const body = await (await health()).json();
    expect(body.commit).toBe("0a1b2c3");
    expect(body.registration).toEqual({ open: true, reason: null, accessCodeRequired: true });
  });

  it("reports registration closed when mail cannot be delivered", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const body = await (await health()).json();
    expect(body.mail).toEqual({ available: false, mode: "none" });
    expect(body.registration).toEqual({
      open: false,
      reason: "Registration is closed: email delivery is not configured.",
      accessCodeRequired: false,
    });
  });

  it("reports registration paused at user capacity", async () => {
    setTestEnv({ CAPACITY_MAX_USERS: "1" });
    // Only a verified account takes a place.
    await createVerifiedUser({ email: "atlas@orbitdiff.test" });
    const body = await (await health()).json();
    expect(body.registration).toMatchObject({
      open: false,
      reason: "Registration is paused: capacity reached.",
    });
  });

  it("reports only the time of the last tick", async () => {
    await getDb()
      .insert(systemState)
      .values({ key: LAST_TICK_STATE_KEY, value: { at: "2026-09-30T10:00:00.000Z", succeeded: 3 } });
    const body = await (await health()).json();
    expect(body.lastTick).toEqual({ at: "2026-09-30T10:00:00.000Z" });
  });

  it("never returns a configured secret, the database URL, or an admin address", async () => {
    setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1", APP_COMMIT_SHA: "0a1b2c3" });
    const text = await (await health()).text();
    for (const name of [
      "BETTER_AUTH_SECRET",
      "JOBS_TICK_SECRET",
      "MAILBOX_SECRET",
      "DATABASE_URL",
      "SIGNUP_ACCESS_CODE",
      "ADMIN_EMAILS",
    ]) {
      const value = process.env[name];
      expect(value, name).toBeTruthy();
      expect(text, name).not.toContain(value);
    }
    expect(text).not.toMatch(/postgres/i);
  });

  it("answers 503 without details when the database cannot be reached", async () => {
    await closeDb();
    setTestEnv({ DATABASE_URL: "postgres://orbit:orbit@127.0.0.1:1/unreachable" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await health();
      expect(response.status).toBe(503);
      expect(logged).toHaveBeenCalledOnce();
      expect(logged.mock.calls[0]?.join(" ")).toMatch(/^\[health\] /);
      expect(logged.mock.calls[0]?.join(" ")).not.toContain("orbit:orbit");
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        status: "degraded",
        database: { ok: false },
        registration: { open: false },
        lastTick: null,
      });
      expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|unreachable/);
    } finally {
      logged.mockRestore();
      await closeDb();
    }
  });
});
