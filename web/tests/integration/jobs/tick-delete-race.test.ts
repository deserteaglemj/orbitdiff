import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { activityEntry, changeEvent, job, profile, user } from "@/server/db/schema";
import type { JobRow } from "@/server/jobs/queue";
import { runTick } from "@/server/jobs/tick";

import { resetDatabase } from "../../helpers";
import { addSnapshot, type Owner, ownerWithProfile, profileRow, queueDerive } from "./support";

/**
 * The real claim runs unchanged; the hook only lets a test act between the claim and the
 * execution of a job, which is where an account or profile deletion can land.
 */
const race = vi.hoisted(() => ({ afterClaim: null as null | ((rows: JobRow[]) => Promise<void>) }));

vi.mock("@/server/jobs/worker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/jobs/worker")>();
  return {
    ...real,
    claimJobs: async (input: Parameters<typeof real.claimJobs>[0]) => {
      const rows = await real.claimJobs(input);
      if (race.afterClaim) await race.afterClaim(rows);
      return rows;
    },
  };
});

const NOW = new Date("2026-09-30T12:00:00.000Z");

beforeEach(async () => {
  race.afterClaim = null;
  await resetDatabase();
});
afterAll(closeDb);

async function twoOwners(): Promise<{ kept: Owner; removed: Owner }> {
  const kept = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
  const removed = await ownerWithProfile("nova@orbitdiff.test", "nova_labs");
  for (const owner of [kept, removed]) {
    await addSnapshot(owner, { capturedAt: "2026-09-01T12:00:00+00:00", followers: ["pixel_forge"], following: [], completeFollowers: true, completeFollowing: true });
    await addSnapshot(owner, { capturedAt: "2026-09-15T12:00:00+00:00", followers: ["lunar_arch"], following: [], completeFollowers: true, completeFollowing: true });
    await queueDerive(owner, NOW);
  }
  return { kept, removed };
}

describe("a deletion between the claim and the execution of a job", () => {
  it("writes nothing for a deleted user and lets the tick finish", async () => {
    const { kept, removed } = await twoOwners();
    race.afterClaim = async (rows) => {
      if (rows.some((row) => row.userId === removed.userId)) {
        await getDb().delete(user).where(eq(user.id, removed.userId));
      }
    };

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ claimed: 2, succeeded: 1, cancelled: 1, failed: 0, retried: 0 });
    expect(await getDb().select().from(job).where(eq(job.userId, removed.userId))).toEqual([]);
    expect(await getDb().select().from(changeEvent).where(eq(changeEvent.userId, removed.userId))).toEqual([]);
    expect(await getDb().select().from(activityEntry).where(eq(activityEntry.userId, removed.userId))).toEqual([]);
    expect(await profileRow(kept.profileId)).toMatchObject({ derivedRevision: 2 });
  });

  it("writes nothing for a removed profile and lets the tick finish", async () => {
    const { kept, removed } = await twoOwners();
    race.afterClaim = async (rows) => {
      if (rows.some((row) => row.profileId === removed.profileId)) {
        await getDb().delete(profile).where(eq(profile.id, removed.profileId));
      }
    };

    const summary = await runTick({ now: NOW });

    expect(summary).toMatchObject({ claimed: 2, succeeded: 1, cancelled: 1, failed: 0, retried: 0 });
    expect(await getDb().select().from(job).where(eq(job.profileId, removed.profileId))).toEqual([]);
    expect(await getDb().select().from(changeEvent).where(eq(changeEvent.userId, removed.userId))).toEqual([]);
    expect(await getDb().select().from(activityEntry).where(eq(activityEntry.userId, removed.userId))).toEqual([]);
    expect(await profileRow(kept.profileId)).toMatchObject({ derivedRevision: 2 });
  });
});
