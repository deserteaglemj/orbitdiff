import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { enqueueJob } from "@/server/jobs/queue";
import type { JobKind, ReviewRecord } from "@/server/services/contracts";

import { resetDatabase } from "../../helpers";
import { activityOf, addSnapshot, eventsOf, type Owner, ownerWithProfile, profileRow, runQueued } from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const HOUR = 3_600_000;

beforeEach(resetDatabase);
afterAll(closeDb);

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

async function queueReview(owner: Owner, kind: JobKind = "daily_review") {
  const { job } = await enqueueJob(getDb(), {
    userId: owner.userId,
    profileId: owner.profileId,
    kind,
    dedupeKey: `${kind === "daily_review" ? "daily" : "manual"}:${owner.profileId}:2026-09-30`,
    runAfter: NOW,
  });
  return job;
}

async function reviewOf(owner: Owner): Promise<ReviewRecord> {
  const entries = await activityOf(owner.profileId, "review");
  expect(entries).toHaveLength(1);
  return entries[0]?.summary as ReviewRecord;
}

describe("daily_review", () => {
  it("records that a profile has no import yet", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const queued = await queueReview(owner);

    expect(await runQueued(NOW)).toEqual(["succeeded"]);

    const [entry] = await activityOf(owner.profileId);
    expect(entry).toMatchObject({ userId: owner.userId, jobId: queued.id, kind: "review", status: "ok" });
    expect(entry?.occurredAt.toISOString()).toBe(NOW.toISOString());
    const record: ReviewRecord = {
      trigger: "daily",
      evidence: "missing",
      capturedAt: null,
      ageHours: null,
      followers: null,
      following: null,
    };
    expect(entry?.summary).toEqual(record);
    const after = await profileRow(owner.profileId);
    expect(after.lastReviewAt?.toISOString()).toBe(NOW.toISOString());
    expect(after.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("reports a recent complete export as current, with its age and counts", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, {
      capturedAt: hoursAgo(5.5),
      followers: ["lunar_arch", "nova_labs", "pixel_forge"],
      following: ["ember_lab"],
      completeFollowers: true,
      completeFollowing: true,
    });
    await queueReview(owner);

    await runQueued(NOW);

    expect(await reviewOf(owner)).toEqual({
      trigger: "daily",
      evidence: "ok",
      capturedAt: hoursAgo(5.5),
      ageHours: 5,
      followers: 3,
      following: 1,
    });
  });

  it("reports an export older than a day and a half as stale", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, {
      capturedAt: hoursAgo(49),
      followers: ["lunar_arch"],
      following: ["ember_lab"],
      completeFollowers: true,
      completeFollowing: true,
    });
    await queueReview(owner);

    await runQueued(NOW);

    expect(await reviewOf(owner)).toMatchObject({ evidence: "stale", ageHours: 49, followers: 1, following: 1 });
  });

  it("reports partial coverage as degraded and counts only the complete direction", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, {
      capturedAt: hoursAgo(2),
      followers: ["lunar_arch", "nova_labs"],
      following: ["ember_lab"],
      completeFollowers: true,
      completeFollowing: false,
    });
    await queueReview(owner);

    await runQueued(NOW);

    expect(await reviewOf(owner)).toMatchObject({ evidence: "degraded", ageHours: 2, followers: 2, following: null });
  });

  it("reports an undated export as degraded with no age", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, {
      capturedAt: null,
      followers: ["lunar_arch"],
      following: ["ember_lab"],
      completeFollowers: true,
      completeFollowing: true,
    });
    await queueReview(owner);

    await runQueued(NOW);

    expect(await reviewOf(owner)).toEqual({
      trigger: "daily",
      evidence: "degraded",
      capturedAt: null,
      ageHours: null,
      followers: null,
      following: null,
    });
  });

  it("leaves derived data and the review schedule as they were", async () => {
    const nextReviewAt = new Date("2026-10-01T09:00:00.000Z");
    const summary = { snapshotId: "kept", eventCount: 0 };
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", {
      profile: { nextReviewAt, summary, contentRevision: 4, derivedRevision: 4 },
    });
    await queueReview(owner);

    await runQueued(NOW);

    const after = await profileRow(owner.profileId);
    expect(after).toMatchObject({ summary, contentRevision: 4, derivedRevision: 4 });
    expect(after.nextReviewAt?.toISOString()).toBe(nextReviewAt.toISOString());
    expect(await eventsOf(owner.profileId)).toEqual([]);
  });
});

describe("manual_review", () => {
  it("does the same work and labels the entry as manual", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queueReview(owner, "manual_review");

    expect(await runQueued(NOW)).toEqual(["succeeded"]);

    expect(await reviewOf(owner)).toMatchObject({ trigger: "manual", evidence: "missing" });
    expect((await profileRow(owner.profileId)).lastReviewAt?.toISOString()).toBe(NOW.toISOString());
  });
});
