import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuth, getAuth } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { mailCapture, rateLimit } from "@/server/db/schema";

import { authRequest, createVerifiedUser, signIn, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

async function statuses(count: number, call: () => Promise<Response>): Promise<number[]> {
  const seen: number[] = [];
  for (let index = 0; index < count; index += 1) seen.push((await call()).status);
  return seen;
}

describe("rate limiting", () => {
  it("is off in the test stage unless a test turns it on", async () => {
    await createVerifiedUser({ email: EMAIL });
    const seen = await statuses(8, () => signIn({ email: EMAIL, password: "wrong-password" }));
    expect(seen).toEqual(Array(8).fill(401));
    expect(await getDb().select().from(rateLimit)).toEqual([]);
  });

  it("returns 429 after repeated bad sign-ins and counts them in the database", async () => {
    await createVerifiedUser({ email: EMAIL });
    const auth = createAuth({ rateLimit: true });
    const seen = await statuses(7, () => signIn({ email: EMAIL, password: "wrong-password", auth }));
    expect(seen).toEqual([401, 401, 401, 401, 401, 429, 429]);
    const limited = await signIn({ email: EMAIL, auth });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("x-retry-after"))).toBeGreaterThan(0);
    const rows = await getDb().select().from(rateLimit);
    expect(rows.some((row) => row.key.endsWith("/sign-in/email") && row.count === 5)).toBe(true);
  });

  it("limits sign-up attempts, including ones the registration gate refuses", async () => {
    const auth = createAuth({ rateLimit: true });
    const seen = await statuses(6, () => signUp({ email: EMAIL, timezone: "Mars/Olympus", auth }));
    expect(seen).toEqual([422, 422, 422, 422, 422, 429]);
  });

  it("keeps separate counters per endpoint", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL });
    const auth = createAuth({ rateLimit: true });
    await statuses(6, () => signIn({ email: EMAIL, password: "wrong-password", auth }));
    expect((await authRequest("/get-session", { cookie, auth })).status).toBe(200);
  });

  it("is on by default in every stage other than test", async () => {
    await createVerifiedUser({ email: EMAIL });
    setTestEnv({ APP_STAGE: "development" });
    const seen = await statuses(6, () => signIn({ email: EMAIL, password: "wrong-password", auth: getAuth() }));
    expect(seen.at(-1)).toBe(429);
  });
});

/** A different client address for every request, the way a caller that controls the header would send it. */
const rotating = (index: number) => ({ "x-forwarded-for": `203.0.113.${index + 1}` });

describe("rate limiting per target address", () => {
  it("stops guesses against one address even when every request claims a different client", async () => {
    await createVerifiedUser({ email: EMAIL });
    const auth = createAuth({ rateLimit: true });
    const seen: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const response = await signIn({ email: EMAIL, password: "wrong-password", headers: rotating(index), auth });
      seen.push(response.status);
    }
    expect(seen).toEqual([...Array(10).fill(401), 429, 429]);

    // The right password is refused as well until the window ends, with the usual header.
    const locked = await signIn({ email: "Atlas@OrbitDiff.test", headers: rotating(50), auth });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(Number(locked.headers.get("x-retry-after"))).toBeLessThanOrEqual(60);
    expect(locked.headers.getSetCookie()).toEqual([]);
  });

  it("keeps a separate counter for every address and never stores the address itself", async () => {
    await createVerifiedUser({ email: EMAIL });
    const auth = createAuth({ rateLimit: true });
    for (let index = 0; index < 11; index += 1) {
      await signIn({ email: EMAIL, password: "wrong-password", headers: rotating(index), auth });
    }
    const other = await signIn({ email: "nova@orbitdiff.test", password: "wrong-password", headers: rotating(60), auth });
    expect(other.status).toBe(401);
    const keys = (await getDb().select().from(rateLimit)).map((row) => row.key);
    expect(keys.filter((key) => key.startsWith("address:"))).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain("atlas");
      expect(key).not.toContain("@");
      expect(key.length).toBeLessThan(80);
    }
  });

  it("opens again when the window has passed", async () => {
    await createVerifiedUser({ email: EMAIL });
    const auth = createAuth({ rateLimit: true });
    for (let index = 0; index < 11; index += 1) {
      await signIn({ email: EMAIL, password: "wrong-password", headers: rotating(index), auth });
    }
    expect((await signIn({ email: EMAIL, headers: rotating(70), auth })).status).toBe(429);
    await getDb().update(rateLimit).set({ lastRequest: Date.now() - 61_000 });
    expect((await signIn({ email: EMAIL, headers: rotating(71), auth })).status).toBe(200);
  });

  it("caps reset mail to one address across clients", async () => {
    await createVerifiedUser({ email: EMAIL });
    await getDb().delete(mailCapture);
    const auth = createAuth({ rateLimit: true });
    const seen: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await authRequest("/request-password-reset", {
        json: { email: EMAIL, redirectTo: "/reset-password" },
        headers: rotating(index),
        auth,
      });
      seen.push(response.status);
    }
    expect(seen).toEqual([200, 200, 200, 429, 429]);
    expect(await getDb().select().from(mailCapture)).toHaveLength(3);
  });

  it("caps registration and resent verification mail to one address across clients", async () => {
    const auth = createAuth({ rateLimit: true });
    const registered: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      registered.push((await signUp({ email: EMAIL, headers: rotating(index), auth })).status);
    }
    expect(registered).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const resent: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await authRequest("/send-verification-email", {
        json: { email: EMAIL },
        headers: rotating(20 + index),
        auth,
      });
      resent.push(response.status);
    }
    expect(resent).toEqual([200, 200, 200, 429]);
    expect(await getDb().select().from(mailCapture)).toHaveLength(8);
  });

  it("counts nothing per address while the limiter is off", async () => {
    await createVerifiedUser({ email: EMAIL });
    const seen = await statuses(12, () => signIn({ email: EMAIL, password: "wrong-password" }));
    expect(seen).toEqual(Array(12).fill(401));
    expect(await getDb().select().from(rateLimit)).toEqual([]);
  });
});

describe("the client address used by the limiter", () => {
  const targets = Array.from({ length: 7 }, (_, index) => `target${index}@orbitdiff.test`);

  it("comes only from the configured header, so a rotated x-forwarded-for changes nothing", async () => {
    setTestEnv({ APP_STAGE: "development", CLIENT_IP_HEADER: "x-real-ip" });
    const seen: number[] = [];
    for (const [index, email] of targets.entries()) {
      const response = await signIn({
        email,
        password: "wrong-password",
        headers: { ...rotating(index), "x-real-ip": "198.51.100.9" },
        auth: getAuth(),
      });
      seen.push(response.status);
    }
    expect(seen).toEqual([401, 401, 401, 401, 401, 429, 429]);
    const keys = (await getDb().select().from(rateLimit)).map((row) => row.key);
    expect(keys).toContain("198.51.100.9|/sign-in/email");
    expect(keys.some((key) => key.startsWith("203.0.113."))).toBe(false);
  });

  it("is the last hop before the trusted proxies when a chain is forwarded", async () => {
    setTestEnv({ APP_STAGE: "development", TRUSTED_PROXIES: "198.51.100.7, 10.0.0.0/8" });
    const response = await signIn({
      email: targets[0]!,
      password: "wrong-password",
      headers: { "x-forwarded-for": "192.0.2.200, 203.0.113.5, 10.1.2.3, 198.51.100.7" },
      auth: getAuth(),
    });
    expect(response.status).toBe(401);
    const keys = (await getDb().select().from(rateLimit)).map((row) => row.key);
    expect(keys).toContain("203.0.113.5|/sign-in/email");
  });
});
