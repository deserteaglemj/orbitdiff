import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { job, profile } from "@/server/db/schema";
import { cancelQueuedJobs, dedupeKey, enqueueJob, toJobDto } from "@/server/jobs/queue";

import { createVerifiedUser, resetDatabase } from "../../helpers";

async function addProfile(userId: string, handle: string): Promise<string> {
  const [row] = await getDb().insert(profile).values({ userId, handle }).returning({ id: profile.id });
  if (!row) throw new Error("profile was not created");
  return row.id;
}

async function ownerWithProfile(email: string, handle: string) {
  const owner = await createVerifiedUser({ email, onboarded: true });
  return { userId: owner.userId, profileId: await addProfile(owner.userId, handle) };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("enqueueJob", () => {
  it("stores a queued job for the profile", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const result = await enqueueJob(getDb(), {
      userId,
      profileId,
      kind: "derive_profile",
      dedupeKey: dedupeKey.derive(profileId, 1),
    });

    expect(result.created).toBe(true);
    expect(result.job).toMatchObject({ userId, profileId, kind: "derive_profile", status: "queued", attempts: 0 });
    const rows = await getDb().select().from(job).where(eq(job.profileId, profileId));
    expect(rows).toHaveLength(1);
  });

  it("returns the existing job for a repeated dedupe key and adds no row", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const input = { userId, profileId, kind: "daily_review" as const, dedupeKey: dedupeKey.daily(profileId, "2026-09-30") };

    const first = await enqueueJob(getDb(), input);
    await getDb().update(job).set({ status: "succeeded", finishedAt: new Date() }).where(eq(job.id, first.job.id));
    const second = await enqueueJob(getDb(), input);

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    const rows = await getDb().select().from(job).where(eq(job.profileId, profileId));
    expect(rows).toHaveLength(1);
  });

  it("returns the active job instead of queueing a second one of the same kind", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const first = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });
    const second = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 2) });

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("queues another job of the kind once the first one finished", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const first = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });
    await getDb().update(job).set({ status: "succeeded", finishedAt: new Date() }).where(eq(job.id, first.job.id));

    const second = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 2) });

    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
  });

  it("lets jobs of different kinds be active together", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const derive = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });
    const review = await enqueueJob(getDb(), { userId, profileId, kind: "daily_review", dedupeKey: dedupeKey.daily(profileId, "2026-09-30") });

    expect(derive.created).toBe(true);
    expect(review.created).toBe(true);
  });

  it("honours a later run time", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const runAfter = new Date("2026-10-01T09:00:00Z");

    const result = await enqueueJob(getDb(), { userId, profileId, kind: "manual_review", dedupeKey: dedupeKey.manual(profileId, "r1"), runAfter });

    expect(result.job.runAfter.toISOString()).toBe(runAfter.toISOString());
  });

  it("is undone when the caller's transaction rolls back", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    await expect(
      getDb().transaction(async (tx) => {
        await enqueueJob(tx, { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    const rows = await getDb().select().from(job).where(eq(job.profileId, profileId));
    expect(rows).toHaveLength(0);
  });
});

describe("cancelQueuedJobs", () => {
  it("cancels queued jobs of the named kinds and records the reason", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const review = await enqueueJob(getDb(), { userId, profileId, kind: "daily_review", dedupeKey: dedupeKey.daily(profileId, "2026-09-30") });
    const derive = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });

    const cancelled = await cancelQueuedJobs(getDb(), { userId, profileId, kinds: ["daily_review", "manual_review"] }, "profile_paused");

    expect(cancelled).toBe(1);
    const [reviewRow] = await getDb().select().from(job).where(eq(job.id, review.job.id));
    const [deriveRow] = await getDb().select().from(job).where(eq(job.id, derive.job.id));
    expect(reviewRow).toMatchObject({ status: "cancelled", cancelReason: "profile_paused" });
    expect(reviewRow?.finishedAt).toBeInstanceOf(Date);
    expect(deriveRow?.status).toBe("queued");
  });

  it("leaves a running job alone", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const review = await enqueueJob(getDb(), { userId, profileId, kind: "daily_review", dedupeKey: dedupeKey.daily(profileId, "2026-09-30") });
    await getDb().update(job).set({ status: "running" }).where(eq(job.id, review.job.id));

    const cancelled = await cancelQueuedJobs(getDb(), { userId, profileId }, "profile_paused");

    expect(cancelled).toBe(0);
  });

  it("does not cancel another user's jobs when given their profile id", async () => {
    const atlas = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const nova = await ownerWithProfile("nova@orbitdiff.test", "nova_labs");
    const review = await enqueueJob(getDb(), { userId: atlas.userId, profileId: atlas.profileId, kind: "daily_review", dedupeKey: dedupeKey.daily(atlas.profileId, "2026-09-30") });

    const cancelled = await cancelQueuedJobs(getDb(), { userId: nova.userId, profileId: atlas.profileId }, "profile_paused");

    expect(cancelled).toBe(0);
    const [row] = await getDb().select().from(job).where(eq(job.id, review.job.id));
    expect(row?.status).toBe("queued");
  });
});

describe("toJobDto", () => {
  it("exposes status and timing without internal lock fields", async () => {
    const { userId, profileId } = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const { job: row } = await enqueueJob(getDb(), { userId, profileId, kind: "derive_profile", dedupeKey: dedupeKey.derive(profileId, 1) });

    const dto = toJobDto(row);

    expect(dto).toEqual({
      id: row.id,
      kind: "derive_profile",
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      runAfter: row.runAfter.toISOString(),
      createdAt: row.createdAt.toISOString(),
      finishedAt: null,
      lastErrorCode: null,
    });
  });
});
