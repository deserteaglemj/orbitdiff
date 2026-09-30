import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/profiles/[id]/review/route";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { job, usageDaily, user } from "@/server/db/schema";
import { runTick } from "@/server/jobs/tick";
import type { JobDto } from "@/server/services/contracts";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { activityOf, jobsOf, type Owner, ownerWithProfile, profileRow } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const MINUTE = 60_000;
const today = () => new Date().toISOString().slice(0, 10);

function review(profileId: string, call: { cookie?: string; origin?: string | null; json?: unknown } = {}) {
  return callRoute(POST, {
    method: "POST",
    url: `/api/profiles/${profileId}/review`,
    params: { id: profileId },
    ...call,
  });
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
}

/** Let the cooldown pass: finish the queued job and move every review time back. */
async function ageReviews(owner: Owner, minutes: number): Promise<void> {
  const earlier = new Date(Date.now() - minutes * MINUTE);
  await getDb()
    .update(job)
    .set({ status: "succeeded", createdAt: earlier, runAfter: earlier, finishedAt: earlier })
    .where(eq(job.profileId, owner.profileId));
}

describe("POST /api/profiles/:id/review", () => {
  it("queues a manual review and returns the job without running it", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(202);
    const body = (await response.json()) as JobDto;
    expect(body).toMatchObject({ kind: "manual_review", status: "queued", attempts: 0, maxAttempts: 3, finishedAt: null });
    expect(Object.keys(body).sort()).toEqual(
      ["attempts", "createdAt", "finishedAt", "id", "kind", "lastErrorCode", "maxAttempts", "runAfter", "status"].sort(),
    );
    const jobs = await jobsOf(owner.profileId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: body.id, userId: owner.userId, kind: "manual_review", status: "queued", attempts: 0 });
    expect(await activityOf(owner.profileId)).toEqual([]);
    expect((await profileRow(owner.profileId)).lastReviewAt).toBeNull();
  });

  it("is run by the next tick, which writes the review entry", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await review(owner.profileId, { cookie: owner.cookie });

    const summary = await runTick({ now: new Date() });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    const [entry] = await activityOf(owner.profileId, "review");
    expect(entry?.summary).toMatchObject({ trigger: "manual", evidence: "missing" });
  });

  it("refuses a second review inside the cooldown and queues nothing", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await review(owner.profileId, { cookie: owner.cookie });

    const second = await review(owner.profileId, { cookie: owner.cookie });

    expect(second.status).toBe(429);
    const error = await errorOf(second);
    expect(error.code).toBe("cooldown");
    const wait = error.details?.retryAfterSeconds as number;
    expect(wait).toBeGreaterThan(LIMITS.reviewCooldownMs / 1000 - 60);
    expect(wait).toBeLessThanOrEqual(LIMITS.reviewCooldownMs / 1000);
    expect(await jobsOf(owner.profileId)).toHaveLength(1);
    const [usage] = await getDb().select().from(usageDaily).where(eq(usageDaily.scopeKey, `profile:${owner.profileId}`));
    expect(usage?.manualReviews).toBe(1);
  });

  it("applies the cooldown after a daily review as well", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", {
      profile: { lastReviewAt: new Date(Date.now() - 5 * MINUTE) },
    });

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(429);
    expect((await errorOf(response)).code).toBe("cooldown");
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("accepts a review again once the cooldown has passed", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await review(owner.profileId, { cookie: owner.cookie });
    await ageReviews(owner, LIMITS.reviewCooldownMs / MINUTE + 1);

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(202);
    expect(await jobsOf(owner.profileId)).toHaveLength(2);
  });

  it("refuses the review after the daily limit for the profile", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    for (let index = 0; index < LIMITS.manualReviewsPerProfilePerDay; index += 1) {
      expect((await review(owner.profileId, { cookie: owner.cookie })).status).toBe(202);
      await ageReviews(owner, LIMITS.reviewCooldownMs / MINUTE + 1);
    }

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(429);
    const error = await errorOf(response);
    expect(error.code).toBe("quota_exhausted");
    expect(error.details).toMatchObject({ quota: "manual_reviews_per_day", limit: LIMITS.manualReviewsPerProfilePerDay });
    expect(await jobsOf(owner.profileId)).toHaveLength(LIMITS.manualReviewsPerProfilePerDay);
    const [usage] = await getDb().select().from(usageDaily).where(eq(usageDaily.scopeKey, `profile:${owner.profileId}`));
    expect(usage).toMatchObject({ day: today(), manualReviews: LIMITS.manualReviewsPerProfilePerDay });
  });

  it("counts the daily limit per profile", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb().insert(usageDaily).values({
      day: today(),
      scopeKey: "profile:00000000-0000-4000-8000-000000000000",
      manualReviews: LIMITS.manualReviewsPerProfilePerDay,
    });

    expect((await review(owner.profileId, { cookie: owner.cookie })).status).toBe(202);
  });

  it("answers conflict for a paused profile and queues nothing", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio", { profile: { status: "paused" } });

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("conflict");
    expect(await jobsOf(owner.profileId)).toEqual([]);
    expect(await getDb().select().from(usageDaily)).toEqual([]);
  });

  it("answers the same not_found for another user's profile, a missing id, and a malformed id", async () => {
    const atlas = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const nova = await ownerWithProfile("nova@orbitdiff.test", "nova_labs");

    const foreign = await review(nova.profileId, { cookie: atlas.cookie });
    const missing = await review("00000000-0000-4000-8000-000000000000", { cookie: atlas.cookie });
    const malformed = await review("not-an-id", { cookie: atlas.cookie });

    const bodies = [await foreign.text(), await missing.text(), await malformed.text()];
    expect([foreign.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(JSON.parse(bodies[0] as string)).toEqual({ error: { code: "not_found", message: "Not found." } });
    expect(new Set(bodies).size).toBe(1);
    expect(await jobsOf(nova.profileId)).toEqual([]);
    expect(await getDb().select().from(usageDaily)).toEqual([]);
  });

  it("requires a signed-in user", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const response = await review(owner.profileId);

    expect(response.status).toBe(401);
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("requires an onboarded user", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb().update(user).set({ onboardedAt: null }).where(eq(user.id, owner.userId));

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).details).toEqual({ onboarding: true });
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("refuses a request from another origin", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const response = await review(owner.profileId, { cookie: owner.cookie, origin: "https://elsewhere.example" });

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("forbidden_origin");
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("answers capacity_paused once the day's job capacity is used up", async () => {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "5" });
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    await getDb().insert(usageDaily).values({ day: today(), scopeKey: "global", jobs: 5 });

    const response = await review(owner.profileId, { cookie: owner.cookie });

    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("capacity_paused");
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("rejects a body with fields", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    const response = await review(owner.profileId, { cookie: owner.cookie, json: { force: true } });

    expect(response.status).toBe(422);
    expect(await jobsOf(owner.profileId)).toEqual([]);
  });

  it("accepts an empty JSON object as the body", async () => {
    const owner = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");

    expect((await review(owner.profileId, { cookie: owner.cookie, json: {} })).status).toBe(202);
  });

  it("does not let another user spend the cooldown or the daily limit of a profile", async () => {
    const atlas = await ownerWithProfile("atlas@orbitdiff.test", "atlas_studio");
    const nova = await createVerifiedUser({ email: "nova@orbitdiff.test", onboarded: true });
    expect((await review(atlas.profileId, { cookie: nova.cookie })).status).toBe(404);

    const response = await review(atlas.profileId, { cookie: atlas.cookie });

    expect(response.status).toBe(202);
    const [usage] = await getDb().select().from(usageDaily).where(eq(usageDaily.scopeKey, `profile:${atlas.profileId}`));
    expect(usage?.manualReviews).toBe(1);
  });
});
