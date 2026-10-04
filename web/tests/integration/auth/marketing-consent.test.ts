import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import { recordMarketingConsent } from "@/server/services/account";

import { createVerifiedUser, type VerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const NOW = new Date("2026-12-01T12:00:00.000Z");
const BUMPED = "2099-01-01";

type Versions = { terms: string; privacy: string; marketing: string };

/** Run with the server holding other document versions, as after a deploy that changed a text. */
async function withServerVersions<T>(bump: Partial<Versions>, run: () => Promise<T>): Promise<T> {
  const versions = CONSENT_VERSIONS as unknown as Versions;
  const before = { ...versions };
  Object.assign(versions, bump);
  try {
    return await run();
  } finally {
    Object.assign(versions, before);
  }
}

const rowsOf = (userId: string) => getDb().select().from(consentRecord).where(eq(consentRecord.userId, userId));

/** The marketing rows of one user as version:granted:source, sorted. */
async function marketingLog(userId: string): Promise<string[]> {
  return (await rowsOf(userId))
    .filter((row) => row.kind === "marketing")
    .map((row) => `${row.version}:${row.granted}:${row.source}`)
    .sort();
}

async function optedIn(userId: string): Promise<boolean | null> {
  const [row] = await getDb().select({ value: user.marketingOptIn }).from(user).where(eq(user.id, userId));
  return row?.value ?? null;
}

const atlas = (): Promise<VerifiedUser> => createVerifiedUser({ email: "atlas@orbitdiff.test" });

/** The service called with whatever a caller might hand it, typed or not. */
const record = (userId: string, input: unknown) => recordMarketingConsent(userId, input as never, NOW);

/** A grant that the write itself must refuse: `invalid_input` naming `version`, and nothing written. */
async function expectGrantRefused(input: unknown): Promise<AppError> {
  const account = await atlas();
  const before = await rowsOf(account.userId);
  const error = await record(account.userId, input).then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code: "invalid_input", details: { fields: ["version"] } });
  expect(await rowsOf(account.userId)).toEqual(before);
  expect(await optedIn(account.userId)).toBe(false);
  return error as AppError;
}

/**
 * The write gates itself instead of trusting the route: a marketing grant is
 * recorded only when the request names the current version of the product news
 * consent, as a string, compared in full. One probe per state that must not pass.
 */
describe("recordMarketingConsent: a grant must name the current version", () => {
  it("records a grant at the version the request named", async () => {
    const account = await atlas();

    const state = await record(account.userId, { granted: true, version: CONSENT_VERSIONS.marketing });

    expect(state.marketing).toMatchObject({ granted: true, version: CONSENT_VERSIONS.marketing });
    expect(await marketingLog(account.userId)).toEqual([
      `${CONSENT_VERSIONS.marketing}:false:signup`,
      `${CONSENT_VERSIONS.marketing}:true:settings`,
    ]);
    expect(await optedIn(account.userId)).toBe(true);
  });

  it("refuses a grant that names no version", async () => {
    const error = await expectGrantRefused({ granted: true });
    expect(error.message).toContain("version is missing");
  });

  it("refuses the bare boolean of the earlier contract, which names no version", async () => {
    await expectGrantRefused(true);
  });

  it("refuses a grant with an empty version", async () => {
    const error = await expectGrantRefused({ granted: true, version: "" });
    expect(error.message).toContain("version is empty");
  });

  it("refuses a grant with a fabricated version and does not repeat it", async () => {
    const error = await expectGrantRefused({ granted: true, version: "v999-made-up" });
    expect(error.message).toContain("not the current version");
    expect(JSON.stringify([error.message, error.details])).not.toContain("v999-made-up");
  });

  it("refuses a grant with an outdated version", async () => {
    const error = await expectGrantRefused({ granted: true, version: "2020-01-01" });
    expect(error.message).toContain("not the current version");
  });

  it.each([
    ["the boolean true", true],
    ["a number", 20260930],
    ["null", null],
    ["a list", [CONSENT_VERSIONS.marketing]],
  ])("refuses a grant whose version is %s", async (_label, version) => {
    const error = await expectGrantRefused({ granted: true, version });
    expect(error.message).toContain("version must be text");
  });

  it("refuses the current version with a trailing space", async () => {
    await expectGrantRefused({ granted: true, version: `${CONSENT_VERSIONS.marketing} ` });
  });

  it("refuses the earlier version once the text has changed, and never names the new one", async () => {
    const stale = { granted: true, version: CONSENT_VERSIONS.marketing };
    await withServerVersions({ marketing: BUMPED }, async () => {
      const error = await expectGrantRefused(stale);
      expect(JSON.stringify([error.message, error.details])).not.toContain(BUMPED);
    });
  });

  it("does not take the current Terms or Privacy version as the product news version", async () => {
    await withServerVersions({ marketing: BUMPED }, async () => {
      await expectGrantRefused({ granted: true, version: CONSENT_VERSIONS.terms });
    });
  });

  it("refuses a granted value that is not a boolean, even with the current version", async () => {
    const account = await atlas();
    const before = await rowsOf(account.userId);
    for (const granted of ["true", "on", 1, null, undefined]) {
      await expect(record(account.userId, { granted, version: CONSENT_VERSIONS.marketing })).rejects.toMatchObject({
        code: "invalid_input",
        details: { fields: ["granted"] },
      });
    }
    expect(await rowsOf(account.userId)).toEqual(before);
    expect(await optedIn(account.userId)).toBe(false);
  });

  it("refuses a field it does not know, so nothing else can ride along", async () => {
    const account = await atlas();
    const before = await rowsOf(account.userId);
    await expect(
      record(account.userId, { granted: true, version: CONSENT_VERSIONS.marketing, kind: "terms" }),
    ).rejects.toMatchObject({ code: "invalid_input", details: { fields: ["kind"] } });
    expect(await rowsOf(account.userId)).toEqual(before);
  });
});

describe("recordMarketingConsent: a withdrawal needs no version and is never refused for one", () => {
  async function granted(): Promise<VerifiedUser> {
    const account = await atlas();
    await record(account.userId, { granted: true, version: CONSENT_VERSIONS.marketing });
    return account;
  }

  it("records a withdrawal that names no version", async () => {
    const account = await granted();

    const state = await record(account.userId, { granted: false });

    expect(state.marketing).toMatchObject({ granted: false, version: CONSENT_VERSIONS.marketing });
    expect(await optedIn(account.userId)).toBe(false);
  });

  it.each([
    ["an outdated version", "2020-01-01"],
    ["a fabricated version", "v999-made-up"],
    ["an empty version", ""],
    ["a version that is not text", 7],
  ])("records a withdrawal that carries %s, at the version the server holds", async (_label, version) => {
    const account = await granted();

    const state = await record(account.userId, { granted: false, version });

    expect(state.marketing).toMatchObject({ granted: false, version: CONSENT_VERSIONS.marketing });
    expect(await marketingLog(account.userId)).toContain(`${CONSENT_VERSIONS.marketing}:false:settings`);
    expect(await optedIn(account.userId)).toBe(false);
  });

  it("records a withdrawal after the text changed, from a page that never saw the new version", async () => {
    const account = await granted();

    await withServerVersions({ marketing: BUMPED }, async () => {
      const state = await record(account.userId, { granted: false });
      expect(state.marketing?.granted).toBe(false);
    });

    expect(await optedIn(account.userId)).toBe(false);
  });

  it("appends the withdrawal and keeps the earlier grant in the log", async () => {
    const account = await granted();

    await record(account.userId, { granted: false });

    expect(await marketingLog(account.userId)).toEqual([
      `${CONSENT_VERSIONS.marketing}:false:settings`,
      `${CONSENT_VERSIONS.marketing}:false:signup`,
      `${CONSENT_VERSIONS.marketing}:true:settings`,
    ]);
  });
});

/**
 * The log is append-only and shared storage, so a caller must not be able to
 * grow it without bound: a choice that changes nothing writes nothing, and
 * grants are limited per UTC day. A withdrawal is never refused.
 */
describe("recordMarketingConsent: the log grows only when the choice changes", () => {
  const grant = { granted: true, version: CONSENT_VERSIONS.marketing } as const;
  const DAY = 86_400_000;

  it("writes nothing for a withdrawal while product news is already off", async () => {
    const account = await atlas();
    const before = await rowsOf(account.userId);

    for (let index = 0; index < 5; index += 1) {
      const state = await record(account.userId, { granted: false });
      expect(state.marketing).toMatchObject({ granted: false });
    }

    expect(await rowsOf(account.userId)).toEqual(before);
    expect(await optedIn(account.userId)).toBe(false);
  });

  it("writes one row for a grant repeated at the same version", async () => {
    const account = await atlas();

    for (let index = 0; index < 5; index += 1) await record(account.userId, grant);

    expect(await marketingLog(account.userId)).toEqual([
      `${CONSENT_VERSIONS.marketing}:false:signup`,
      `${CONSENT_VERSIONS.marketing}:true:settings`,
    ]);
    expect(await optedIn(account.userId)).toBe(true);
  });

  it(`accepts at most ${LIMITS.marketingGrantsPerUserPerDay} grants a UTC day and never refuses a withdrawal`, async () => {
    const account = await atlas();
    for (let index = 0; index < LIMITS.marketingGrantsPerUserPerDay; index += 1) {
      if (index > 0) await record(account.userId, { granted: false });
      await record(account.userId, grant);
    }
    // The last allowed grant is in force. Turning product news off still works.
    const withdrawn = await record(account.userId, { granted: false });
    expect(withdrawn.marketing).toMatchObject({ granted: false });
    const before = await rowsOf(account.userId);

    const refused = await record(account.userId, grant).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ code: "quota_exhausted", details: { quota: "marketing_grants" } });
    expect(await rowsOf(account.userId)).toEqual(before);
    expect(await optedIn(account.userId)).toBe(false);
    expect(await record(account.userId, { granted: false })).toMatchObject({ marketing: { granted: false } });

    // The next UTC day it can be turned on again.
    const nextDay = await recordMarketingConsent(account.userId, grant, new Date(NOW.getTime() + DAY));
    expect(nextDay.marketing).toMatchObject({ granted: true });
    expect((await rowsOf(account.userId)).filter((row) => row.kind === "marketing")).toHaveLength(
      1 + 2 * LIMITS.marketingGrantsPerUserPerDay + 1,
    );
  });
});
