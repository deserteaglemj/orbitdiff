import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { digest } from "@/domain/canonical";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { exportSnapshot, profile } from "@/server/db/schema";
import { deriveProfile, JOB_HANDLERS } from "@/server/jobs/handlers";
import type { ImportProcessedRecord, ProfileSummaryRecord } from "@/server/services/contracts";

import { resetDatabase } from "../../helpers";
import {
  activityOf,
  addSnapshot,
  eventsOf,
  jobRow,
  jobsOf,
  ownerWithProfile,
  profileRow,
  queueDerive,
  runQueued,
} from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const FIRST = "2026-09-01T12:00:00+00:00";
const SECOND = "2026-09-15T12:00:00+00:00";
const THIRD = "2026-09-20T12:00:00+00:00";

beforeEach(resetDatabase);
afterAll(closeDb);

async function snapshotRow(id: string) {
  const [row] = await getDb().select().from(exportSnapshot).where(eq(exportSnapshot.id, id));
  if (!row) throw new Error("snapshot not found");
  return row;
}

const complete = { completeFollowers: true, completeFollowing: true };

describe("derive_profile", () => {
  it("treats the first dated import as a silent baseline", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const snapshotId = await addSnapshot(owner, {
      capturedAt: FIRST,
      followers: ["lunar_arch", "pixel_forge"],
      following: ["ember_lab", "pixel_forge"],
      ...complete,
    });
    const queued = await queueDerive(owner, NOW);

    expect(await runQueued(NOW)).toEqual(["succeeded"]);

    expect(await eventsOf(owner.profileId)).toEqual([]);
    const after = await profileRow(owner.profileId);
    expect(after).toMatchObject({ contentRevision: 1, derivedRevision: 1 });
    expect(after.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
    const summary = after.summary as ProfileSummaryRecord;
    expect(summary).toMatchObject({
      snapshotId,
      capturedAt: "2026-09-01T12:00:00.000Z",
      coverageLabel: "followers user-declared complete; following user-declared complete",
      eventCount: 0,
      baselineOnly: true,
      metrics: { followers: 2, following: 2, mutuals: 1, notFollowingBack: 1 },
    });
    expect(summary.coverage.followers).toEqual({
      present: true,
      complete: true,
      declaredComplete: true,
      shards: [0],
      shardsContiguous: true,
      capturedAtKnown: true,
      independentlyVerified: false,
    });
    const entries = await activityOf(owner.profileId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: owner.userId, jobId: queued.id, kind: "import_processed", status: "ok" });
    expect(entries[0]?.occurredAt.toISOString()).toBe(NOW.toISOString());
    const record: ImportProcessedRecord = {
      snapshotCount: 1,
      datedSnapshotCount: 1,
      baselineOnly: true,
      eventCount: 0,
      added: { followers: 0, following: 0 },
      removed: { followers: 0, following: 0 },
      comparison: { pairs: 0, followers: { added: 0, removed: 0 }, following: { added: 0, removed: 0 } },
    };
    expect(entries[0]?.summary).toEqual(record);
    expect((await jobRow(queued.id))?.status).toBe("succeeded");
  });

  it("stores the differences between two dated imports as export observations over their interval", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const firstId = await addSnapshot(owner, {
      capturedAt: FIRST,
      followers: ["lunar_arch", "pixel_forge"],
      following: ["ember_lab"],
      ...complete,
    });
    await queueDerive(owner, NOW);
    await runQueued(NOW);
    const secondId = await addSnapshot(owner, {
      capturedAt: SECOND,
      followers: ["lunar_arch", "nova_labs"],
      following: ["ember_lab"],
      ...complete,
    });
    const later = new Date(NOW.getTime() + 60_000);
    const queued = await queueDerive(owner, later);

    expect(await runQueued(later)).toEqual(["succeeded"]);

    const previous = await snapshotRow(firstId);
    const current = await snapshotRow(secondId);
    const events = await eventsOf(owner.profileId);
    expect(events.map((event) => [event.position, event.eventType, event.direction, event.username])).toEqual([
      [0, "follower_observed_added", "followers", "nova_labs"],
      [1, "follower_observed_removed", "followers", "pixel_forge"],
    ]);
    for (const event of events) {
      expect(event.userId).toBe(owner.userId);
      expect(event.intervalStart.toISOString()).toBe("2026-09-01T12:00:00.000Z");
      expect(event.intervalEnd.toISOString()).toBe("2026-09-15T12:00:00.000Z");
      expect(event.eventDigest).toBe(
        await digest([previous.snapshotDigest, current.snapshotDigest, event.eventType, event.username]),
      );
    }
    const after = await profileRow(owner.profileId);
    expect(after).toMatchObject({ contentRevision: 2, derivedRevision: 2 });
    expect(after.summary).toMatchObject({ snapshotId: secondId, eventCount: 2, baselineOnly: false });
    const [, processed] = await activityOf(owner.profileId, "import_processed");
    expect(processed).toMatchObject({ jobId: queued.id });
    expect(processed?.summary).toEqual({
      snapshotCount: 2,
      datedSnapshotCount: 2,
      baselineOnly: false,
      eventCount: 2,
      added: { followers: 1, following: 0 },
      removed: { followers: 1, following: 0 },
      comparison: { pairs: 1, followers: { added: 1, removed: 1 }, following: { added: 1, removed: 1 } },
    });
  });

  it("records that nothing could be compared between two exports whose lists were not declared complete", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["nova_labs", "pixel_forge"] });
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["ember_lab", "nova_labs"] });
    await queueDerive(owner, NOW);

    await runQueued(NOW);

    expect(await eventsOf(owner.profileId)).toEqual([]);
    const [entry] = await activityOf(owner.profileId, "import_processed");
    expect(entry?.summary).toMatchObject({
      datedSnapshotCount: 2,
      eventCount: 0,
      comparison: { pairs: 1, followers: { added: 0, removed: 0 }, following: { added: 0, removed: 0 } },
    });
  });

  it("never reports a removal from a later partial import", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch", "pixel_forge"], following: ["ember_lab"], ...complete });
    await addSnapshot(owner, {
      capturedAt: SECOND,
      followers: ["lunar_arch", "nova_labs"],
      following: [],
      completeFollowers: false,
      completeFollowing: false,
    });
    await queueDerive(owner, NOW);

    await runQueued(NOW);

    const events = await eventsOf(owner.profileId);
    expect(events.map((event) => [event.eventType, event.username])).toEqual([["follower_observed_added", "nova_labs"]]);
    expect(events.some((event) => event.eventType.endsWith("_removed"))).toBe(false);
  });

  it("keeps an undated import out of the comparison", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch", "pixel_forge"], following: ["ember_lab"], ...complete });
    await addSnapshot(owner, { capturedAt: null, followers: ["sunset_field"], following: ["sunset_field"], ...complete });
    await queueDerive(owner, NOW);

    await runQueued(NOW);

    expect(await eventsOf(owner.profileId)).toEqual([]);
    const [entry] = await activityOf(owner.profileId, "import_processed");
    expect(entry?.summary).toMatchObject({ snapshotCount: 2, datedSnapshotCount: 1, baselineOnly: true, eventCount: 0 });
    expect((await profileRow(owner.profileId)).summary).toMatchObject({ baselineOnly: true });
  });

  it("compares the dated imports on either side of an undated one", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch"], following: ["ember_lab"], ...complete });
    await addSnapshot(owner, { capturedAt: null, followers: ["sunset_field"], following: ["sunset_field"], ...complete });
    await addSnapshot(owner, { capturedAt: THIRD, followers: ["lunar_arch", "nova_labs"], following: ["ember_lab"], ...complete });
    await queueDerive(owner, NOW);

    await runQueued(NOW);

    const events = await eventsOf(owner.profileId);
    expect(events.map((event) => [event.eventType, event.username])).toEqual([["follower_observed_added", "nova_labs"]]);
    expect(events[0]?.intervalStart.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(events[0]?.intervalEnd.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("writes nothing new when the same revision is derived again", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch", "pixel_forge"], following: ["ember_lab"], ...complete });
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["lunar_arch", "nova_labs"], following: ["ember_lab"], ...complete });
    await queueDerive(owner, NOW);
    await runQueued(NOW);
    const before = { events: await eventsOf(owner.profileId), profile: await profileRow(owner.profileId) };
    const later = new Date(NOW.getTime() + 60_000);
    const again = await queueDerive(owner, later, ":again");

    expect(await runQueued(later)).toEqual(["succeeded"]);

    expect(await eventsOf(owner.profileId)).toEqual(before.events);
    expect(await activityOf(owner.profileId, "import_processed")).toHaveLength(1);
    const after = await profileRow(owner.profileId);
    expect(after.summary).toEqual(before.profile.summary);
    expect(after.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
    expect(await jobRow(again.id)).toMatchObject({ status: "succeeded", result: { skipped: "already_derived" } });
  });

  it("replaces the stored observations as a whole when the history changes", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch", "pixel_forge"], following: ["ember_lab"], ...complete });
    await addSnapshot(owner, { capturedAt: THIRD, followers: ["lunar_arch", "nova_labs"], following: ["ember_lab"], ...complete });
    await queueDerive(owner, NOW);
    await runQueued(NOW);
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["lunar_arch", "nova_labs", "pixel_forge"], following: ["ember_lab"], ...complete });
    const later = new Date(NOW.getTime() + 60_000);
    await queueDerive(owner, later);

    await runQueued(later);

    const events = await eventsOf(owner.profileId);
    expect(events.map((event) => [event.position, event.eventType, event.username, event.intervalEnd.toISOString()])).toEqual([
      [0, "follower_observed_removed", "pixel_forge", "2026-09-20T12:00:00.000Z"],
      [1, "follower_observed_added", "nova_labs", "2026-09-15T12:00:00.000Z"],
    ]);
  });

  it("stores a large set of observations and stops at the per-profile cap", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const extra = 50;
    const added = Array.from({ length: LIMITS.eventsPerProfile + extra }, (_, index) => `ember_lab_${String(index).padStart(5, "0")}`);
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch"], following: [], ...complete });
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["lunar_arch", ...added], following: [], ...complete });
    await queueDerive(owner, NOW);

    expect(await runQueued(NOW)).toEqual(["succeeded"]);

    const events = await eventsOf(owner.profileId);
    expect(events).toHaveLength(LIMITS.eventsPerProfile);
    expect(events[0]).toMatchObject({ position: 0, username: "ember_lab_00000" });
    expect(events.at(-1)).toMatchObject({ position: LIMITS.eventsPerProfile - 1, username: "ember_lab_09999" });
    expect((await profileRow(owner.profileId)).summary).toMatchObject({ eventCount: LIMITS.eventsPerProfile });
  });

  it("clears the summary and the observations of a profile that has no import left", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const first = await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch"], following: [], ...complete });
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["nova_labs"], following: [], ...complete });
    await queueDerive(owner, NOW);
    await runQueued(NOW);
    await getDb().delete(exportSnapshot).where(eq(exportSnapshot.profileId, owner.profileId));
    await getDb().update(profile).set({ contentRevision: 3 }).where(eq(profile.id, owner.profileId));
    const later = new Date(NOW.getTime() + 60_000);
    await queueDerive(owner, later);

    expect(await runQueued(later)).toEqual(["succeeded"]);

    expect(first).toBeTruthy();
    expect(await eventsOf(owner.profileId)).toEqual([]);
    expect(await profileRow(owner.profileId)).toMatchObject({ summary: null, derivedRevision: 3 });
  });

  it("queues a follow-up when the history moved past the revision the job read", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await addSnapshot(owner, { capturedAt: FIRST, followers: ["lunar_arch"], following: [], ...complete });
    const queued = await queueDerive(owner, NOW);
    await addSnapshot(owner, { capturedAt: SECOND, followers: ["nova_labs"], following: [], ...complete });
    // The job read revision 1; the import that made it 2 was handed this running job.
    const stale: typeof deriveProfile = (tx, context) =>
      deriveProfile(tx, { ...context, profile: { ...context.profile, contentRevision: 1 } });

    expect(await runQueued(NOW, { ...JOB_HANDLERS, derive_profile: stale })).toEqual(["succeeded"]);

    expect(await profileRow(owner.profileId)).toMatchObject({ contentRevision: 2, derivedRevision: 1 });
    const jobs = await jobsOf(owner.profileId, "derive_profile");
    expect(jobs).toHaveLength(2);
    const followUp = jobs.find((row) => row.id !== queued.id);
    expect(followUp).toMatchObject({ status: "queued", dedupeKey: `derive:${owner.profileId}:2` });
    expect(followUp?.runAfter.toISOString()).toBe(NOW.toISOString());

    expect(await runQueued(NOW)).toEqual(["succeeded"]);
    expect(await profileRow(owner.profileId)).toMatchObject({ contentRevision: 2, derivedRevision: 2 });
  });
});
