import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuth } from "@/server/auth/auth";
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

import { authRequest, createVerifiedUser, TEST_PASSWORD, type VerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const ATLAS = "atlas@orbitdiff.test";
const NOVA = "nova@orbitdiff.test";

async function stillExists(account: VerifiedUser): Promise<boolean> {
  return (await getDb().select({ id: user.id }).from(user).where(eq(user.id, account.userId))).length === 1;
}

/** One row in every application table for this user, inserted directly. */
async function seedEverything(owner: VerifiedUser, handle: string, mark: string): Promise<string> {
  const db = getDb();
  const [created] = await db.insert(profile).values({ userId: owner.userId, handle }).returning({ id: profile.id });
  const profileId = created!.id;
  await db.insert(exportSnapshot).values({
    userId: owner.userId,
    profileId,
    snapshotDigest: mark.repeat(64),
    contentDigest: mark.repeat(64),
    importedAt: new Date(),
    followers: ["pixel_forge"],
    following: ["lunar_arch"],
    followersShards: [0],
    followingShards: [0],
    declaredCompleteFollowers: true,
    declaredCompleteFollowing: true,
    followersComplete: false,
    followingComplete: false,
    rosterBytes: 21,
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
    eventDigest: mark.repeat(64),
    position: 0,
  });
  await db.insert(job).values({ userId: owner.userId, profileId, kind: "derive_profile", dedupeKey: `derive:${profileId}:1` });
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
  await authRequest("/request-password-reset", { json: { email: owner.email, redirectTo: "/reset-password" } });
  return profileId;
}

/**
 * Tables in the public schema that hold a row mentioning any of the needles, in
 * any column. It scans whatever tables exist, so a table added later is covered
 * without changing this test.
 */
async function tablesMentioning(needles: string[]): Promise<string[]> {
  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const found: string[] = [];
  for (const { tablename } of tables.rows) {
    const name = sql.raw(`"${tablename.replaceAll('"', '""')}"`);
    const matches = needles.map((needle) => sql`position(${needle} in lower(t::text)) > 0`);
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${name} t where ${sql.join(matches, sql` or `)}`,
    );
    if ((result.rows[0]?.n ?? 0) > 0) found.push(tablename);
  }
  return found;
}

describe("account deletion gate: the password is always required", () => {
  it("refuses a request without a password and names what is missing", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: {}, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "PASSWORD_REQUIRED",
      message: "Enter your password to delete your account.",
    });
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses a request with no body at all", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { method: "POST", cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_REQUIRED");
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses an empty password", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password: "" }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_REQUIRED");
    expect(await stillExists(atlas)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a number", 0],
    ["true", true],
    ["a list", [TEST_PASSWORD]],
    ["an object", { value: TEST_PASSWORD }],
  ])("refuses a password that is %s", async (_label, password) => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_REQUIRED");
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses a wrong password", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password: "not-the-password" }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_PASSWORD");
    expect(await stillExists(atlas)).toBe(true);
  });

  it.each([
    ["whitespace only", "          "],
    ["the right password with a trailing space", `${TEST_PASSWORD} `],
    ["the right password in another case", TEST_PASSWORD.toUpperCase()],
  ])("refuses %s", async (_label, password) => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_PASSWORD");
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses another account's password", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await authRequest("/sign-up/email", {
      json: {
        email: NOVA,
        name: "Nova",
        password: "nova-only-pw-22",
        timezone: "UTC",
        acceptedTermsVersion: "2026-09-30",
      },
    });
    const response = await authRequest("/delete-user", { json: { password: "nova-only-pw-22" }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses an emailed deletion token in place of the password", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { token: "made-up-token" }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("FIELD_NOT_ALLOWED");
    expect(await stillExists(atlas)).toBe(true);
  });

  it("refuses a server-side call without a password as well", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const headers = new Headers({ cookie: atlas.cookie });
    await expect(getAuth().api.deleteUser({ body: {}, headers })).rejects.toMatchObject({
      body: { code: "PASSWORD_REQUIRED" },
    });
    expect(await stillExists(atlas)).toBe(true);
  });
});

describe("account deletion: what is removed and what stays", () => {
  it("leaves no row that mentions the deleted user anywhere, and leaves the other user's rows alone", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const nova = await createVerifiedUser({ email: NOVA });
    const atlasProfile = await seedEverything(atlas, "atlas_studio", "a");
    const novaProfile = await seedEverything(nova, "nova_labs", "b");
    const atlasNeedles = [atlas.userId.toLowerCase(), ATLAS, atlasProfile];
    const novaNeedles = [nova.userId.toLowerCase(), NOVA, novaProfile];
    const everyTable = [
      "account",
      "activity_entry",
      "change_event",
      "consent_record",
      "export_snapshot",
      "job",
      "mail_capture",
      "profile",
      "session",
      "usage_daily",
      "user",
      "verification",
    ];
    expect(await tablesMentioning(atlasNeedles)).toEqual(everyTable);
    expect(await tablesMentioning(novaNeedles)).toEqual(everyTable);

    const response = await authRequest("/delete-user", { json: { password: TEST_PASSWORD }, cookie: atlas.cookie });
    expect(response.status).toBe(200);

    expect(await tablesMentioning(atlasNeedles)).toEqual([]);
    expect(await tablesMentioning(novaNeedles)).toEqual(everyTable);
  });
});
