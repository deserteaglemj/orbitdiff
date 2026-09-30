import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { activityEntry, changeEvent, exportSnapshot, job, profile, usageDaily, user } from "@/server/db/schema";
import { dedupeKey, enqueueJob } from "@/server/jobs/queue";
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  setProfileStatus,
} from "@/server/services/profiles";
import { bumpUsage, profileScope } from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { addSnapshot, ATLAS, insertEvents, markDerived, NOVA, NOW, RANDOM_ID, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const atlasUser = () => createVerifiedUser({ email: ATLAS, onboarded: true });

async function rowOf(profileId: string) {
  const [row] = await getDb().select().from(profile).where(eq(profile.id, profileId));
  return row ?? null;
}

async function activityKinds(userId: string): Promise<string[]> {
  const rows = await getDb().select({ kind: activityEntry.kind }).from(activityEntry).where(eq(activityEntry.userId, userId));
  return rows.map((row) => row.kind).sort();
}

describe("createProfile", () => {
  it("stores an active profile with no evidence yet", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "Atlas_Studio", NOW);
    expect(created).toMatchObject({
      handle: "atlas_studio",
      status: "active",
      evidence: "missing",
      processing: false,
      currentSnapshotId: null,
      capturedAt: null,
      lastImportAt: null,
      snapshotCount: 0,
      coverage: null,
      coverageLabel: null,
      metrics: null,
      issues: [],
      pausedAt: null,
      activeJob: null,
    });
    expect((await rowOf(created.id))?.userId).toBe(atlas.userId);
  });

  it("accepts a profile link", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, " https://www.instagram.com/nova_labs/?hl=en ", NOW);
    expect(created.handle).toBe("nova_labs");
  });

  it("rejects a post link as invalid input", async () => {
    const atlas = await atlasUser();
    const error = await thrown(() => createProfile(atlas.userId, "https://www.instagram.com/p/abc123/", NOW));
    expect(error.code).toBe("invalid_input");
    expect(await getDb().select().from(profile)).toHaveLength(0);
  });

  it("sets the next review from the user's timezone and review hour", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, timezone: "Europe/Berlin", onboarded: true });
    await getDb().update(user).set({ reviewHour: 7 }).where(eq(user.id, atlas.userId));
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    // 12:00 UTC is 14:00 in Berlin, so the next 07:00 local is the following day, 05:00 UTC.
    expect(created.nextReviewAt).toBe("2026-10-01T05:00:00.000Z");
  });

  it("writes a profile_added activity entry", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const entries = await getDb().select().from(activityEntry).where(eq(activityEntry.userId, atlas.userId));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "profile_added", status: "info", profileId: created.id });
  });

  it("answers conflict for a handle the user already added", async () => {
    const atlas = await atlasUser();
    await createProfile(atlas.userId, "atlas_studio", NOW);
    const error = await thrown(() => createProfile(atlas.userId, "@ATLAS_STUDIO", NOW));
    expect(error.code).toBe("conflict");
    expect(await getDb().select().from(profile)).toHaveLength(1);
  });

  it("lets another user add the same handle", async () => {
    const atlas = await atlasUser();
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await createProfile(atlas.userId, "atlas_studio", NOW);
    const second = await createProfile(nova.userId, "atlas_studio", NOW);
    expect((await rowOf(second.id))?.userId).toBe(nova.userId);
  });

  it("refuses with quota_exhausted past the profile limit", async () => {
    const atlas = await atlasUser();
    const handles = ["atlas_studio", "nova_labs", "pixel_forge", "lunar_arch"];
    for (const handle of handles.slice(0, LIMITS.profilesPerUser)) await createProfile(atlas.userId, handle, NOW);
    const error = await thrown(() => createProfile(atlas.userId, handles[LIMITS.profilesPerUser]!, NOW));
    expect(error.code).toBe("quota_exhausted");
    expect(await getDb().select().from(profile)).toHaveLength(LIMITS.profilesPerUser);
  });

  it("keeps the limit when additions race", async () => {
    const atlas = await atlasUser();
    const handles = ["atlas_studio", "nova_labs", "pixel_forge", "lunar_arch", "ember_lab", "sunset_field"];
    const results = await Promise.allSettled(handles.map((handle) => createProfile(atlas.userId, handle, NOW)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(LIMITS.profilesPerUser);
    expect(await getDb().select().from(profile)).toHaveLength(LIMITS.profilesPerUser);
  });

  it("answers not_found for a user that does not exist", async () => {
    expect((await thrown(() => createProfile("missing-user", "atlas_studio", NOW))).code).toBe("not_found");
  });
});

describe("getProfile", () => {
  it("answers not_found for an id that does not exist", async () => {
    const atlas = await atlasUser();
    expect((await thrown(() => getProfile(atlas.userId, RANDOM_ID, NOW))).code).toBe("not_found");
  });

  it("answers not_found for a malformed id instead of a database error", async () => {
    const atlas = await atlasUser();
    const error = await thrown(() => getProfile(atlas.userId, "not-an-id", NOW));
    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
  });

  it("reports degraded evidence while any direction is not complete", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id, { followingComplete: false, declaredCompleteFollowing: false });
    expect((await getProfile(atlas.userId, created.id, NOW)).evidence).toBe("degraded");
  });

  it("reports stale evidence once the capture time is older than the stale limit", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id, {
      capturedAt: new Date(NOW.getTime() - LIMITS.staleAfterMs - 1000),
    });
    expect((await getProfile(atlas.userId, created.id, NOW)).evidence).toBe("stale");
  });

  it("reports stale evidence when the capture time is unknown", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id, { capturedAt: null });
    expect((await getProfile(atlas.userId, created.id, NOW)).evidence).toBe("stale");
  });

  it("reports ok evidence for a complete, recent export", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const snapshotId = await addSnapshot(atlas.userId, created.id);
    const found = await getProfile(atlas.userId, created.id, NOW);
    expect(found).toMatchObject({
      evidence: "ok",
      currentSnapshotId: snapshotId,
      capturedAt: "2026-09-30T11:00:00+00:00",
      lastImportAt: NOW.toISOString(),
      snapshotCount: 1,
    });
  });

  it("marks the profile as processing until the derived revision catches up", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id);
    await getDb().update(profile).set({ contentRevision: 1 }).where(eq(profile.id, created.id));
    const found = await getProfile(atlas.userId, created.id, NOW);
    expect(found.processing).toBe(true);
    expect(found.coverage).toBeNull();
    expect(found.metrics).toBeNull();
  });

  it("shows the derived summary once the revisions match", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id);
    await getDb().update(profile).set({ contentRevision: 1 }).where(eq(profile.id, created.id));
    await markDerived(created.id);
    const found = await getProfile(atlas.userId, created.id, NOW);
    expect(found.processing).toBe(false);
    expect(found.coverage?.followers).toMatchObject({ complete: true, independentlyVerified: false });
    expect(found.coverageLabel).toBe("followers user-declared complete; following user-declared complete");
    expect(found.metrics).toMatchObject({ followers: 1, following: 2, mutuals: 1, notFollowingBack: 1 });
    expect(found.lastSuccessAt).toBe(NOW.toISOString());
  });

  it("keeps showing the last derived summary while a newer import is processing", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id);
    await getDb().update(profile).set({ contentRevision: 1 }).where(eq(profile.id, created.id));
    await markDerived(created.id);
    await getDb().update(profile).set({ contentRevision: 2 }).where(eq(profile.id, created.id));
    const found = await getProfile(atlas.userId, created.id, NOW);
    expect(found.processing).toBe(true);
    expect(found.metrics).toMatchObject({ followers: 1, following: 2 });
  });

  it("shows a failure next to the last success without replacing it", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const success = new Date("2026-09-29T09:00:00Z");
    const failure = new Date("2026-09-30T09:00:00Z");
    await getDb()
      .update(profile)
      .set({ lastSuccessAt: success, lastFailureAt: failure, lastFailureCode: "derive_failed" })
      .where(eq(profile.id, created.id));
    expect(await getProfile(atlas.userId, created.id, NOW)).toMatchObject({
      lastSuccessAt: success.toISOString(),
      lastFailureAt: failure.toISOString(),
      lastFailureCode: "derive_failed",
    });
  });

  it("includes the queued job of the profile", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const queued = await enqueueJob(getDb(), {
      userId: atlas.userId,
      profileId: created.id,
      kind: "derive_profile",
      dedupeKey: dedupeKey.derive(created.id, 1),
    });
    const found = await getProfile(atlas.userId, created.id, NOW);
    expect(found.activeJob).toMatchObject({ id: queued.job.id, kind: "derive_profile", status: "queued" });
  });
});

describe("listProfiles", () => {
  it("returns the user's profiles in the list envelope, oldest first", async () => {
    const atlas = await atlasUser();
    await createProfile(atlas.userId, "atlas_studio", new Date("2026-09-30T10:00:00Z"));
    await createProfile(atlas.userId, "nova_labs", new Date("2026-09-30T11:00:00Z"));
    const page = await listProfiles(atlas.userId, {}, NOW);
    expect(page.data.map((item) => item.handle)).toEqual(["atlas_studio", "nova_labs"]);
    expect(page.pagination).toEqual({ page: 1, pageSize: LIMITS.pageSizeDefault, totalItems: 2, totalPages: 1 });
  });

  it("returns an empty page for a user with no profile", async () => {
    const atlas = await atlasUser();
    const page = await listProfiles(atlas.userId, {}, NOW);
    expect(page.data).toEqual([]);
    expect(page.pagination.totalItems).toBe(0);
  });

  it("honours the page size", async () => {
    const atlas = await atlasUser();
    await createProfile(atlas.userId, "atlas_studio", new Date("2026-09-30T10:00:00Z"));
    await createProfile(atlas.userId, "nova_labs", new Date("2026-09-30T11:00:00Z"));
    const page = await listProfiles(atlas.userId, { page: 2, pageSize: 1 }, NOW);
    expect(page.data.map((item) => item.handle)).toEqual(["nova_labs"]);
    expect(page.pagination).toEqual({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
  });
});

describe("setProfileStatus", () => {
  it("pauses: sets paused_at and clears the next review", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const later = new Date("2026-09-30T13:00:00Z");
    const paused = await setProfileStatus(atlas.userId, created.id, "paused", later);
    expect(paused).toMatchObject({ status: "paused", pausedAt: later.toISOString(), nextReviewAt: null });
    expect(await rowOf(created.id)).toMatchObject({ status: "paused", nextReviewAt: null });
  });

  it("pause cancels queued review jobs and leaves processing jobs alone", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const base = { userId: atlas.userId, profileId: created.id };
    const daily = await enqueueJob(getDb(), { ...base, kind: "daily_review", dedupeKey: dedupeKey.daily(created.id, "2026-09-30") });
    const manual = await enqueueJob(getDb(), { ...base, kind: "manual_review", dedupeKey: dedupeKey.manual(created.id, "r1") });
    const derive = await enqueueJob(getDb(), { ...base, kind: "derive_profile", dedupeKey: dedupeKey.derive(created.id, 1) });
    await setProfileStatus(atlas.userId, created.id, "paused", NOW);
    const rows = await getDb().select().from(job).where(eq(job.profileId, created.id));
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
    expect(statusOf(daily.job.id)).toBe("cancelled");
    expect(statusOf(manual.job.id)).toBe("cancelled");
    expect(statusOf(derive.job.id)).toBe("queued");
    expect(rows.find((row) => row.id === daily.job.id)?.cancelReason).toBe("profile_paused");
  });

  it("pause writes a profile_paused activity entry", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await setProfileStatus(atlas.userId, created.id, "paused", NOW);
    expect(await activityKinds(atlas.userId)).toEqual(["profile_added", "profile_paused"]);
  });

  it("resume sets the next review again and clears paused_at", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await setProfileStatus(atlas.userId, created.id, "paused", NOW);
    const resumed = await setProfileStatus(atlas.userId, created.id, "active", new Date("2026-10-02T10:00:00Z"));
    // Default schedule: 09:00 UTC. The first 09:00 after 2 Oct 10:00 is 3 Oct.
    expect(resumed).toMatchObject({ status: "active", pausedAt: null, nextReviewAt: "2026-10-03T09:00:00.000Z" });
  });

  it("resume writes a profile_resumed activity entry", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await setProfileStatus(atlas.userId, created.id, "paused", NOW);
    await setProfileStatus(atlas.userId, created.id, "active", NOW);
    expect(await activityKinds(atlas.userId)).toEqual(["profile_added", "profile_paused", "profile_resumed"]);
  });

  it("changes nothing when the profile already has that status", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await setProfileStatus(atlas.userId, created.id, "paused", NOW);
    const again = await setProfileStatus(atlas.userId, created.id, "paused", new Date("2026-10-05T00:00:00Z"));
    expect(again.pausedAt).toBe(NOW.toISOString());
    expect(await activityKinds(atlas.userId)).toEqual(["profile_added", "profile_paused"]);
  });

  it("rejects a status that is not active or paused", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    const error = await thrown(() => setProfileStatus(atlas.userId, created.id, "archived" as never, NOW));
    expect(error.code).toBe("invalid_input");
    expect((await rowOf(created.id))?.status).toBe("active");
  });

  it("answers not_found for an id that does not exist", async () => {
    const atlas = await atlasUser();
    expect((await thrown(() => setProfileStatus(atlas.userId, RANDOM_ID, "paused", NOW))).code).toBe("not_found");
  });
});

describe("deleteProfile", () => {
  it("removes the profile with its snapshots, events, jobs, activity, and counters", async () => {
    const atlas = await atlasUser();
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await addSnapshot(atlas.userId, created.id);
    await insertEvents(atlas.userId, created.id, [{ type: "follower_observed_added", username: "ember_lab" }]);
    await enqueueJob(getDb(), {
      userId: atlas.userId,
      profileId: created.id,
      kind: "derive_profile",
      dedupeKey: dedupeKey.derive(created.id, 1),
    });
    await bumpUsage(getDb(), profileScope(created.id), "2026-09-30", "manualReviews");

    await deleteProfile(atlas.userId, created.id);

    const db = getDb();
    expect(await db.select().from(profile)).toHaveLength(0);
    expect(await db.select().from(exportSnapshot)).toHaveLength(0);
    expect(await db.select().from(changeEvent)).toHaveLength(0);
    expect(await db.select().from(job)).toHaveLength(0);
    expect(await db.select().from(activityEntry)).toHaveLength(0);
    expect(await db.select().from(usageDaily)).toHaveLength(0);
  });

  it("leaves the user's other profiles alone", async () => {
    const atlas = await atlasUser();
    const first = await createProfile(atlas.userId, "atlas_studio", NOW);
    const second = await createProfile(atlas.userId, "nova_labs", NOW);
    await addSnapshot(atlas.userId, second.id);
    await deleteProfile(atlas.userId, first.id);
    expect((await getDb().select().from(profile)).map((row) => row.id)).toEqual([second.id]);
    expect(await getDb().select().from(exportSnapshot)).toHaveLength(1);
  });

  it("answers not_found for an id that does not exist", async () => {
    const atlas = await atlasUser();
    expect((await thrown(() => deleteProfile(atlas.userId, RANDOM_ID))).code).toBe("not_found");
  });
});
