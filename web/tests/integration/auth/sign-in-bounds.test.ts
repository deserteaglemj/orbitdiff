import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as meGET } from "@/app/api/me/route";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { session } from "@/server/db/schema";

import { callRoute, cookieHeader, createVerifiedUser, resetDatabase, restoreTestEnv, signIn } from "../../helpers";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

const sessionsOf = (userId: string) =>
  getDb().select({ id: session.id, userAgent: session.userAgent }).from(session).where(eq(session.userId, userId));

/**
 * Every sign-in stores a session row. Without a bound, one account could add
 * rows of any size for ever and fill the shared database, which pauses imports
 * for everyone.
 */
describe("sessions are bounded", () => {
  it(`keeps at most ${LIMITS.sessionUserAgentChars} characters of the user agent`, async () => {
    const account = await createVerifiedUser({ email: EMAIL });
    const response = await signIn({ email: EMAIL, headers: { "user-agent": `Browser/${"x".repeat(8_000)}` } });
    expect(response.status).toBe(200);

    const rows = await sessionsOf(account.userId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect((row.userAgent ?? "").length).toBeLessThanOrEqual(LIMITS.sessionUserAgentChars);
    expect(rows.map((row) => row.userAgent)).toContain(`Browser/${"x".repeat(LIMITS.sessionUserAgentChars - 8)}`);
  });

  it(`keeps at most ${LIMITS.sessionsPerUser} sessions per account and ends the oldest`, async () => {
    const account = await createVerifiedUser({ email: EMAIL });
    let newest = "";
    for (let index = 0; index < LIMITS.sessionsPerUser + 5; index += 1) {
      const response = await signIn({ email: EMAIL });
      expect(response.status).toBe(200);
      newest = cookieHeader(response);
    }

    expect(await sessionsOf(account.userId)).toHaveLength(LIMITS.sessionsPerUser);
    expect((await callRoute(meGET, { url: "/api/me", cookie: newest })).status).toBe(200);
    // The first sign-in is the oldest session, so it is the one that ended.
    expect((await callRoute(meGET, { url: "/api/me", cookie: account.cookie })).status).toBe(401);
  });
});
