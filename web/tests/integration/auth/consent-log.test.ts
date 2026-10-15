import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord } from "@/server/db/schema";
import { appendConsent } from "@/server/services/consent";

import { createVerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const NOW = new Date("2026-12-01T12:00:00.000Z");

/** The marketing rows of one user as version:granted:source, oldest first. */
async function marketingLog(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select()
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, "marketing")))
    .orderBy(consentRecord.recordedAt);
  return rows.map((row) => `${row.version}:${row.granted}:${row.source}`);
}

/**
 * The contract of every function that writes tenant rows: the user id comes
 * first, and the executor is the last, optional argument.
 */
describe("appendConsent takes the user id first", () => {
  it("writes a row for the named user without being handed an executor", async () => {
    const atlas = await createVerifiedUser({ email: "atlas@orbitdiff.test" });

    await appendConsent(atlas.userId, "marketing", CONSENT_VERSIONS.marketing, true, "settings", NOW);

    expect(await marketingLog(atlas.userId)).toEqual([
      `${CONSENT_VERSIONS.marketing}:false:signup`,
      `${CONSENT_VERSIONS.marketing}:true:settings`,
    ]);
  });

  it("leaves every other user's log alone", async () => {
    const atlas = await createVerifiedUser({ email: "atlas@orbitdiff.test" });
    const nova = await createVerifiedUser({ email: "nova@orbitdiff.test" });
    const before = await marketingLog(nova.userId);

    await appendConsent(atlas.userId, "marketing", CONSENT_VERSIONS.marketing, true, "settings", NOW);

    expect(await marketingLog(nova.userId)).toEqual(before);
  });

  it("writes through the caller's transaction when one is passed last", async () => {
    const atlas = await createVerifiedUser({ email: "atlas@orbitdiff.test" });
    const before = await marketingLog(atlas.userId);

    await expect(
      getDb().transaction(async (tx) => {
        await appendConsent(atlas.userId, "marketing", CONSENT_VERSIONS.marketing, true, "settings", NOW, tx);
        throw new Error("rolled back on purpose");
      }),
    ).rejects.toThrow("rolled back on purpose");

    expect(await marketingLog(atlas.userId)).toEqual(before);
  });
});
