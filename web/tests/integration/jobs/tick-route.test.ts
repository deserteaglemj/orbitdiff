import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/jobs/tick/route";
import { closeDb, getDb } from "@/server/db/client";
import { systemState } from "@/server/db/schema";
import { getHealth, LAST_TICK_STATE_KEY } from "@/server/http/health";

import { callRoute, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { activityOf, addSnapshot, ownerWithProfile, queueDerive } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const secret = () => process.env.JOBS_TICK_SECRET as string;
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

const tick = (headers: Record<string, string> = {}, options: { method?: string; cookie?: string; origin?: string | null } = {}) =>
  callRoute(options.method === "GET" ? GET : POST, {
    url: "/api/jobs/tick",
    method: options.method ?? "POST",
    origin: options.origin === undefined ? null : options.origin,
    cookie: options.cookie,
    headers,
  });

async function lastTick(): Promise<unknown> {
  const [row] = await getDb().select().from(systemState).where(eq(systemState.key, LAST_TICK_STATE_KEY));
  return row?.value;
}

async function expectNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "not_found", message: "Not found." } });
  expect(await lastTick()).toBeUndefined();
}

describe("the batch endpoint", () => {
  it("answers 404 without the authorization header", async () => {
    await expectNotFound(await tick());
    await expectNotFound(await tick({}, { method: "GET" }));
  });

  it("answers 404 for a wrong secret", async () => {
    await expectNotFound(await tick(bearer(`${"wrong-".repeat(6)}value`)));
  });

  it("answers 404 for a secret that is a prefix of the right one", async () => {
    await expectNotFound(await tick(bearer(secret().slice(0, -1))));
  });

  it("answers 404 for the right secret with one more character", async () => {
    await expectNotFound(await tick(bearer(`${secret()}x`)));
  });

  it("answers 404 for the right secret under another scheme", async () => {
    await expectNotFound(await tick({ authorization: `Basic ${secret()}` }));
  });

  it("answers 404 for a signed-in user without the secret", async () => {
    const owner = await ownerWithProfile("owner@orbitdiff.test", "atlas_studio");

    const response = await tick({}, { cookie: owner.cookie, origin: process.env.APP_BASE_URL });

    await expectNotFound(response);
  });

  it("runs the tick for the right secret and returns counts and flags only", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: ["pixel_forge"] });
    await queueDerive(owner, new Date(Date.now() - 1000));

    const response = await tick(bearer(secret()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    const { at, ...counts } = body;
    expect(Object.keys(body).sort()).toEqual(
      [
        "at",
        "cancelled",
        "claimed",
        "cleaned",
        "durationMs",
        "enqueued",
        "failed",
        "pausedForCapacity",
        "recovered",
        "remaining",
        "retried",
        "succeeded",
      ].sort(),
    );
    expect(new Date(at as string).toISOString()).toBe(at);
    for (const value of Object.values(counts)) expect(["number", "boolean"]).toContain(typeof value);
    expect(body).toMatchObject({ claimed: 1, succeeded: 1, pausedForCapacity: false });
    for (const secretValue of [owner.userId, owner.profileId, "atlas", "nova_labs", "pixel_forge", "orbitdiff.test"]) {
      expect(text).not.toContain(secretValue);
    }
    expect(await activityOf(owner.profileId, "import_processed")).toHaveLength(1);
    expect(await lastTick()).toEqual(body);
  });

  it("answers 404 on a deployment with no batch secret configured", async () => {
    const headers = bearer(secret());
    await getDb().select().from(systemState);
    const url = `${process.env.APP_BASE_URL}/api/jobs/tick`;
    setTestEnv({ JOBS_TICK_SECRET: undefined });

    // The route is called directly: the test helper itself needs a valid configuration.
    await expectNotFound(await POST(new Request(url, { method: "POST", headers }), {}));
    await expectNotFound(await POST(new Request(url, { method: "POST", headers: { authorization: "Bearer " } }), {}));
  });

  it("needs no Origin header and ignores a foreign one", async () => {
    expect((await tick(bearer(secret()), { origin: null })).status).toBe(200);
    expect((await tick(bearer(secret()), { origin: "https://elsewhere.example" })).status).toBe(200);
  });

  it("accepts GET for a scheduler that can only GET", async () => {
    const response = await tick(bearer(secret()), { method: "GET" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { at: string };
    expect((await getHealth()).lastTick).toEqual({ at: body.at });
  });
});
