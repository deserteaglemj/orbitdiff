import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSessionUser } from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import {
  activityEntry,
  changeEvent,
  exportSnapshot,
  job,
  profile,
  usageDaily,
  user,
} from "@/server/db/schema";

import { authRequest, createVerifiedUser, signIn, TEST_PASSWORD, type VerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const ATLAS = "atlas@orbitdiff.test";
const NOVA = "nova@orbitdiff.test";

/** Tables that hold rows for a user, with the expression that selects that user's rows. */
const USER_TABLES: Array<[string, (userId: string, email: string, profileId: string) => ReturnType<typeof sql>]> = [
  ["user", (userId) => sql`select 1 from "user" where id = ${userId}`],
  ["session", (userId) => sql`select 1 from session where user_id = ${userId}`],
  ["account", (userId) => sql`select 1 from account where user_id = ${userId}`],
  ["verification", (userId) => sql`select 1 from verification where value = ${userId}`],
  ["consent_record", (userId) => sql`select 1 from consent_record where user_id = ${userId}`],
  ["profile", (userId) => sql`select 1 from profile where user_id = ${userId}`],
  ["export_snapshot", (userId) => sql`select 1 from export_snapshot where user_id = ${userId}`],
  ["change_event", (userId) => sql`select 1 from change_event where user_id = ${userId}`],
  ["job", (userId) => sql`select 1 from job where user_id = ${userId}`],
  ["activity_entry", (userId) => sql`select 1 from activity_entry where user_id = ${userId}`],
  [
    "usage_daily",
    (userId, _email, profileId) =>
      sql`select 1 from usage_daily where scope_key in (${`user:${userId}`}, ${`profile:${profileId}`})`,
  ],
  ["mail_capture", (_userId, email) => sql`select 1 from mail_capture where to_address = ${email}`],
];

/** Give a user one row in every application table, inserted directly. Returns the profile id. */
async function seedEverything(owner: VerifiedUser, handle: string): Promise<string> {
  const db = getDb();
  const [created] = await db.insert(profile).values({ userId: owner.userId, handle }).returning({ id: profile.id });
  const profileId = created!.id;
  await db.insert(exportSnapshot).values({
    userId: owner.userId,
    profileId,
    snapshotDigest: "a".repeat(64),
    contentDigest: "b".repeat(64),
    importedAt: new Date(),
    followers: ["pixel_forge"],
    following: [],
    followersShards: [0],
    followingShards: [0],
    declaredCompleteFollowers: true,
    declaredCompleteFollowing: true,
    followersComplete: false,
    followingComplete: false,
    rosterBytes: 11,
    isCurrent: true,
  });
  await db.insert(changeEvent).values({
    userId: owner.userId,
    profileId,
    eventType: "follower_observed_added",
    direction: "followers",
    username: "pixel_forge",
    intervalStart: new Date("2026-09-01T00:00:00Z"),
    intervalEnd: new Date("2026-09-02T00:00:00Z"),
    eventDigest: "c".repeat(64),
    position: 0,
  });
  await db.insert(job).values({
    userId: owner.userId,
    profileId,
    kind: "derive_profile",
    dedupeKey: `derive:${profileId}:1`,
  });
  await db.insert(activityEntry).values({
    userId: owner.userId,
    profileId,
    kind: "profile_added",
    status: "info",
    summary: { handle },
  });
  await db.insert(usageDaily).values([
    { day: "2026-09-30", scopeKey: `user:${owner.userId}`, imports: 1 },
    { day: "2026-09-30", scopeKey: `profile:${profileId}`, manualReviews: 1 },
  ]);
  // A pending password reset leaves a verification row that holds the user id.
  await authRequest("/request-password-reset", { json: { email: owner.email, redirectTo: "/reset-password" } });
  return profileId;
}

async function tablesWithRows(owner: VerifiedUser, profileId: string): Promise<string[]> {
  const present: string[] = [];
  for (const [table, query] of USER_TABLES) {
    const result = await getDb().execute(query(owner.userId, owner.email, profileId));
    if (result.rows.length > 0) present.push(table);
  }
  return present;
}

const ALL_TABLES = USER_TABLES.map(([table]) => table);

describe("account deletion", () => {
  it("needs the password even with a fresh session", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: {}, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_REQUIRED");
    expect(await getDb().select().from(user).where(eq(user.id, atlas.userId))).toHaveLength(1);
  });

  it("refuses a wrong password and keeps the account", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", {
      json: { password: "not-the-password" },
      cookie: atlas.cookie,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_PASSWORD");
    expect(await getDb().select().from(user).where(eq(user.id, atlas.userId))).toHaveLength(1);
  });

  it("refuses a request without a session", async () => {
    await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password: TEST_PASSWORD } });
    expect(response.status).toBe(401);
    expect(await getDb().select().from(user)).toHaveLength(1);
  });

  it("removes every row of the user in every table and leaves a second user untouched", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const nova = await createVerifiedUser({ email: NOVA });
    const atlasProfile = await seedEverything(atlas, "atlas_studio");
    const novaProfile = await seedEverything(nova, "nova_labs");
    expect(await tablesWithRows(atlas, atlasProfile)).toEqual(ALL_TABLES);
    expect(await tablesWithRows(nova, novaProfile)).toEqual(ALL_TABLES);

    const response = await authRequest("/delete-user", {
      json: { password: TEST_PASSWORD },
      cookie: atlas.cookie,
    });
    expect(response.status).toBe(200);

    expect(await tablesWithRows(atlas, atlasProfile)).toEqual([]);
    expect(await tablesWithRows(nova, novaProfile)).toEqual(ALL_TABLES);
    expect(await getSessionUser(new Headers({ cookie: atlas.cookie }))).toBeNull();
    expect((await getSessionUser(new Headers({ cookie: nova.cookie })))?.id).toBe(nova.userId);
    expect((await signIn({ email: ATLAS })).status).toBe(401);
  });
});
