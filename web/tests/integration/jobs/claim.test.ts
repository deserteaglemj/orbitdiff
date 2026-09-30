import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { usageDaily } from "@/server/db/schema";
import { dedupeKey, enqueueJob } from "@/server/jobs/queue";
import { claimJobs } from "@/server/jobs/worker";

import { createVerifiedUser, resetDatabase } from "../../helpers";
import { addProfile, jobRow, ownerWithProfile } from "./support";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(resetDatabase);
afterAll(closeDb);

async function queueDerive(userId: string, profileId: string, runAfter: Date = NOW) {
  const { job } = await enqueueJob(getDb(), {
    userId,
    profileId,
    kind: "derive_profile",
    dedupeKey: dedupeKey.derive(profileId, 1),
    runAfter,
  });
  return job;
}

describe("claimJobs", () => {
  it("marks a due queued job running with a fresh lock token and a lease", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const queued = await queueDerive(owner.userId, owner.profileId);

    const claimed = await claimJobs({ now: NOW, limit: 5 });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: queued.id, status: "running", attempts: 1 });
    expect(claimed[0]?.lockToken).toMatch(UUID);
    expect(claimed[0]?.lockedUntil?.getTime()).toBe(NOW.getTime() + LIMITS.jobLeaseMs);
    expect(claimed[0]?.startedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await jobRow(queued.id)).toMatchObject({ status: "running", attempts: 1, lockToken: claimed[0]?.lockToken });
  });

  it("leaves a job whose run time has not come", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const later = await queueDerive(owner.userId, owner.profileId, new Date(NOW.getTime() + 1));

    const claimed = await claimJobs({ now: NOW, limit: 5 });

    expect(claimed).toEqual([]);
    expect(await jobRow(later.id)).toMatchObject({ status: "queued", attempts: 0, lockToken: null });
  });

  it("does not claim a job that is already running", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queueDerive(owner.userId, owner.profileId);
    await claimJobs({ now: NOW, limit: 5 });

    expect(await claimJobs({ now: NOW, limit: 5 })).toEqual([]);
  });

  it("claims no more than the limit, earliest run time first", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const handles = ["atlas_studio", "nova_labs", "pixel_forge"];
    const ids: string[] = [];
    for (const [index, handle] of handles.entries()) {
      const profileId = await addProfile(owner.userId, handle);
      const queued = await queueDerive(owner.userId, profileId, new Date(NOW.getTime() - (index + 1) * 1000));
      ids.push(queued.id);
    }

    const claimed = await claimJobs({ now: NOW, limit: 2 });

    expect(claimed.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    expect((await jobRow(ids[0] as string))?.status).toBe("queued");
  });

  it("claims only the jobs of one profile when asked to", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const first = await addProfile(owner.userId, "atlas_studio");
    const second = await addProfile(owner.userId, "nova_labs");
    await queueDerive(owner.userId, first);
    const wanted = await queueDerive(owner.userId, second);

    const claimed = await claimJobs({ now: NOW, limit: 5, profileId: second });

    expect(claimed.map((row) => row.id)).toEqual([wanted.id]);
  });

  it("never hands the same job to two concurrent claims", async () => {
    const owner = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
    const total = 12;
    for (let index = 0; index < total; index += 1) {
      const profileId = await addProfile(owner.userId, `atlas_studio_${index}`);
      await queueDerive(owner.userId, profileId);
    }

    const batches = await Promise.all([
      claimJobs({ now: NOW, limit: 8 }),
      claimJobs({ now: NOW, limit: 8 }),
      claimJobs({ now: NOW, limit: 8 }),
    ]);

    const ids = batches.flat().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(total);
    const tokens = batches.flat().map((row) => row.lockToken);
    expect(new Set(tokens).size).toBe(total);
  });

  it("counts a job toward the day's total once, on its first claim", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await queueDerive(owner.userId, owner.profileId);

    await claimJobs({ now: NOW, limit: 5 });

    const [usage] = await getDb()
      .select()
      .from(usageDaily)
      .where(and(eq(usageDaily.day, "2026-09-30"), eq(usageDaily.scopeKey, "global")));
    expect(usage?.jobs).toBe(1);
  });
});
