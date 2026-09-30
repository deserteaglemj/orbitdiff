import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CAPACITY_DEFAULTS, CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { systemState, user } from "@/server/db/schema";
import { LAST_TICK_STATE_KEY } from "@/server/http/health";
import { getCapacity, listUsers } from "@/server/services/admin";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";
import { bumpUsage, DATABASE_SIZE_STATE_KEY, GLOBAL_SCOPE } from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv, signUp } from "../../helpers";
import { ATLAS, exportPayload, NOVA, NOW, OWNER, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const admin = () => createVerifiedUser({ email: OWNER, name: "Owner", onboarded: true });

describe("listUsers", () => {
  it("lists every user, newest first, with usage and consent", async () => {
    const owner = await admin();
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas", onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await importExport(atlas.userId, created.id, exportPayload(), NOW);

    const page = await listUsers(owner.userId, {}, NOW);

    expect(page.data.map((item) => item.email)).toEqual([ATLAS, OWNER]);
    expect(page.pagination).toMatchObject({ page: 1, totalItems: 2, totalPages: 1 });
    const item = page.data[0]!;
    expect(item).toMatchObject({
      id: atlas.userId,
      email: ATLAS,
      name: "Atlas",
      emailVerified: true,
      status: "active",
      onboarded: true,
      usage: {
        profiles: 1,
        snapshots: 1,
        rosterBytes: 29,
        importsLast30Days: 1,
        jobsLast30Days: 1,
        lastActivityAt: NOW.toISOString(),
      },
    });
    expect(item.consent.terms).toMatchObject({ granted: true, version: CONSENT_VERSIONS.terms });
    expect(page.data[1]?.usage).toEqual({
      profiles: 0,
      snapshots: 0,
      rosterBytes: 0,
      importsLast30Days: 0,
      jobsLast30Days: 0,
      lastActivityAt: null,
    });
  });

  it("leaves usage older than thirty days out of the recent counts", async () => {
    const owner = await admin();
    await bumpUsage(getDb(), `user:${owner.userId}`, "2026-08-01", "imports");
    await bumpUsage(getDb(), `user:${owner.userId}`, "2026-09-15", "imports");
    const page = await listUsers(owner.userId, {}, NOW);
    expect(page.data[0]?.usage.importsLast30Days).toBe(1);
  });

  it("shows an unverified, suspended, or not yet onboarded account as such", async () => {
    const owner = await admin();
    await signUp({ email: NOVA });
    const atlas = await createVerifiedUser({ email: ATLAS });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    const page = await listUsers(owner.userId, {}, NOW);
    const byEmail = new Map(page.data.map((item) => [item.email, item]));
    expect(byEmail.get(NOVA)).toMatchObject({ emailVerified: false, status: "active", onboarded: false });
    expect(byEmail.get(ATLAS)).toMatchObject({ emailVerified: true, status: "suspended", onboarded: false });
  });

  it("filters by an email or name substring", async () => {
    const owner = await admin();
    await createVerifiedUser({ email: ATLAS, name: "Studio Person" });
    await createVerifiedUser({ email: NOVA, name: "Labs Person" });
    expect((await listUsers(owner.userId, { q: "NOVA@" }, NOW)).data.map((item) => item.email)).toEqual([NOVA]);
    expect((await listUsers(owner.userId, { q: "studio" }, NOW)).data.map((item) => item.email)).toEqual([ATLAS]);
    expect((await listUsers(owner.userId, { q: "%" }, NOW)).data).toEqual([]);
  });

  it("pages the users", async () => {
    const owner = await admin();
    await createVerifiedUser({ email: ATLAS });
    await createVerifiedUser({ email: NOVA });
    const page = await listUsers(owner.userId, { page: 2, pageSize: 2 }, NOW);
    expect(page.data.map((item) => item.email)).toEqual([OWNER]);
    expect(page.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it("never contains a password, a token, a handle, or a roster", async () => {
    const owner = await admin();
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await importExport(atlas.userId, created.id, exportPayload(), NOW);
    const text = JSON.stringify(await listUsers(owner.userId, {}, NOW));
    expect(text).not.toMatch(/password|token|followers|following|handle/i);
    for (const word of ["atlas_studio", "nova_labs", "pixel_forge"]) expect(text).not.toContain(word);
  });

  it("answers not_found to a user who is not an admin", async () => {
    await admin();
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const error = await thrown(() => listUsers(atlas.userId, {}, NOW));
    expect(error.code).toBe("not_found");
  });

  it("answers not_found when the configured address is not verified", async () => {
    await signUp({ email: OWNER });
    const [pending] = await getDb().select().from(user).where(eq(user.email, OWNER));
    expect((await thrown(() => listUsers(pending!.id, {}, NOW))).code).toBe("not_found");
  });

  it("answers not_found when the configured admin is suspended", async () => {
    const owner = await admin();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));
    expect((await thrown(() => listUsers(owner.userId, {}, NOW))).code).toBe("not_found");
  });
});

describe("getCapacity", () => {
  it("reports users, jobs, database size, mail, and registration against the limits", async () => {
    const owner = await admin();
    await bumpUsage(getDb(), GLOBAL_SCOPE, "2026-09-30", "jobs");
    await bumpUsage(getDb(), GLOBAL_SCOPE, "2026-09-30", "jobs");
    await bumpUsage(getDb(), GLOBAL_SCOPE, "2026-09-29", "jobs");
    await getDb()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 12_345, measuredAt: "2026-09-30T11:00:00.000Z" } });

    expect(await getCapacity(owner.userId, NOW)).toEqual({
      users: { used: 1, limit: CAPACITY_DEFAULTS.maxUsers, paused: false },
      jobsToday: { used: 2, limit: CAPACITY_DEFAULTS.maxJobsPerDay, paused: false },
      database: {
        bytes: 12_345,
        limit: CAPACITY_DEFAULTS.maxDatabaseBytes,
        paused: false,
        measuredAt: "2026-09-30T11:00:00.000Z",
      },
      lastTick: null,
      mail: { available: true, mode: "captured" },
      registration: { open: true, reason: null },
    });
  });

  it("reports an unknown database size as unknown, not zero", async () => {
    const owner = await admin();
    expect((await getCapacity(owner.userId, NOW)).database).toEqual({
      bytes: null,
      limit: CAPACITY_DEFAULTS.maxDatabaseBytes,
      paused: false,
      measuredAt: null,
    });
  });

  it("reports each limit that is reached as paused", async () => {
    const owner = await admin();
    setTestEnv({ CAPACITY_MAX_USERS: "1", CAPACITY_MAX_JOBS_PER_DAY: "1", CAPACITY_MAX_DB_BYTES: "100" });
    await bumpUsage(getDb(), GLOBAL_SCOPE, "2026-09-30", "jobs");
    await getDb()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 100, measuredAt: NOW.toISOString() } });
    const capacity = await getCapacity(owner.userId, NOW);
    expect(capacity.users).toEqual({ used: 1, limit: 1, paused: true });
    expect(capacity.jobsToday).toEqual({ used: 1, limit: 1, paused: true });
    expect(capacity.database.paused).toBe(true);
    expect(capacity.registration.open).toBe(false);
    expect(capacity.registration.reason).toContain("capacity");
  });

  it("returns the summary of the last tick", async () => {
    const owner = await admin();
    const tick = {
      at: "2026-09-30T11:00:00.000Z",
      recovered: 0,
      enqueued: 2,
      claimed: 2,
      succeeded: 2,
      failed: 0,
      retried: 0,
      cancelled: 0,
      remaining: 0,
      cleaned: 1,
      durationMs: 321,
      pausedForCapacity: false,
    };
    await getDb().insert(systemState).values({ key: LAST_TICK_STATE_KEY, value: tick });
    expect((await getCapacity(owner.userId, NOW)).lastTick).toEqual(tick);
  });

  it("says when mail is not delivered and registration is closed", async () => {
    const owner = await admin();
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const capacity = await getCapacity(owner.userId, NOW);
    expect(capacity.mail).toEqual({ available: false, mode: "none" });
    expect(capacity.registration.open).toBe(false);
  });

  it("answers not_found to a user who is not an admin", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await thrown(() => getCapacity(atlas.userId, NOW))).code).toBe("not_found");
  });
});
