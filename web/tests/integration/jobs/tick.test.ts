import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAPACITY_DEFAULTS, CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { nextReviewAt } from "@/domain/schedule";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, job, profile, systemState, usageDaily, user } from "@/server/db/schema";
import { LAST_TICK_STATE_KEY } from "@/server/http/health";
import { JOB_CAPACITY_STATE_KEY } from "@/server/jobs/capacity";
import { enqueueJob } from "@/server/jobs/queue";
import { drainJobs, runTick } from "@/server/jobs/tick";
import type { JobHandler } from "@/server/jobs/worker";
import type { TickSummaryDto } from "@/server/services/contracts";
import { DATABASE_SIZE_STATE_KEY } from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import {
  activityOf,
  addProfile,
  addSnapshot,
  eventsOf,
  jobRow,
  jobsOf,
  type Owner,
  ownerWithProfile,
  profileRow,
  queueDerive,
} from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const DUE = new Date("2026-09-30T09:00:00.000Z");
const MINUTE = 60_000;

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.restoreAllMocks();
});
afterAll(closeDb);

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

async function dueOwner(email = "atlas@orbitdiff.test", handle = "atlas_studio", timezone?: string): Promise<Owner> {
  return ownerWithProfile(email, handle, { timezone, profile: { nextReviewAt: DUE } });
}

async function stateOf(key: string): Promise<unknown> {
  const [row] = await getDb().select().from(systemState).where(eq(systemState.key, key));
  return row?.value;
}

describe("runTick: daily reviews", () => {
  it("queues and runs the review of a profile whose review time has passed, and moves the next one", async () => {
    const owner = await dueOwner();

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 1, claimed: 1, succeeded: 1, failed: 0, remaining: 0, pausedForCapacity: false });
    const [review] = await jobsOf(owner.profileId, "daily_review");
    expect(review).toMatchObject({ status: "succeeded", dedupeKey: `daily:${owner.profileId}:2026-09-30` });
    expect(await activityOf(owner.profileId, "review")).toHaveLength(1);
    const after = await profileRow(owner.profileId);
    expect(after.nextReviewAt?.toISOString()).toBe(nextReviewAt(NOW, "UTC", 9).toISOString());
    expect(after.lastReviewAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("keys the review by the local date in the user's timezone", async () => {
    // Due at 11:30 UTC on the 30th, which is 00:30 on the 1st in Auckland.
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", {
      timezone: "Pacific/Auckland",
      profile: { nextReviewAt: new Date("2026-09-30T11:30:00.000Z") },
    });

    await runTick({ now: NOW });

    const [review] = await jobsOf(owner.profileId, "daily_review");
    expect(review?.dedupeKey).toBe(`daily:${owner.profileId}:2026-10-01`);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(
      nextReviewAt(NOW, "Pacific/Auckland", 9).toISOString(),
    );
  });

  it("keys the review by the date it was scheduled for, not the date of the run", async () => {
    // Due at 09:00 UTC, 22:00 on the 30th in Auckland. The run at 12:00 UTC is already the 1st there.
    const owner = await dueOwner("atlas@orbitdiff.test", "atlas_studio", "Pacific/Auckland");

    await runTick({ now: NOW });

    const [review] = await jobsOf(owner.profileId, "daily_review");
    expect(review?.dedupeKey).toBe(`daily:${owner.profileId}:2026-09-30`);
  });

  it("does nothing for a profile whose review time has not come", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", { profile: { nextReviewAt: at(1) } });

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(await jobsOf(owner.profileId)).toEqual([]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(at(1).toISOString());
  });

  it("does not queue the due review of a paused profile", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", {
      profile: { nextReviewAt: DUE, status: "paused" },
    });

    const summary = await runTick({ now: NOW });

    expect(summary.enqueued).toBe(0);
    expect(await jobsOf(owner.profileId)).toEqual([]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(DUE.toISOString());
  });

  it("cancels a queued review when the profile was paused after it was queued", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const { job: queued } = await enqueueJob(getDb(), {
      userId: owner.userId,
      profileId: owner.profileId,
      kind: "daily_review",
      dedupeKey: `daily:${owner.profileId}:2026-09-30`,
      runAfter: NOW,
    });
    await getDb().update(profile).set({ status: "paused", pausedAt: NOW }).where(eq(profile.id, owner.profileId));

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ claimed: 1, cancelled: 1, succeeded: 0 });
    expect(await jobRow(queued.id)).toMatchObject({ status: "cancelled", cancelReason: "profile_paused" });
    expect(await activityOf(owner.profileId)).toEqual([]);
  });

  it.each([
    ["suspended", { status: "suspended" }],
    ["not verified", { emailVerified: false }],
    ["not onboarded", { onboardedAt: null }],
  ])("skips the due review of a user who is %s", async (_label, change) => {
    const owner = await dueOwner();
    await getDb().update(user).set(change).where(eq(user.id, owner.userId));

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(await jobsOf(owner.profileId)).toEqual([]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(DUE.toISOString());
  });
});

describe("runTick: consent", () => {
  const later = new Date("2026-12-01T00:00:00.000Z");
  const grant = (owner: Owner, kind: string, version: string, granted: boolean) =>
    getDb().insert(consentRecord).values({ userId: owner.userId, kind, version, granted, source: "settings", recordedAt: later });

  it("reviews a user whose newest terms and privacy records are granted at the current versions", async () => {
    const owner = await dueOwner();

    expect((await runTick({ now: NOW })).enqueued).toBe(1);
    expect(await jobsOf(owner.profileId, "daily_review")).toHaveLength(1);
  });

  it("skips a user with no consent record at all", async () => {
    const owner = await dueOwner();
    await getDb().delete(consentRecord).where(eq(consentRecord.userId, owner.userId));

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("skips a user whose privacy record is missing", async () => {
    const owner = await dueOwner();
    await getDb().delete(consentRecord).where(and(eq(consentRecord.userId, owner.userId), eq(consentRecord.kind, "privacy")));

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
  });

  it("skips a user whose newest terms record is a withdrawal", async () => {
    const owner = await dueOwner();
    await grant(owner, "terms", CONSENT_VERSIONS.terms, false);

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
  });

  it("skips a user whose newest privacy record is for another version", async () => {
    const owner = await dueOwner();
    await grant(owner, "privacy", "2020-01-01", true);

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
  });

  it("skips a user whose newest terms record has an empty version", async () => {
    const owner = await dueOwner();
    await grant(owner, "terms", "", true);

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
  });

  it("does not accept marketing consent in place of terms and privacy", async () => {
    const owner = await dueOwner();
    await getDb().delete(consentRecord).where(eq(consentRecord.userId, owner.userId));
    await grant(owner, "marketing", CONSENT_VERSIONS.marketing, true);

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
  });
});

describe("runTick: capacity", () => {
  it("queues nothing and reports the pause once the day's jobs have reached the daily capacity", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "2" });
    const owner = await dueOwner();
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: [] });
    const waiting = await queueDerive(owner, NOW);
    await getDb().insert(usageDaily).values({ day: "2026-09-30", scopeKey: "global", jobs: 2 });

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 0, claimed: 0, succeeded: 0, pausedForCapacity: true, remaining: 1 });
    expect(await jobsOf(owner.profileId, "daily_review")).toEqual([]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(DUE.toISOString());
    expect((await jobRow(waiting.id))?.status).toBe("queued");
    expect(await stateOf(JOB_CAPACITY_STATE_KEY)).toEqual({ at: NOW.toISOString(), day: "2026-09-30", used: 2, limit: 2, paused: true });
    expect(await stateOf(LAST_TICK_STATE_KEY)).toMatchObject({ at: NOW.toISOString(), pausedForCapacity: true });
  });

  it("starts again on the next UTC day", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "2" });
    const owner = await dueOwner();
    await getDb().insert(usageDaily).values({ day: "2026-09-30", scopeKey: "global", jobs: 2 });
    const tomorrow = new Date("2026-10-01T00:30:00.000Z");

    const summary = await runTick({ now: tomorrow });

    expect(summary).toMatchObject({ enqueued: 1, succeeded: 1, pausedForCapacity: false });
    expect(await stateOf(JOB_CAPACITY_STATE_KEY)).toMatchObject({ day: "2026-10-01", used: 1, limit: 2, paused: false });
    expect(await jobsOf(owner.profileId, "daily_review")).toHaveLength(1);
  });

  it("stops queueing and draining at the capacity that is left", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "3" });
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    for (const handle of ["atlas_studio", "nova_labs", "pixel_forge"]) {
      await addProfile(owner.userId, handle, { nextReviewAt: DUE });
    }
    await getDb().insert(usageDaily).values({ day: "2026-09-30", scopeKey: "global", jobs: 1 });

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 2, claimed: 2, succeeded: 2, pausedForCapacity: false });
    expect(await stateOf(JOB_CAPACITY_STATE_KEY)).toMatchObject({ used: 3, paused: true });
  });
});

describe("runTick: throughput", () => {
  it("runs every review that falls due in a busy hour within that hour's run", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const count = 80;
    for (let index = 0; index < count; index += 1) {
      await addProfile(owner.userId, `atlas_studio_${index}`, { nextReviewAt: DUE });
    }

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: count, claimed: count, succeeded: count, failed: 0, remaining: 0 });
  });

  it("can run a whole day's job capacity in one day of hourly runs", () => {
    expect(24 * LIMITS.tickMaxJobs).toBeGreaterThanOrEqual(CAPACITY_DEFAULTS.maxJobsPerDay);
  });

  it("does not fold the review of a day into one that is still waiting from an earlier day", async () => {
    const owner = await dueOwner();
    // The review of 30 Sep is queued, and no run has drained it yet.
    expect((await runTick({ now: NOW, limits: { tickMaxJobs: 0 } })).enqueued).toBe(1);
    const dueNext = new Date("2026-10-01T09:00:00.000Z");
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(dueNext.toISOString());

    // The review of 1 Oct falls due while that one still waits: it stays due instead of being dropped.
    const late = new Date("2026-10-01T09:17:00.000Z");
    expect((await runTick({ now: late, limits: { tickMaxJobs: 0 } })).enqueued).toBe(0);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe(dueNext.toISOString());

    // The next runs finish the review of 30 Sep, then queue and run the one of 1 Oct.
    await runTick({ now: new Date("2026-10-01T10:17:00.000Z") });
    await runTick({ now: new Date("2026-10-01T11:17:00.000Z") });

    expect((await jobsOf(owner.profileId, "daily_review")).map((row) => [row.dedupeKey, row.status])).toEqual([
      [`daily:${owner.profileId}:2026-09-30`, "succeeded"],
      [`daily:${owner.profileId}:2026-10-01`, "succeeded"],
    ]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe("2026-10-02T09:00:00.000Z");
    expect(await activityOf(owner.profileId, "review")).toHaveLength(2);
  });
});

describe("runTick: drift repair", () => {
  async function drifted(): Promise<Owner> {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: [] });
    return owner;
  }

  it("queues and runs a derive job for a profile whose derived data is behind with no job in flight", async () => {
    const owner = await drifted();

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 1, succeeded: 1 });
    const [repair] = await jobsOf(owner.profileId, "derive_profile");
    expect(repair).toMatchObject({ status: "succeeded", dedupeKey: `derive:${owner.profileId}:1` });
    expect(await profileRow(owner.profileId)).toMatchObject({ contentRevision: 1, derivedRevision: 1 });
  });

  it("adds no second job while a derive job is already queued", async () => {
    const owner = await drifted();
    await queueDerive(owner, at(MINUTE));

    const summary = await runTick({ now: NOW });

    expect(summary.enqueued).toBe(0);
    expect(await jobsOf(owner.profileId, "derive_profile")).toHaveLength(1);
  });

  it("tries again once a day after the job for that revision failed", async () => {
    const owner = await drifted();
    const failed = await queueDerive(owner, NOW);
    await getDb().update(job).set({ status: "failed", finishedAt: NOW }).where(eq(job.id, failed.id));

    const finish = () =>
      getDb().update(job).set({ status: "failed", finishedAt: NOW }).where(eq(job.profileId, owner.profileId));

    const first = await runTick({ now: NOW, limits: { tickMaxJobs: 0 } });
    await finish();
    const sameDay = await runTick({ now: at(MINUTE), limits: { tickMaxJobs: 0 } });
    const nextDay = await runTick({ now: at(24 * 60 * MINUTE), limits: { tickMaxJobs: 0 } });

    expect([first.enqueued, sameDay.enqueued, nextDay.enqueued]).toEqual([1, 0, 1]);
    const keys = (await jobsOf(owner.profileId, "derive_profile")).map((row) => row.dedupeKey);
    expect(keys).toEqual([
      `derive:${owner.profileId}:1`,
      `derive:${owner.profileId}:1:repair:2026-09-30`,
      `derive:${owner.profileId}:1:repair:2026-10-01`,
    ]);
  });

  it("leaves the drifted profile of a suspended user alone", async () => {
    const owner = await drifted();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));

    expect((await runTick({ now: NOW })).enqueued).toBe(0);
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });
});

describe("runTick: failures", () => {
  it("retries a failing job with backoff, then records one failure beside the last success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: [], completeFollowers: true, completeFollowing: true });
    await queueDerive(owner, at(-MINUTE));
    await runTick({ now: at(-MINUTE) });
    const good = await profileRow(owner.profileId);
    await addSnapshot(owner, { capturedAt: "2026-09-15T12:00:00+00:00", followers: ["pixel_forge"], following: [], completeFollowers: true, completeFollowing: true });
    const doomed = await queueDerive(owner, NOW);
    const broken: JobHandler = async () => {
      throw new Error("boom");
    };
    const handlers = { derive_profile: broken };

    const first = await runTick({ now: NOW, handlers });
    expect(first).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    expect(await jobRow(doomed.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect((await jobRow(doomed.id))?.runAfter.toISOString()).toBe(at(LIMITS.jobBackoffMs[0]).toISOString());

    const tooEarly = await runTick({ now: at(LIMITS.jobBackoffMs[0] - 1), handlers });
    expect(tooEarly).toMatchObject({ claimed: 0, remaining: 0 });

    const second = await runTick({ now: at(LIMITS.jobBackoffMs[0]), handlers });
    expect(second).toMatchObject({ claimed: 1, retried: 1 });
    expect(await jobRow(doomed.id)).toMatchObject({ status: "queued", attempts: 2 });

    const finalTime = at(LIMITS.jobBackoffMs[0] + LIMITS.jobBackoffMs[1]);
    const third = await runTick({ now: finalTime, handlers });
    expect(third).toMatchObject({ claimed: 1, retried: 0, failed: 1 });
    expect(await jobRow(doomed.id)).toMatchObject({ status: "failed", attempts: 3, lastErrorCode: "handler_error" });

    const failures = await activityOf(owner.profileId, "job_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ jobId: doomed.id, status: "failed" });
    const after = await profileRow(owner.profileId);
    expect(after.lastFailureAt?.toISOString()).toBe(finalTime.toISOString());
    expect(after.lastFailureCode).toBe("handler_error");
    expect(after.lastSuccessAt?.toISOString()).toBe(good.lastSuccessAt?.toISOString());
    expect(after.summary).toEqual(good.summary);
    expect(after.derivedRevision).toBe(1);
    expect(await eventsOf(owner.profileId)).toEqual([]);
    expect(log).toHaveBeenCalledTimes(3);
  });
});

describe("runTick: summary and state", () => {
  it("stores the summary as the last tick and the measured database size", async () => {
    await dueOwner();

    const summary = await runTick({ now: NOW });

    expect(await stateOf(LAST_TICK_STATE_KEY)).toEqual(summary);
    expect(summary.at).toBe(NOW.toISOString());
    const size = (await stateOf(DATABASE_SIZE_STATE_KEY)) as { bytes: number; measuredAt: string };
    expect(size.measuredAt).toBe(NOW.toISOString());
    expect(Number.isInteger(size.bytes) && size.bytes > 1_000_000).toBe(true);
  });

  it("returns counts and flags only", async () => {
    await dueOwner();

    const summary = await runTick({ now: NOW });

    const expected: Record<keyof TickSummaryDto, string> = {
      at: "string",
      recovered: "number",
      enqueued: "number",
      claimed: "number",
      succeeded: "number",
      failed: "number",
      retried: "number",
      cancelled: "number",
      remaining: "number",
      cleaned: "number",
      durationMs: "number",
      pausedForCapacity: "boolean",
    };
    expect(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, typeof value]))).toEqual(expected);
  });

  it("recovers an expired lease before it drains", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: [] });
    const stuck = await queueDerive(owner, NOW);
    await getDb()
      .update(job)
      .set({ status: "running", attempts: 1, lockToken: crypto.randomUUID(), lockedUntil: at(-1) })
      .where(eq(job.id, stuck.id));

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ recovered: 1, claimed: 1, succeeded: 1 });
    expect(await jobRow(stuck.id)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("counts removed rows as cleaned", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb().insert(job).values({
      userId: owner.userId,
      profileId: owner.profileId,
      kind: "daily_review",
      status: "succeeded",
      dedupeKey: `daily:${owner.profileId}:2026-01-01`,
      finishedAt: new Date("2026-01-01T09:00:00.000Z"),
    });

    expect((await runTick({ now: NOW })).cleaned).toBe(1);
  });

  it("drains no more than the job limit and reports what is left", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    for (const handle of ["atlas_studio", "nova_labs", "pixel_forge"]) {
      await addProfile(owner.userId, handle, { nextReviewAt: DUE });
    }

    const summary = await runTick({ now: NOW, limits: { tickMaxJobs: 2 } });

    expect(summary).toMatchObject({ enqueued: 3, claimed: 2, succeeded: 2, remaining: 1 });
  });

  it("makes no outbound network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const owner = await dueOwner();
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: ["pixel_forge"], completeFollowers: true, completeFollowing: true });
    await addSnapshot(owner, { capturedAt: "2026-09-15T12:00:00+00:00", followers: ["lunar_arch"], following: ["pixel_forge"], completeFollowers: true, completeFollowing: true });
    await queueDerive(owner, NOW);

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ enqueued: 1, claimed: 2, succeeded: 2 });
    expect(await eventsOf(owner.profileId)).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("runTick: concurrency", () => {
  it("queues one daily review per profile and runs each job once when two ticks overlap", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const profiles: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      profiles.push(await addProfile(owner.userId, `atlas_studio_${index}`, { nextReviewAt: DUE }));
    }

    const [left, right] = await Promise.all([runTick({ now: NOW }), runTick({ now: NOW })]);

    expect(left.enqueued + right.enqueued).toBe(profiles.length);
    expect(left.claimed + right.claimed).toBe(profiles.length);
    expect(left.succeeded + right.succeeded).toBe(profiles.length);
    for (const profileId of profiles) {
      const reviews = await jobsOf(profileId, "daily_review");
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({ status: "succeeded", attempts: 1 });
      expect(await activityOf(profileId, "review")).toHaveLength(1);
    }
    const [usage] = await getDb().select().from(usageDaily).where(eq(usageDaily.scopeKey, "global"));
    expect(usage?.jobs).toBe(profiles.length);
  });
});

describe("runTick: capacity under overlap", () => {
  it("keeps two overlapping ticks together inside the day's job capacity", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "3" });
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    for (let index = 0; index < 8; index += 1) {
      const handle = `atlas_studio_${index}`;
      const target: Owner = { userId: owner.userId, cookie: owner.cookie, handle, profileId: await addProfile(owner.userId, handle) };
      await addSnapshot(target, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["lunar_arch"], following: [] });
      await queueDerive(target, NOW);
    }

    const [left, right] = await Promise.all([runTick({ now: NOW }), runTick({ now: NOW })]);

    expect(left.claimed + right.claimed).toBe(3);
    expect(left.succeeded + right.succeeded).toBe(3);
    const [usage] = await getDb().select().from(usageDaily).where(eq(usageDaily.scopeKey, "global"));
    expect(usage?.jobs).toBe(3);
    expect(await stateOf(JOB_CAPACITY_STATE_KEY)).toMatchObject({ used: 3, limit: 3, paused: true });
  });

  it("drains nothing from a queue that was filled while the day's capacity ran out", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "2" });
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["nova_labs"], following: [] });
    const waiting = await queueDerive(owner, NOW);
    await getDb().insert(usageDaily).values({ day: "2026-09-30", scopeKey: "global", jobs: 2 });

    // The opportunistic drain does not read the capacity first: the claim itself must refuse.
    const drained = await drainJobs({ now: NOW, limit: 5 });

    expect(drained).toEqual({ claimed: 0, succeeded: 0, failed: 0, retried: 0, cancelled: 0 });
    expect((await jobRow(waiting.id))?.status).toBe("queued");
  });
});

describe("drainJobs", () => {
  it("runs only the jobs of the named profile", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const first: Owner = { userId: owner.userId, cookie: owner.cookie, handle: "atlas_studio", profileId: await addProfile(owner.userId, "atlas_studio") };
    const second: Owner = { userId: owner.userId, cookie: owner.cookie, handle: "nova_labs", profileId: await addProfile(owner.userId, "nova_labs") };
    for (const target of [first, second]) {
      await addSnapshot(target, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["pixel_forge"], following: [] });
      await queueDerive(target, NOW);
    }

    const drained = await drainJobs({ now: NOW, limit: 5, profileId: second.profileId });

    expect(drained).toEqual({ claimed: 1, succeeded: 1, failed: 0, retried: 0, cancelled: 0 });
    expect((await jobsOf(first.profileId))[0]?.status).toBe("queued");
    expect((await jobsOf(second.profileId))[0]?.status).toBe("succeeded");
  });

  it("runs only the named kinds, leaving an older job of another kind queued", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const { job: review } = await enqueueJob(getDb(), {
      userId: owner.userId,
      profileId: owner.profileId,
      kind: "manual_review",
      dedupeKey: `manual:${owner.profileId}:earlier`,
      runAfter: at(-MINUTE),
    });
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["pixel_forge"], following: [] });
    const derive = await queueDerive(owner, NOW);

    const drained = await drainJobs({ now: NOW, limit: 1, profileId: owner.profileId, kinds: ["derive_profile"] });

    expect(drained).toEqual({ claimed: 1, succeeded: 1, failed: 0, retried: 0, cancelled: 0 });
    expect((await jobRow(derive.id))?.status).toBe("succeeded");
    expect((await jobRow(review.id))?.status).toBe("queued");
    expect(await profileRow(owner.profileId)).toMatchObject({ contentRevision: 1, derivedRevision: 1 });
  });

  it("stops at the limit", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    for (const handle of ["atlas_studio", "nova_labs", "pixel_forge"]) {
      const target: Owner = { userId: owner.userId, cookie: owner.cookie, handle, profileId: await addProfile(owner.userId, handle) };
      await addSnapshot(target, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["lunar_arch"], following: [] });
      await queueDerive(target, NOW);
    }

    expect(await drainJobs({ now: NOW, limit: 2 })).toMatchObject({ claimed: 2, succeeded: 2 });
  });
});
