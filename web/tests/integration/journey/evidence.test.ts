import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/domain/limits";
import { closeDb } from "@/server/db/client";
import { runTick } from "@/server/jobs/tick";
import type { JobHandler } from "@/server/jobs/worker";
import type { AccountExport } from "@/server/services/account";
import type {
  CountHistoryDto,
  ImportReceiptDto,
  JobDto,
  MeDto,
  Page,
  RelationshipDto,
  SnapshotDto,
} from "@/server/services/contracts";

import { resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { expectError } from "../api/support";
import {
  addProfile,
  api,
  at,
  ATLAS,
  body,
  type Browser,
  type ExportBody,
  FIRST_CAPTURE,
  FIRST_EXPORT,
  importInto,
  kinds,
  readActivity,
  readEvents,
  readProfile,
  register,
  runBatch,
  SECOND_CAPTURE,
  SECOND_EXPORT,
} from "./support";

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(closeDb);

const MINUTE = 60_000;

/** A signed-in, onboarded customer with the profile atlas_studio and nothing imported. */
async function atlasWithProfile(): Promise<{ browser: Browser; profileId: string }> {
  const atlas = await register(ATLAS);
  return { browser: atlas.browser, profileId: (await addProfile(atlas.browser, "atlas_studio")).id };
}

const relationshipsOf = async (browser: Browser, profileId: string) =>
  (await body<Page<RelationshipDto>>(await api.relationships(browser, profileId))).data;

const snapshotsOf = async (browser: Browser, profileId: string) =>
  (await body<Page<SnapshotDto>>(await api.snapshots(browser, profileId))).data;

const downloadOf = async (browser: Browser) => body<AccountExport>(await api.download(browser));

/** Followers only, and nobody declared the list complete. */
const FOLLOWERS_ONLY: ExportBody = {
  account: "atlas_studio",
  capturedAt: FIRST_CAPTURE,
  completeFollowers: false,
  completeFollowing: false,
  followers: ["nova_labs", "pixel_forge"],
  following: null,
  shards: { followers: [0], following: [] },
};

describe("an import with only followers and no completeness declaration", () => {
  it("leaves every value that depends on absence unknown", async () => {
    const { browser, profileId } = await atlasWithProfile();

    const receipt = await importInto(browser, profileId, FOLLOWERS_ONLY);
    expect(receipt).toMatchObject({ current: true, capturedAt: FIRST_CAPTURE });

    const profile = await readProfile(browser, profileId);
    expect(profile).toMatchObject({ processing: false, evidence: "degraded" });
    expect(profile.coverage).toMatchObject({
      followers: { present: true, complete: false, declaredComplete: false, independentlyVerified: false },
      following: { present: false, complete: false, declaredComplete: false },
    });
    // Observed counts are known. Totals, mutuals, and who does not follow back are not.
    expect(profile.metrics).toEqual({
      followers: null,
      following: null,
      mutuals: null,
      notFollowingBack: null,
      followersObserved: 2,
      followingObserved: null,
      reciprocalUnknown: null,
    });
    expect(profile.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["followers_coverage_unknown", "following_coverage_unknown"]),
    );
    // Presence is a fact. Absence from a list that was not supplied is unknown, not false.
    expect(await relationshipsOf(browser, profileId)).toEqual([
      { username: "nova_labs", following: null, followedBy: true, relationship: "unknown" },
      { username: "pixel_forge", following: null, followedBy: true, relationship: "unknown" },
    ]);
    expect(await snapshotsOf(browser, profileId)).toMatchObject([
      { followers: null, following: null, followersObserved: 2, followingObserved: null, isCurrent: true },
    ]);
    // No count without complete coverage, so no count history and no change wording.
    expect(await body<CountHistoryDto>(await api.counts(browser, profileId))).toEqual({
      points: [],
      followersChange: null,
      followingChange: null,
    });
  });

  it("produces no removal when a later export of the same kind lacks a name", async () => {
    const { browser, profileId } = await atlasWithProfile();
    await importInto(browser, profileId, FOLLOWERS_ONLY);

    await importInto(browser, profileId, { ...FOLLOWERS_ONLY, capturedAt: SECOND_CAPTURE, followers: ["nova_labs"] });

    expect(await readProfile(browser, profileId)).toMatchObject({ processing: false, snapshotCount: 2, capturedAt: SECOND_CAPTURE });
    expect(await readEvents(browser, profileId)).toMatchObject({ data: [], pagination: { totalItems: 0 } });
    const processed = (await readActivity(browser, "?kind=import_processed")).data;
    expect(processed.map((entry) => entry.title).sort()).toEqual(["Baseline stored", "No differences observed"]);
  });
});

describe("a partial later export", () => {
  it.each<[string, Partial<ExportBody>]>([
    ["is not declared complete", { completeFollowers: false }],
    ["is declared complete but lacks its first shard", { completeFollowers: true, shards: { followers: [2], following: [0] } }],
  ])("produces no removal when the followers list %s", async (_label, change) => {
    const { browser, profileId } = await atlasWithProfile();
    await importInto(browser, profileId, FIRST_EXPORT);

    // pixel_forge is missing from this list, and ember_lab is new.
    await importInto(browser, profileId, { ...SECOND_EXPORT, ...change });

    const events = (await readEvents(browser, profileId)).data;
    expect(events.map((event) => ({ type: event.type, username: event.username }))).toEqual([
      { type: "follower_observed_added", username: "ember_lab" },
    ]);
    expect(events.some((event) => event.type.endsWith("_removed"))).toBe(false);

    const profile = await readProfile(browser, profileId);
    expect(profile).toMatchObject({ evidence: "degraded", coverage: { followers: { complete: false }, following: { complete: true } } });
    expect(profile.metrics).toMatchObject({ followers: null, followersObserved: 2, following: 2 });
    // lunar_arch is followed; whether it follows back cannot be told from a partial list.
    expect(await relationshipsOf(browser, profileId)).toContainEqual({
      username: "lunar_arch",
      following: true,
      followedBy: null,
      relationship: "unknown",
    });
    // The partial list adds no follower count, so the count history shows no drop.
    const counts = await body<CountHistoryDto>(await api.counts(browser, profileId));
    expect(counts.points.map((point) => point.followers)).toEqual([2, null]);
    expect(counts.followersChange).toBeNull();
  });
});

describe("an undated export", () => {
  const UNDATED: ExportBody = { ...FIRST_EXPORT, capturedAt: null, followers: ["ember_lab"], following: ["ember_lab"] };

  it("never becomes current over a dated one and produces no change entries", async () => {
    const { browser, profileId } = await atlasWithProfile();
    const dated = await importInto(browser, profileId, FIRST_EXPORT);
    const before = await readProfile(browser, profileId);

    const undated = await importInto(browser, profileId, UNDATED);
    expect(undated).toMatchObject({ current: false, capturedAt: null, duplicate: false });

    const after = await readProfile(browser, profileId);
    expect(after).toMatchObject({
      processing: false,
      currentSnapshotId: dated.snapshotId,
      capturedAt: FIRST_CAPTURE,
      snapshotCount: 2,
      metrics: before.metrics,
      coverage: before.coverage,
    });
    expect((await relationshipsOf(browser, profileId)).map((row) => row.username)).toEqual(["lunar_arch", "nova_labs", "pixel_forge"]);
    expect(await readEvents(browser, profileId)).toMatchObject({ data: [], pagination: { totalItems: 0 } });
    expect((await snapshotsOf(browser, profileId)).map((row) => ({ id: row.id, capturedAt: row.capturedAt, isCurrent: row.isCurrent }))).toEqual([
      { id: dated.snapshotId, capturedAt: FIRST_CAPTURE, isCurrent: true },
      { id: undated.snapshotId, capturedAt: null, isCurrent: false },
    ]);
    // An undated export has no place in the count history either.
    expect((await body<CountHistoryDto>(await api.counts(browser, profileId))).points).toHaveLength(1);
  });

  it("gives way to a dated export that arrives later, still with no change entries", async () => {
    const { browser, profileId } = await atlasWithProfile();
    const undated = await importInto(browser, profileId, UNDATED);
    expect(undated.current).toBe(true);
    expect(await readProfile(browser, profileId)).toMatchObject({ currentSnapshotId: undated.snapshotId, capturedAt: null, evidence: "degraded" });

    const dated = await importInto(browser, profileId, FIRST_EXPORT);

    expect(dated.current).toBe(true);
    expect(await readProfile(browser, profileId)).toMatchObject({ currentSnapshotId: dated.snapshotId, capturedAt: FIRST_CAPTURE });
    expect((await readEvents(browser, profileId)).data).toEqual([]);
  });
});

describe("a duplicate import", () => {
  it("creates no job, no activity, and no snapshot, and costs nothing of the daily quota", async () => {
    const { browser, profileId } = await atlasWithProfile();
    const first = await importInto(browser, profileId, FIRST_EXPORT);
    const feedBefore = await readActivity(browser);
    const profileBefore = await readProfile(browser, profileId);
    const downloadBefore = await downloadOf(browser);
    expect(downloadBefore.jobs).toHaveLength(1);

    const again = await body<ImportReceiptDto>(await api.importExport(browser, profileId, FIRST_EXPORT), 200);

    expect(again).toEqual({ ...first, duplicate: true, job: null });
    expect(await readActivity(browser)).toEqual(feedBefore);
    expect(await readProfile(browser, profileId)).toEqual(profileBefore);
    const downloadAfter = await downloadOf(browser);
    expect(downloadAfter.jobs).toEqual(downloadBefore.jobs);
    expect(downloadAfter.activity).toEqual(downloadBefore.activity);
    expect(downloadAfter.snapshots).toEqual(downloadBefore.snapshots);
    expect((await body<MeDto>(await api.me(browser))).usage.importsToday).toBe(1);
    // Nothing is left for the hourly run either.
    expect(await runBatch()).toMatchObject({ enqueued: 0, claimed: 0, remaining: 0 });
  });
});

describe("a derive job that fails", () => {
  it("leaves the last summary and the last success in place and shows the failure next to them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { browser, profileId } = await atlasWithProfile();
    await importInto(browser, profileId, FIRST_EXPORT);
    const good = await readProfile(browser, profileId);
    expect(good).toMatchObject({ processing: false, lastFailureAt: null, metrics: { followers: 2, following: 2, mutuals: 1 } });

    // The second import is stored and queued, and the run after the response does not happen.
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "1" });
    const second = await importInto(browser, profileId, SECOND_EXPORT);
    restoreTestEnv();

    // Three hourly runs in which processing fails: the handler is replaced through the tick's own parameter.
    const broken: JobHandler = async () => {
      throw new Error("boom");
    };
    const handlers = { derive_profile: broken };
    const start = Date.now();
    const times = [0, LIMITS.jobBackoffMs[0], LIMITS.jobBackoffMs[0] + LIMITS.jobBackoffMs[1]].map(
      (offset) => new Date(start + offset),
    );
    expect(await runTick({ now: times[0]!, handlers })).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    // Between attempts the customer still sees the last good result, marked as processing.
    expect(await readProfile(browser, profileId)).toMatchObject({
      processing: true,
      metrics: good.metrics,
      lastSuccessAt: good.lastSuccessAt,
      lastFailureAt: null,
      activeJob: { id: second.job?.id, status: "queued", attempts: 1, lastErrorCode: "handler_error" },
    });
    expect(await runTick({ now: times[1]!, handlers })).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    expect(await runTick({ now: times[2]!, handlers })).toMatchObject({ claimed: 1, retried: 0, failed: 1 });
    expect(log).toHaveBeenCalledTimes(3);

    // The failure is recorded on the profile. The summary, the coverage, and the last success did not move.
    const failed = await readProfile(browser, profileId);
    expect(failed).toMatchObject({
      processing: true,
      activeJob: null,
      lastFailureAt: times[2]!.toISOString(),
      lastFailureCode: "handler_error",
      lastSuccessAt: good.lastSuccessAt,
      metrics: good.metrics,
      coverage: good.coverage,
      coverageLabel: good.coverageLabel,
      snapshotCount: 2,
    });
    // No change entry was written by the failed job.
    expect((await readEvents(browser, profileId)).data).toEqual([]);

    // The feed shows the failure as its own entry, beside the successful baseline.
    const feed = await readActivity(browser);
    expect(kinds(feed)).toEqual(["import_processed", "import_received", "import_received", "job_failed", "profile_added"]);
    const failure = feed.data.find((entry) => entry.kind === "job_failed");
    expect(failure).toMatchObject({
      status: "failed",
      title: "Processing failed",
      occurredAt: times[2]!.toISOString(),
      profileHandle: "atlas_studio",
    });
    expect(failure?.detail).toMatch(/^Processing failed\. The last successful result is unchanged; it is from /);
    expect(feed.data.find((entry) => entry.kind === "import_processed")).toMatchObject({ status: "ok", title: "Baseline stored" });
    expect((await readActivity(browser, "?status=failed")).data.map((entry) => entry.kind)).toEqual(["job_failed"]);
    // The failure message never reaches the customer.
    expect(JSON.stringify([failed, feed])).not.toContain("boom");

    // A later hourly run with working code catches up. The failure stays on record next to the new success.
    const repaired = await at(new Date(times[2]!.getTime() + MINUTE), runBatch);
    expect(repaired).toMatchObject({ enqueued: 1, claimed: 1, succeeded: 1, failed: 0 });
    const healthy = await readProfile(browser, profileId);
    expect(healthy).toMatchObject({ processing: false, lastFailureAt: failed.lastFailureAt, lastFailureCode: "handler_error" });
    expect(new Date(healthy.lastSuccessAt as string).getTime()).toBeGreaterThan(new Date(good.lastSuccessAt as string).getTime());
    expect((await readEvents(browser, profileId)).data.map((event) => event.type)).toEqual([
      "follower_observed_added",
      "follower_observed_removed",
    ]);
    expect(kinds(await readActivity(browser))).toContain("job_failed");
  });
});

describe("pausing a profile", () => {
  it("stops scheduled reviews, and resuming restores them", async () => {
    const { browser, profileId } = await atlasWithProfile();
    await importInto(browser, profileId, FIRST_EXPORT);
    const due = (await readProfile(browser, profileId)).nextReviewAt as string;
    expect(due).not.toBeNull();

    const paused = await body<{ status: string; nextReviewAt: string | null; pausedAt: string | null }>(
      await api.setStatus(browser, profileId, { status: "paused" }),
    );
    expect(paused).toMatchObject({ status: "paused", nextReviewAt: null });
    expect(paused.pausedAt).not.toBeNull();
    expect(await readProfile(browser, profileId)).toMatchObject({ status: "paused", nextReviewAt: null });

    // The hourly run at the review hour finds nothing to review.
    expect(await at(due, runBatch)).toMatchObject({ enqueued: 0, claimed: 0 });
    expect((await readActivity(browser, "?kind=review")).data).toEqual([]);
    // A manual review of a paused profile is refused too.
    expect((await expectError(await api.review(browser, profileId), 409, "conflict")).error.details).toEqual({ paused: true });
    // The stored import is untouched by the pause.
    expect(await readProfile(browser, profileId)).toMatchObject({ snapshotCount: 1, metrics: { followers: 2, following: 2 } });

    const resumed = await body<{ status: string; nextReviewAt: string | null; pausedAt: string | null }>(
      await api.setStatus(browser, profileId, { status: "active" }),
    );
    expect(resumed).toMatchObject({ status: "active", pausedAt: null });
    expect(resumed.nextReviewAt).not.toBeNull();

    expect(await at(resumed.nextReviewAt as string, runBatch)).toMatchObject({ enqueued: 1, claimed: 1, succeeded: 1 });
    const reviews = (await readActivity(browser, "?kind=review")).data;
    expect(reviews.map((entry) => ({ title: entry.title, occurredAt: entry.occurredAt }))).toEqual([
      { title: "Daily review", occurredAt: resumed.nextReviewAt },
    ]);
    expect(kinds(await readActivity(browser))).toEqual(
      ["import_processed", "import_received", "profile_added", "profile_paused", "profile_resumed", "review"].sort(),
    );
  });

  it("cancels a review that was already waiting", async () => {
    const { browser, profileId } = await atlasWithProfile();
    const asked = await body<JobDto>(await api.review(browser, profileId), 202);
    expect((await readProfile(browser, profileId)).activeJob).toMatchObject({ id: asked.id, status: "queued" });

    await body(await api.setStatus(browser, profileId, { status: "paused" }));

    expect((await readProfile(browser, profileId)).activeJob).toBeNull();
    expect((await downloadOf(browser)).jobs).toMatchObject([{ id: asked.id, status: "cancelled", cancelReason: "profile_paused" }]);
    expect(await runBatch()).toMatchObject({ claimed: 0 });
    expect((await readActivity(browser, "?kind=review")).data).toEqual([]);
  });
});

describe("a manual review", () => {
  it("is refused inside the cooldown with the cooldown error, and accepted again after it", async () => {
    const { browser, profileId } = await atlasWithProfile();

    const asked = await body<JobDto>(await api.review(browser, profileId), 202);
    expect(asked).toMatchObject({ kind: "manual_review", status: "queued" });

    // A second request while the first is waiting.
    const waiting = await expectError(await api.review(browser, profileId), 429, "cooldown");
    const seconds = waiting.error.details?.retryAfterSeconds as number;
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(LIMITS.reviewCooldownMs / 1000);
    expect((await downloadOf(browser)).jobs).toHaveLength(1);

    // The hourly run does the review.
    expect(await runBatch()).toMatchObject({ claimed: 1, succeeded: 1 });
    const reviews = (await readActivity(browser, "?kind=review")).data;
    expect(reviews).toMatchObject([
      { title: "Manual review", status: "ok", detail: "No export has been imported yet, so there is nothing to review." },
    ]);

    // Still inside the cooldown after the review ran. Nothing new is queued.
    await expectError(await api.review(browser, profileId), 429, "cooldown");
    expect((await downloadOf(browser)).jobs).toHaveLength(1);

    // After the cooldown the next request is accepted.
    const later = new Date(Date.now() + LIMITS.reviewCooldownMs + MINUTE);
    const next = await at(later, async () => body<JobDto>(await api.review(browser, profileId), 202));
    expect(next.id).not.toBe(asked.id);
    expect((await downloadOf(browser)).jobs).toHaveLength(2);
  });
});
