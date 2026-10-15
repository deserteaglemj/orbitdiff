import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { nextReviewAt } from "@/domain/schedule";
import { closeDb, getDb } from "@/server/db/client";
import { profile, user } from "@/server/db/schema";
import { runTick } from "@/server/jobs/tick";

import { resetDatabase } from "../../helpers";
import { activityOf, jobsOf, type Owner, ownerWithProfile, profileRow } from "./support";

const HOUR = 3_600_000;
const CHICAGO = "America/Chicago";

beforeEach(resetDatabase);
afterAll(closeDb);

async function chicagoOwner(start: Date, reviewHour = 9): Promise<Owner> {
  const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", { timezone: CHICAGO });
  await getDb().update(user).set({ reviewHour }).where(eq(user.id, owner.userId));
  await getDb()
    .update(profile)
    .set({ nextReviewAt: nextReviewAt(start, CHICAGO, reviewHour) })
    .where(eq(profile.id, owner.profileId));
  return owner;
}

/** Run the tick once an hour, as the scheduler does, and return how many reviews each run queued. */
async function hourlyTicks(start: Date, hours: number): Promise<number[]> {
  const enqueued: number[] = [];
  for (let hour = 0; hour < hours; hour += 1) {
    const summary = await runTick({ now: new Date(start.getTime() + hour * HOUR) });
    enqueued.push(summary.enqueued);
  }
  return enqueued;
}

async function reviewDates(owner: Owner): Promise<string[]> {
  const reviews = await jobsOf(owner.profileId, "daily_review");
  expect(reviews.every((row) => row.status === "succeeded")).toBe(true);
  return reviews.map((row) => row.dedupeKey.slice(`daily:${owner.profileId}:`.length));
}

describe("daily reviews across clock changes", () => {
  it("reviews once per local date across the spring change of 2026-03-08", async () => {
    // Local midnight on 2026-03-07 in Chicago; the 8th has 23 hours.
    const start = new Date("2026-03-07T06:00:00.000Z");
    const owner = await chicagoOwner(start);

    const enqueued = await hourlyTicks(start, 72);

    expect(await reviewDates(owner)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(enqueued.reduce((sum, count) => sum + count, 0)).toBe(3);
    const entries = await activityOf(owner.profileId, "review");
    expect(entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      "2026-03-07T15:00:00.000Z",
      "2026-03-08T14:00:00.000Z",
      "2026-03-09T14:00:00.000Z",
    ]);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe("2026-03-10T14:00:00.000Z");
  });

  it("reviews once per local date across the autumn change of 2026-11-01", async () => {
    // Local midnight on 2026-10-31 in Chicago; the 1st has 25 hours.
    const start = new Date("2026-10-31T05:00:00.000Z");
    const owner = await chicagoOwner(start);

    const enqueued = await hourlyTicks(start, 72);

    expect(await reviewDates(owner)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(enqueued.reduce((sum, count) => sum + count, 0)).toBe(3);
    const entries = await activityOf(owner.profileId, "review");
    expect(entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      "2026-10-31T14:00:00.000Z",
      "2026-11-01T15:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
    ]);
  });

  it("reviews once on the day its review hour does not exist", async () => {
    const start = new Date("2026-03-07T06:00:00.000Z");
    const owner = await chicagoOwner(start, 2);

    await hourlyTicks(start, 72);

    expect(await reviewDates(owner)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    const entries = await activityOf(owner.profileId, "review");
    // 02:00 does not exist on the 8th: the review runs at 03:00 local, the first valid instant.
    expect(entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      "2026-03-07T08:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-09T07:00:00.000Z",
    ]);
  });

  it("reviews once on the day its review hour happens twice", async () => {
    const start = new Date("2026-10-31T05:00:00.000Z");
    const owner = await chicagoOwner(start, 1);

    await hourlyTicks(start, 72);

    expect(await reviewDates(owner)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    const entries = await activityOf(owner.profileId, "review");
    // 01:00 happens twice on the 1st: only the first occurrence is reviewed.
    expect(entries.map((entry) => entry.occurredAt.toISOString())).toEqual([
      "2026-10-31T06:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-02T07:00:00.000Z",
    ]);
  });

  it("keeps the next day's review when a late run picks up a late-evening review after local midnight", async () => {
    // 23:00 in Asia/Kolkata is 17:30 UTC. The scheduler fires at minute 17, so a run that is
    // 14 minutes late starts at 18:31 UTC, which is 00:01 on the 11th in Kolkata.
    const zone = "Asia/Kolkata";
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", { timezone: zone });
    await getDb().update(user).set({ reviewHour: 23 }).where(eq(user.id, owner.userId));
    await getDb()
      .update(profile)
      .set({ nextReviewAt: nextReviewAt(new Date("2026-06-10T00:00:00.000Z"), zone, 23) })
      .where(eq(profile.id, owner.profileId));
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe("2026-06-10T17:30:00.000Z");

    const late = await runTick({ now: new Date("2026-06-10T18:31:00.000Z") });
    const onTime = await runTick({ now: new Date("2026-06-11T18:17:00.000Z") });

    expect([late.enqueued, onTime.enqueued]).toEqual([1, 1]);
    // Each review is keyed by the local date it was scheduled for, not the date of the run.
    expect(await reviewDates(owner)).toEqual(["2026-06-10", "2026-06-11"]);
    expect(await activityOf(owner.profileId, "review")).toHaveLength(2);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe("2026-06-12T17:30:00.000Z");
  });

  it("does not review the same local date again after the user changes timezone during the day", async () => {
    const morning = new Date("2026-06-10T14:00:00.000Z");
    const owner = await chicagoOwner(new Date("2026-06-10T05:00:00.000Z"));
    const first = await runTick({ now: morning });
    expect(first.enqueued).toBe(1);

    // An hour later the user moves to Los Angeles, where 09:00 on the 10th is still ahead,
    // and the settings change reschedules the profile for it.
    const moved = new Date("2026-06-10T15:00:00.000Z");
    const zone = "America/Los_Angeles";
    await getDb().update(user).set({ timezone: zone }).where(eq(user.id, owner.userId));
    await getDb()
      .update(profile)
      .set({ nextReviewAt: nextReviewAt(moved, zone, 9) })
      .where(eq(profile.id, owner.profileId));
    const again = await runTick({ now: new Date("2026-06-10T16:00:00.000Z") });

    expect(again).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(await reviewDates(owner)).toEqual(["2026-06-10"]);
    expect(await activityOf(owner.profileId, "review")).toHaveLength(1);
    expect((await profileRow(owner.profileId)).nextReviewAt?.toISOString()).toBe("2026-06-11T16:00:00.000Z");
  });
});
