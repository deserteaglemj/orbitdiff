import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { activityEntry, job, profile, user } from "@/server/db/schema";
import { dedupeKey, enqueueJob, type JobRow } from "@/server/jobs/queue";
import {
  claimJobs,
  completeJob,
  executeJob,
  failJob,
  type JobHandler,
  type JobHandlers,
  recoverExpiredLeases,
} from "@/server/jobs/worker";
import type { JobKind } from "@/server/services/contracts";

import { resetDatabase } from "../../helpers";
import { activityOf, jobRow, type Owner, ownerWithProfile, profileRow } from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const MINUTE = 60_000;

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(closeDb);

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

/** A handler with one visible effect: it stamps the profile's review time. */
const stamp: JobHandler = async (tx, context) => {
  await tx.update(profile).set({ lastReviewAt: context.now }).where(eq(profile.id, context.profile.id));
  return { stamped: true };
};

const handlers = (handler: JobHandler): JobHandlers => ({
  derive_profile: handler,
  daily_review: handler,
  manual_review: handler,
});

async function queue(owner: Owner, kind: JobKind = "derive_profile", key = "1") {
  const { job: row } = await enqueueJob(getDb(), {
    userId: owner.userId,
    profileId: owner.profileId,
    kind,
    dedupeKey: kind === "derive_profile" ? dedupeKey.derive(owner.profileId, Number(key)) : `${kind}:${owner.profileId}:${key}`,
    runAfter: NOW,
  });
  return row;
}

async function claimOne(now: Date = NOW): Promise<JobRow> {
  const [claim] = await claimJobs({ now, limit: 1 });
  if (!claim) throw new Error("nothing was claimed");
  return claim;
}

function silenceLog() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("completeJob", () => {
  it("marks the job succeeded for the holder of the lock token", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const done = await completeJob(getDb(), claim, { now: at(1000), result: { ok: 1 } });

    expect(done).toBe(true);
    const row = await jobRow(claim.id);
    expect(row).toMatchObject({ status: "succeeded", lockToken: null, lockedUntil: null, result: { ok: 1 } });
    expect(row?.finishedAt?.toISOString()).toBe(at(1000).toISOString());
  });

  it("writes nothing for a stale lock token", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const done = await completeJob(getDb(), { ...claim, lockToken: crypto.randomUUID() }, { now: at(1000) });

    expect(done).toBe(false);
    expect(await jobRow(claim.id)).toMatchObject({ status: "running", lockToken: claim.lockToken, finishedAt: null });
  });

  it("applies once when the same claim is completed twice", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    expect(await completeJob(getDb(), claim, { now: at(1000) })).toBe(true);
    expect(await completeJob(getDb(), claim, { now: at(2000) })).toBe(false);

    expect((await jobRow(claim.id))?.finishedAt?.toISOString()).toBe(at(1000).toISOString());
  });
});

describe("failJob", () => {
  it("requeues the first failure five minutes out and records the error code", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const outcome = await failJob(claim, { now: at(1000), errorCode: "handler_error" });

    expect(outcome).toBe("retried");
    const row = await jobRow(claim.id);
    expect(row).toMatchObject({ status: "queued", attempts: 1, lockToken: null, lockedUntil: null, lastErrorCode: "handler_error" });
    expect(row?.runAfter.getTime()).toBe(at(1000).getTime() + LIMITS.jobBackoffMs[0]);
    expect(await activityOf(owner.profileId)).toEqual([]);
  });

  it("waits thirty minutes after the second failure", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    await failJob(await claimOne(), { now: NOW, errorCode: "handler_error" });
    const second = await claimOne(at(5 * MINUTE));

    const outcome = await failJob(second, { now: at(5 * MINUTE), errorCode: "handler_error" });

    expect(outcome).toBe("retried");
    const row = await jobRow(second.id);
    expect(row).toMatchObject({ status: "queued", attempts: 2 });
    expect(row?.runAfter.getTime()).toBe(at(5 * MINUTE).getTime() + LIMITS.jobBackoffMs[1]);
  });

  it("marks the job failed at the attempt limit and records the failure beside the last success", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const lastSuccess = new Date("2026-09-29T08:00:00.000Z");
    const summary = { snapshotId: "kept", eventCount: 4 };
    await getDb().update(profile).set({ lastSuccessAt: lastSuccess, summary }).where(eq(profile.id, owner.profileId));
    await queue(owner);
    await failJob(await claimOne(), { now: NOW, errorCode: "handler_error" });
    await failJob(await claimOne(at(5 * MINUTE)), { now: at(5 * MINUTE), errorCode: "handler_error" });
    const third = await claimOne(at(35 * MINUTE));

    const outcome = await failJob(third, { now: at(36 * MINUTE), errorCode: "handler_error" });

    expect(outcome).toBe("failed");
    const row = await jobRow(third.id);
    expect(row).toMatchObject({ status: "failed", attempts: 3, lockToken: null, lastErrorCode: "handler_error" });
    expect(row?.finishedAt?.toISOString()).toBe(at(36 * MINUTE).toISOString());
    const entries = await activityOf(owner.profileId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      userId: owner.userId,
      jobId: third.id,
      kind: "job_failed",
      status: "failed",
      summary: { jobKind: "derive_profile", errorCode: "handler_error", attempts: 3 },
    });
    const after = await profileRow(owner.profileId);
    expect(after.lastFailureAt?.toISOString()).toBe(at(36 * MINUTE).toISOString());
    expect(after.lastFailureCode).toBe("handler_error");
    expect(after.lastSuccessAt?.toISOString()).toBe(lastSuccess.toISOString());
    expect(after.summary).toEqual(summary);
  });

  it("writes nothing for a stale lock token", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const outcome = await failJob({ ...claim, attempts: 3, lockToken: crypto.randomUUID() }, { now: at(1000), errorCode: "handler_error" });

    expect(outcome).toBe("lost");
    expect(await jobRow(claim.id)).toMatchObject({ status: "running", lastErrorCode: null });
    expect(await activityOf(owner.profileId)).toEqual([]);
    expect((await profileRow(owner.profileId)).lastFailureAt).toBeNull();
  });
});

describe("recoverExpiredLeases", () => {
  it("requeues a running job whose lease has expired", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const recovered = await recoverExpiredLeases(at(LIMITS.jobLeaseMs + 1));

    expect(recovered).toEqual({ requeued: 1, failed: 0 });
    expect(await jobRow(claim.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      lockToken: null,
      lockedUntil: null,
      lastErrorCode: "lease_expired",
    });
  });

  it("leaves a running job whose lease still holds", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const recovered = await recoverExpiredLeases(at(LIMITS.jobLeaseMs));

    expect(recovered).toEqual({ requeued: 0, failed: 0 });
    expect(await jobRow(claim.id)).toMatchObject({ status: "running", lockToken: claim.lockToken });
  });

  it("requeues a running job that has no lease at all", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const queued = await queue(owner);
    await getDb().update(job).set({ status: "running", attempts: 1 }).where(eq(job.id, queued.id));

    const recovered = await recoverExpiredLeases(NOW);

    expect(recovered).toEqual({ requeued: 1, failed: 0 });
    expect(await jobRow(queued.id)).toMatchObject({ status: "queued", lastErrorCode: "lease_expired" });
  });

  it("fails an expired job that has used every attempt and records the failure", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await getDb().update(job).set({ attempts: 3 }).where(eq(job.id, claim.id));
    const later = at(LIMITS.jobLeaseMs + 1);

    const recovered = await recoverExpiredLeases(later);

    expect(recovered).toEqual({ requeued: 0, failed: 1 });
    expect(await jobRow(claim.id)).toMatchObject({ status: "failed", lockToken: null, lastErrorCode: "lease_expired" });
    const entries = await activityOf(owner.profileId, "job_failed");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toEqual({ jobKind: "derive_profile", errorCode: "lease_expired", attempts: 3 });
    const after = await profileRow(owner.profileId);
    expect(after.lastFailureCode).toBe("lease_expired");
    expect(after.lastFailureAt?.toISOString()).toBe(later.toISOString());
  });
});

describe("executeJob", () => {
  it("runs the handler and completes the job in one step", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(stamp) });

    expect(outcome).toBe("succeeded");
    expect(await jobRow(claim.id)).toMatchObject({ status: "succeeded", result: { stamped: true } });
    expect((await profileRow(owner.profileId)).lastReviewAt?.toISOString()).toBe(at(1000).toISOString());
  });

  it("applies a job once when it is delivered twice", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await executeJob(claim, { now: at(1000), handlers: handlers(stamp) });

    const second = await executeJob(claim, { now: at(9000), handlers: handlers(stamp) });

    expect(second).toBe("lost");
    expect((await profileRow(owner.profileId)).lastReviewAt?.toISOString()).toBe(at(1000).toISOString());
    expect((await jobRow(claim.id))?.finishedAt?.toISOString()).toBe(at(1000).toISOString());
  });

  it("treats a claim without a lock token as lost, quietly", async () => {
    const log = silenceLog();
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();

    const outcome = await executeJob({ ...claim, lockToken: null }, { now: at(1000), handlers: handlers(stamp) });

    expect(outcome).toBe("lost");
    expect(log).not.toHaveBeenCalled();
    expect(await jobRow(claim.id)).toMatchObject({ status: "running", lockToken: claim.lockToken });
    expect((await profileRow(owner.profileId)).lastReviewAt).toBeNull();
  });

  it("lets the second worker finish after a lease takeover and discards the first worker's late result", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const first = await claimOne();
    const takeover = at(LIMITS.jobLeaseMs + 1);
    await recoverExpiredLeases(takeover);
    const second = await claimOne(takeover);
    expect(second.id).toBe(first.id);
    expect(second.lockToken).not.toBe(first.lockToken);

    const winner = await executeJob(second, { now: at(LIMITS.jobLeaseMs + 2000), handlers: handlers(stamp) });
    const late = await executeJob(first, { now: at(LIMITS.jobLeaseMs + 9000), handlers: handlers(stamp) });

    expect(winner).toBe("succeeded");
    expect(late).toBe("lost");
    expect(await completeJob(getDb(), first, { now: at(LIMITS.jobLeaseMs + 9000) })).toBe(false);
    expect((await profileRow(owner.profileId)).lastReviewAt?.toISOString()).toBe(at(LIMITS.jobLeaseMs + 2000).toISOString());
    const row = await jobRow(first.id);
    expect(row).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(row?.finishedAt?.toISOString()).toBe(at(LIMITS.jobLeaseMs + 2000).toISOString());
  });

  it("lets a running job finish ahead of an account deletion instead of deadlocking with it", async () => {
    const log = silenceLog();
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    // Holds its locks for a moment, then writes a row that refers to the user and the profile.
    const slow: JobHandler = async (tx, context) => {
      signalStarted();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.insert(activityEntry).values({
        userId: context.job.userId,
        profileId: context.job.profileId,
        jobId: context.job.id,
        kind: "review",
        status: "ok",
        summary: {},
        occurredAt: context.now,
      });
    };

    const execution = executeJob(claim, { now: at(1000), handlers: handlers(slow) });
    await started;
    const deletion = (async () => {
      await getDb().delete(user).where(eq(user.id, owner.userId));
    })();
    const [outcome] = await Promise.all([execution, deletion]);

    expect(outcome).toBe("succeeded");
    expect(log).not.toHaveBeenCalled();
    expect(await getDb().select().from(user)).toEqual([]);
    expect(await getDb().select().from(job)).toEqual([]);
    expect(await getDb().select().from(activityEntry)).toEqual([]);
  });

  it("rolls back a throwing handler and schedules the retry", async () => {
    const log = silenceLog();
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    const broken: JobHandler = async (tx, context) => {
      await stamp(tx, context);
      throw new Error("boom atlas@orbitdiff.test");
    };

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(broken) });

    expect(outcome).toBe("retried");
    expect((await profileRow(owner.profileId)).lastReviewAt).toBeNull();
    expect(await jobRow(claim.id)).toMatchObject({ status: "queued", attempts: 1, lastErrorCode: "handler_error" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain("atlas@orbitdiff.test");
  });

  it("cancels a review job when the profile was paused after it was queued", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner, "daily_review", "2026-09-30");
    const claim = await claimOne();
    await getDb().update(profile).set({ status: "paused", pausedAt: NOW }).where(eq(profile.id, owner.profileId));

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(stamp) });

    expect(outcome).toBe("cancelled");
    expect(await jobRow(claim.id)).toMatchObject({ status: "cancelled", cancelReason: "profile_paused", lockToken: null });
    expect((await profileRow(owner.profileId)).lastReviewAt).toBeNull();
    expect(await activityOf(owner.profileId)).toEqual([]);
  });

  it("still processes an import for a paused profile", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", { profile: { status: "paused" } });
    await queue(owner, "derive_profile");
    const claim = await claimOne();

    expect(await executeJob(claim, { now: at(1000), handlers: handlers(stamp) })).toBe("succeeded");
  });

  it("cancels the job of a suspended user", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(stamp) });

    expect(outcome).toBe("cancelled");
    expect(await jobRow(claim.id)).toMatchObject({ status: "cancelled", cancelReason: "user_suspended" });
    expect((await profileRow(owner.profileId)).lastReviewAt).toBeNull();
  });

  it("cancels the job of a user whose address is not verified", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, owner.userId));

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(stamp) });

    expect(outcome).toBe("cancelled");
    expect(await jobRow(claim.id)).toMatchObject({ status: "cancelled", cancelReason: "user_unverified" });
  });

  it("writes nothing for a job whose profile was removed after the claim", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await getDb().delete(profile).where(eq(profile.id, owner.profileId));
    let ran = false;
    const spy: JobHandler = async () => {
      ran = true;
    };

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(spy) });

    expect(outcome).toBe("cancelled");
    expect(ran).toBe(false);
    expect(await jobRow(claim.id)).toBeUndefined();
  });

  it("writes nothing for a job whose user was deleted after the claim", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queue(owner);
    const claim = await claimOne();
    await getDb().delete(user).where(eq(user.id, owner.userId));
    let ran = false;
    const spy: JobHandler = async () => {
      ran = true;
    };

    const outcome = await executeJob(claim, { now: at(1000), handlers: handlers(spy) });

    expect(outcome).toBe("cancelled");
    expect(ran).toBe(false);
    expect(await getDb().select().from(job)).toEqual([]);
  });
});
