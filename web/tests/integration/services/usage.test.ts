import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { exportSnapshot, profile, systemState, usageDaily } from "@/server/db/schema";
import {
  assertDatabaseCapacity,
  assertImportQuota,
  assertRosterRoom,
  bumpUsage,
  countImport,
  DATABASE_SIZE_STATE_KEY,
  getUserUsage,
  importsToday,
  readDatabaseSize,
  storedRosterBytes,
  userScope,
  utcDay,
} from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { ATLAS, NOVA, NOW, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const DAY = "2026-09-30";

async function counter(scopeKey: string, day = DAY) {
  const [row] = await getDb()
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.day, day), eq(usageDaily.scopeKey, scopeKey)));
  return row ?? null;
}

async function seedSnapshot(userId: string, handle: string, rosterBytes: number): Promise<void> {
  const db = getDb();
  const [created] = await db.insert(profile).values({ userId, handle }).returning({ id: profile.id });
  await db.insert(exportSnapshot).values({
    userId,
    profileId: created!.id,
    snapshotDigest: "a".repeat(64),
    contentDigest: "b".repeat(64),
    importedAt: NOW,
    followers: ["pixel_forge"],
    following: null,
    followersShards: [0],
    followingShards: [],
    declaredCompleteFollowers: false,
    declaredCompleteFollowing: false,
    followersComplete: false,
    followingComplete: false,
    rosterBytes,
    isCurrent: true,
  });
}

describe("utcDay", () => {
  it("is the UTC calendar date of the clock", () => {
    expect(utcDay(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-30");
    expect(utcDay(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
  });
});

describe("bumpUsage", () => {
  it("creates the counter row at one", async () => {
    expect(await bumpUsage(getDb(), "user:u1", DAY, "imports")).toBe(1);
    expect(await counter("user:u1")).toMatchObject({ imports: 1, manualReviews: 0, jobs: 0 });
  });

  it("adds to an existing counter without touching the others", async () => {
    await bumpUsage(getDb(), "user:u1", DAY, "imports");
    await bumpUsage(getDb(), "user:u1", DAY, "jobs");
    expect(await bumpUsage(getDb(), "user:u1", DAY, "imports")).toBe(2);
    expect(await counter("user:u1")).toMatchObject({ imports: 2, manualReviews: 0, jobs: 1 });
  });

  it("loses no increment when many callers bump at once", async () => {
    await Promise.all(Array.from({ length: 20 }, () => bumpUsage(getDb(), "global", DAY, "jobs")));
    expect((await counter("global"))?.jobs).toBe(20);
  });

  it("returns null and changes nothing once the limit is reached", async () => {
    expect(await bumpUsage(getDb(), "user:u1", DAY, "imports", 2)).toBe(1);
    expect(await bumpUsage(getDb(), "user:u1", DAY, "imports", 2)).toBe(2);
    expect(await bumpUsage(getDb(), "user:u1", DAY, "imports", 2)).toBeNull();
    expect((await counter("user:u1"))?.imports).toBe(2);
  });

  it("never passes the limit when callers race", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => bumpUsage(getDb(), "user:u1", DAY, "imports", 5)),
    );
    expect(results.filter((value) => value !== null)).toHaveLength(5);
    expect((await counter("user:u1"))?.imports).toBe(5);
  });

  it("keeps each day separate", async () => {
    await bumpUsage(getDb(), "user:u1", DAY, "imports");
    expect(await bumpUsage(getDb(), "user:u1", "2026-10-01", "imports")).toBe(1);
  });
});

describe("import quota", () => {
  it("counts only the imports of that user on that UTC day", async () => {
    await bumpUsage(getDb(), userScope("u1"), DAY, "imports");
    await bumpUsage(getDb(), userScope("u2"), DAY, "imports");
    await bumpUsage(getDb(), userScope("u1"), "2026-09-29", "imports");
    expect(await importsToday("u1", NOW)).toBe(1);
    expect(await importsToday("u3", NOW)).toBe(0);
  });

  it("passes below the daily limit", async () => {
    await expect(assertImportQuota("u1", NOW)).resolves.toBeUndefined();
  });

  it("refuses with quota_exhausted at the daily limit", async () => {
    await getDb()
      .insert(usageDaily)
      .values({ day: DAY, scopeKey: userScope("u1"), imports: LIMITS.importsPerUserPerDay });
    const error = await thrown(() => assertImportQuota("u1", NOW));
    expect(error.code).toBe("quota_exhausted");
    expect(error.details).toMatchObject({ limit: LIMITS.importsPerUserPerDay });
  });

  it("counts an import and refuses the one past the limit", async () => {
    for (let index = 0; index < LIMITS.importsPerUserPerDay; index += 1) await countImport("u1", NOW);
    expect((await thrown(() => countImport("u1", NOW))).code).toBe("quota_exhausted");
    expect(await importsToday("u1", NOW)).toBe(LIMITS.importsPerUserPerDay);
  });
});

describe("roster bytes", () => {
  it("sums the stored roster bytes of one user only", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const nova = await createVerifiedUser({ email: NOVA });
    await seedSnapshot(atlas.userId, "atlas_studio", 1200);
    await seedSnapshot(nova.userId, "nova_labs", 77);
    expect(await storedRosterBytes(atlas.userId)).toBe(1200);
    expect(await storedRosterBytes(nova.userId)).toBe(77);
  });

  it("is zero for a user with no snapshot", async () => {
    expect(await storedRosterBytes("nobody")).toBe(0);
  });

  it("refuses with quota_exhausted when the new rosters do not fit", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await seedSnapshot(atlas.userId, "atlas_studio", LIMITS.rosterBytesPerUser - 10);
    await expect(assertRosterRoom(atlas.userId, 10)).resolves.toBeUndefined();
    const error = await thrown(() => assertRosterRoom(atlas.userId, 11));
    expect(error.code).toBe("quota_exhausted");
  });
});

describe("database capacity", () => {
  it("reports no measurement before the first tick", async () => {
    expect(await readDatabaseSize()).toEqual({ bytes: null, measuredAt: null });
    await expect(assertDatabaseCapacity()).resolves.toBeUndefined();
  });

  it("passes while the measured size is below the configured maximum", async () => {
    setTestEnv({ CAPACITY_MAX_DB_BYTES: "1000" });
    await getDb()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 999, measuredAt: "2026-09-30T11:00:00.000Z" } });
    await expect(assertDatabaseCapacity()).resolves.toBeUndefined();
    expect(await readDatabaseSize()).toEqual({ bytes: 999, measuredAt: "2026-09-30T11:00:00.000Z" });
  });

  it("refuses with capacity_paused once the measured size reaches the maximum", async () => {
    setTestEnv({ CAPACITY_MAX_DB_BYTES: "1000" });
    await getDb()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 1000, measuredAt: "2026-09-30T11:00:00.000Z" } });
    const error = await thrown(() => assertDatabaseCapacity());
    expect(error.code).toBe("capacity_paused");
    expect(error.status).toBe(503);
  });

  it("treats a malformed measurement as no measurement", async () => {
    await getDb().insert(systemState).values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: "lots" } });
    expect(await readDatabaseSize()).toEqual({ bytes: null, measuredAt: null });
  });
});

describe("getUserUsage", () => {
  it("reports the profile, import, and roster usage next to the limits", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await seedSnapshot(atlas.userId, "atlas_studio", 345);
    await countImport(atlas.userId, NOW);
    expect(await getUserUsage(atlas.userId, NOW)).toEqual({
      profiles: 1,
      profilesLimit: LIMITS.profilesPerUser,
      importsToday: 1,
      importsPerDayLimit: LIMITS.importsPerUserPerDay,
      rosterBytes: 345,
      rosterBytesLimit: LIMITS.rosterBytesPerUser,
    });
  });
});
