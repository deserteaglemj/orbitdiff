import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb } from "@/server/db/client";
import type {
  CountHistoryDto,
  ImportReceiptDto,
  JobDto,
  MeDto,
  Page,
  ProfileDto,
  RelationshipDto,
  SnapshotDto,
  TickSummaryDto,
} from "@/server/services/contracts";

import { resetDatabase, restoreTestEnv, setTestEnv, signUp } from "../../helpers";
import { expectError, keysOf } from "../api/support";
import {
  addProfile,
  api,
  at,
  ATLAS,
  body,
  Browser,
  FIRST_CAPTURE,
  FIRST_EXPORT,
  importInto,
  importWatched,
  kinds,
  mailbox,
  mailLink,
  readActivity,
  readEvents,
  readProfile,
  register,
  runBatch,
  SECOND_CAPTURE,
  SECOND_EXPORT,
  signInFrom,
} from "./support";

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.useRealTimers();
});
afterAll(closeDb);

const VERSIONS = { termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy };
const NET_CHANGE = /^(?:Net growth of \d+|Net decline of \d+|No net change)$/;
const USERNAMES = ["nova_labs", "pixel_forge", "lunar_arch", "ember_lab"];

describe("one customer, from the first visit to signing out", () => {
  it("registers, imports two exports, reads the results, is reviewed, and signs out", async () => {
    // Registration is open in the test stage: an operator is named, mail is captured, and there is room.
    const health = await body<Record<string, unknown>>(await api.health());
    expect(health).toMatchObject({
      status: "ok",
      stage: "test",
      database: { ok: true },
      mail: { available: true, mode: "captured" },
      registration: { open: true, reason: null, accessCodeRequired: false },
      lastTick: null,
    });

    // Sign up with consent to the current Terms and Privacy notice.
    const browser = new Browser();
    expect((await signUp({ email: ATLAS, name: "Atlas Owner", timezone: "UTC" })).status).toBe(200);
    // The account exists but cannot be used yet: the address is not verified.
    const early = await signInFrom(browser, ATLAS);
    expect({ status: early.status, code: (await early.json()).code }).toEqual({ status: 403, code: "EMAIL_NOT_VERIFIED" });
    expect(browser.cookie).toBeUndefined();

    // The verification mail was captured, not sent.
    const messages = await mailbox(ATLAS);
    expect(messages.map((message) => ({ kind: message.kind, subject: message.subject, to: message.to }))).toEqual([
      { kind: "verify_email", subject: "Confirm your OrbitDiff email", to: ATLAS },
    ]);

    // Opening the link leaves a proof in this browser and returns to the site. It signs nobody in.
    const opened = await browser.auth(await mailLink(ATLAS, "verify_email"));
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toMatch(/^\/(?!\/)/);
    expect(await (await browser.auth("/get-session")).json()).toBeNull();
    await expectError(await api.me(browser), 401, "unauthenticated");

    // The first sign-in from that browser with the right password confirms the address.
    const signedIn = await body<{ user: { id: string; email: string } }>(await signInFrom(browser, ATLAS));
    expect(signedIn.user.email).toBe(ATLAS);
    const userId = signedIn.user.id;

    // Signed in, but not onboarded: the workspace is closed until onboarding is done.
    const before = await body<MeDto>(await api.me(browser));
    expect(before).toMatchObject({ id: userId, email: ATLAS, name: "Atlas Owner", onboarded: false, isAdmin: false });
    expect((await expectError(await api.profiles(browser), 409, "conflict")).error.details).toEqual({ onboarding: true });

    // Onboarding accepts only the current versions of both documents.
    const stale = await expectError(await api.onboard(browser, { ...VERSIONS, termsVersion: "2020-01-01" }), 422, "invalid_input");
    expect(stale.error.details).toEqual({ fields: ["termsVersion"] });
    expect((await body<MeDto>(await api.me(browser))).onboarded).toBe(false);

    const onboarded = await body<MeDto>(await api.onboard(browser, VERSIONS));
    expect(onboarded.onboarded).toBe(true);
    expect(onboarded.consent.terms).toMatchObject({ granted: true, version: CONSENT_VERSIONS.terms });
    expect(onboarded.consent.privacy).toMatchObject({ granted: true, version: CONSENT_VERSIONS.privacy });
    expect((await body<MeDto>(await api.me(browser))).onboarded).toBe(true);
    expect(await body<Page<ProfileDto>>(await api.profiles(browser))).toMatchObject({ data: [], pagination: { totalItems: 0 } });

    // The customer picks the hour of the daily review. Twelve hours from now, so nothing is due during this test.
    const reviewHour = (new Date().getUTCHours() + 12) % 24;
    expect(await body<MeDto>(await api.patchMe(browser, { reviewHour }))).toMatchObject({ timezone: "UTC", reviewHour });

    // Add the profile. Nothing is known about it yet.
    const created = await body<ProfileDto>(await api.addProfile(browser, { handle: "atlas_studio" }), 201);
    expect(created).toMatchObject({
      handle: "atlas_studio",
      status: "active",
      evidence: "missing",
      processing: false,
      snapshotCount: 0,
      metrics: null,
      activeJob: null,
    });
    const profileId = created.id;
    expect((await body<Page<ProfileDto>>(await api.profiles(browser))).data.map((row) => row.id)).toEqual([profileId]);

    // First import: a baseline. The receipt names the stored snapshot and the job that will process it.
    const first = await importInto(browser, profileId, FIRST_EXPORT);
    expect(first).toMatchObject({
      duplicate: false,
      provenanceEnriched: false,
      current: true,
      capturedAt: FIRST_CAPTURE,
      job: { kind: "derive_profile", status: "queued", attempts: 0 },
    });

    // The run after the import processed it: no hourly run was needed. That this run starts after the response
    // is ready, and does not hold it up, is pinned in "the run after an import" below.
    const baseline = await readProfile(browser, profileId);
    expect(baseline).toMatchObject({
      processing: false,
      activeJob: null,
      evidence: "stale",
      currentSnapshotId: first.snapshotId,
      capturedAt: FIRST_CAPTURE,
      snapshotCount: 1,
      lastFailureAt: null,
      coverage: { followers: { complete: true, independentlyVerified: false }, following: { complete: true } },
      metrics: { followers: 2, following: 2, mutuals: 1, notFollowingBack: 1 },
    });
    expect(baseline.lastSuccessAt).not.toBeNull();
    expect((await body<Page<RelationshipDto>>(await api.relationships(browser, profileId))).data).toEqual([
      { username: "lunar_arch", following: true, followedBy: false, relationship: "not_following_back" },
      { username: "nova_labs", following: true, followedBy: true, relationship: "mutual" },
      { username: "pixel_forge", following: false, followedBy: true, relationship: "follows_you" },
    ]);
    // A baseline has nothing to be compared with, so there is no change entry.
    expect(await readEvents(browser, profileId)).toMatchObject({ data: [], pagination: { totalItems: 0 } });
    const afterFirst = await readActivity(browser);
    expect(kinds(afterFirst)).toEqual(["import_processed", "import_received", "profile_added"]);
    expect(afterFirst.data.find((entry) => entry.kind === "import_processed")).toMatchObject({
      status: "ok",
      title: "Baseline stored",
      profileHandle: "atlas_studio",
    });

    // Second import. This time the run after the import does not happen: the day's job capacity is used up.
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "1" });
    const second = await importInto(browser, profileId, SECOND_EXPORT);
    expect(second).toMatchObject({ duplicate: false, current: true, capturedAt: SECOND_CAPTURE, job: { status: "queued" } });

    // The profile shows that it is processing, next to the last derived result, which is still the baseline.
    const waiting = await readProfile(browser, profileId);
    expect(waiting).toMatchObject({
      processing: true,
      activeJob: { id: second.job?.id, kind: "derive_profile", status: "queued" },
      currentSnapshotId: second.snapshotId,
      snapshotCount: 2,
      metrics: baseline.metrics,
      lastSuccessAt: baseline.lastSuccessAt,
    });
    expect((await readEvents(browser, profileId)).data).toEqual([]);

    // An hourly run while the capacity is used up says so and runs nothing.
    expect(await runBatch()).toMatchObject({ pausedForCapacity: true, claimed: 0, succeeded: 0 });
    expect((await readProfile(browser, profileId)).processing).toBe(true);

    // With capacity again, the hourly run completes it.
    restoreTestEnv();
    expect(await runBatch()).toMatchObject({ pausedForCapacity: false, claimed: 1, succeeded: 1, failed: 0, remaining: 0 });
    const processed = await readProfile(browser, profileId);
    expect(processed).toMatchObject({
      processing: false,
      activeJob: null,
      currentSnapshotId: second.snapshotId,
      capturedAt: SECOND_CAPTURE,
      metrics: { followers: 2, following: 2, mutuals: 1 },
    });

    // The differences between the two exports, and nothing else, as export observations.
    const events = await readEvents(browser, profileId);
    expect(events.pagination.totalItems).toBe(2);
    expect(
      events.data.map(({ type, direction, username, intervalStart, intervalEnd, evidence, profileId: owner, profileHandle }) => ({
        type,
        direction,
        username,
        intervalStart,
        intervalEnd,
        evidence,
        owner,
        profileHandle,
      })),
    ).toEqual([
      {
        type: "follower_observed_added",
        direction: "followers",
        username: "ember_lab",
        intervalStart: FIRST_CAPTURE,
        intervalEnd: SECOND_CAPTURE,
        evidence: "export_observation",
        owner: profileId,
        profileHandle: "atlas_studio",
      },
      {
        type: "follower_observed_removed",
        direction: "followers",
        username: "pixel_forge",
        intervalStart: FIRST_CAPTURE,
        intervalEnd: SECOND_CAPTURE,
        evidence: "export_observation",
        owner: profileId,
        profileHandle: "atlas_studio",
      },
    ]);

    // Counts are counts: a net change in words, and never a username.
    const countsResponse = await api.counts(browser, profileId);
    const countsText = await countsResponse.clone().text();
    const counts = await body<CountHistoryDto>(countsResponse);
    expect(counts.points.map(({ capturedAt, followers, following }) => ({ capturedAt, followers, following }))).toEqual([
      { capturedAt: FIRST_CAPTURE, followers: 2, following: 2 },
      { capturedAt: SECOND_CAPTURE, followers: 2, following: 2 },
    ]);
    expect(counts.followersChange).toMatch(NET_CHANGE);
    expect(counts.followingChange).toMatch(NET_CHANGE);
    expect({ followers: counts.followersChange, following: counts.followingChange }).toEqual({
      followers: "No net change",
      following: "No net change",
    });
    for (const username of USERNAMES) expect(countsText).not.toContain(username);
    expect([...keysOf(counts)].some((key) => /user|name|handle/i.test(key))).toBe(false);

    // The import history lists both exports, newest first, without rosters.
    const history = await body<Page<SnapshotDto>>(await api.snapshots(browser, profileId));
    expect(history.data.map((row) => ({ id: row.id, isCurrent: row.isCurrent, followers: row.followers }))).toEqual([
      { id: second.snapshotId, isCurrent: true, followers: 2 },
      { id: first.snapshotId, isCurrent: false, followers: 2 },
    ]);

    // The feed shows each import as received and as processed.
    const feed = await readActivity(browser);
    expect(kinds(feed)).toEqual([
      "import_processed",
      "import_processed",
      "import_received",
      "import_received",
      "profile_added",
    ]);
    expect(feed.data.filter((entry) => entry.kind === "import_processed").map((entry) => entry.title).sort()).toEqual([
      "2 export observations",
      "Baseline stored",
    ]);
    expect((await readActivity(browser, "?kind=review")).data).toEqual([]);

    // The hourly run at the customer's review hour reviews the stored evidence.
    const reviewAt = processed.nextReviewAt as string;
    expect(new Date(reviewAt).getUTCHours()).toBe(reviewHour);
    const reviewTick = await at(reviewAt, runBatch);
    expect(reviewTick).toMatchObject({ at: reviewAt, enqueued: 1, claimed: 1, succeeded: 1, failed: 0 });
    const reviews = await readActivity(browser, "?kind=review");
    expect(reviews.data).toHaveLength(1);
    expect(reviews.data[0]).toMatchObject({
      kind: "review",
      status: "ok",
      title: "Daily review",
      occurredAt: reviewAt,
      profileId,
      profileHandle: "atlas_studio",
    });
    expect(reviews.data[0]?.detail).toContain("It is stale");
    expect(reviews.data[0]?.detail).toContain("Followers: 2. Following: 2.");
    const reviewed = await readProfile(browser, profileId);
    expect(reviewed.lastReviewAt).toBe(reviewAt);
    expect(new Date(reviewed.nextReviewAt as string).getTime()).toBe(new Date(reviewAt).getTime() + 24 * 3_600_000);
    // The review changed no evidence.
    expect(reviewed.metrics).toEqual(processed.metrics);
    expect((await readEvents(browser, profileId)).data.map((event) => event.id)).toEqual(events.data.map((event) => event.id));
    // The health endpoint shows when the batch last ran, and nothing else about it.
    expect((await body<{ lastTick: unknown }>(await api.health())).lastTick).toEqual({ at: reviewAt });

    // A new sign-in from another browser sees the same data.
    const other = new Browser();
    expect((await signInFrom(other, ATLAS)).status).toBe(200);
    expect(other.cookie).not.toBe(browser.cookie);
    expect(await body<MeDto>(await api.me(other))).toMatchObject({ id: userId, onboarded: true, reviewHour });
    expect(await readProfile(other, profileId)).toEqual(await readProfile(browser, profileId));
    expect((await readEvents(other, profileId)).data).toEqual(events.data);
    expect(kinds(await readActivity(other))).toEqual([...kinds(feed), "review"].sort());

    // Signing out ends that login only. Its cookie is refused from then on.
    const cookie = browser.cookie as string;
    expect((await browser.auth("/sign-out", { json: {} })).status).toBe(200);
    await expectError(await api.meWith(cookie), 401, "unauthenticated");
    await expectError(await api.me(browser), 401, "unauthenticated");
    await expectError(await api.profile(browser, profileId), 401, "unauthenticated");
    expect((await body<MeDto>(await api.me(other))).id).toBe(userId);
  });
});

describe("the run after an import", () => {
  it("is still running when the response is ready, so the customer does not wait for it", async () => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");

    const { response, seen } = await importWatched(atlas.browser, profile.id, FIRST_EXPORT);
    // Nothing was running when the import arrived. When the response was ready, the run it started was not done.
    // A handler that waited for the run before answering would show runningAfter: false.
    expect(seen).toEqual({ idleBefore: true, runningAfter: true });
    const receipt = await body<ImportReceiptDto>(response, 201);
    expect(receipt.job).toMatchObject({ kind: "derive_profile", status: "queued" });

    // That run, and no hourly run, processed the import.
    expect(await readProfile(atlas.browser, profile.id)).toMatchObject({
      processing: false,
      activeJob: null,
      currentSnapshotId: receipt.snapshotId,
      metrics: { followers: 2, following: 2, mutuals: 1 },
    });
    expect(kinds(await readActivity(atlas.browser, "?kind=import_processed"))).toEqual(["import_processed"]);
    expect(await runBatch()).toMatchObject({ enqueued: 0, claimed: 0, remaining: 0 });
  });

  it("is not started for an import that changed nothing", async () => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");
    await importInto(atlas.browser, profile.id, FIRST_EXPORT);

    const { response, seen } = await importWatched(atlas.browser, profile.id, FIRST_EXPORT);
    expect(await body<ImportReceiptDto>(response)).toMatchObject({ duplicate: true, job: null });
    expect(seen).toEqual({ idleBefore: true, runningAfter: false });
  });
});

describe("an import whose run after the response did not happen", () => {
  it("shows a baseline as processing, with no result yet, until the hourly run completes it", async () => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");

    // Use up a day's job capacity of one with a manual review of the empty profile.
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "1" });
    const asked = await body<JobDto>(await api.review(atlas.browser, profile.id), 202);
    expect(asked).toMatchObject({ kind: "manual_review", status: "queued" });
    expect(await runBatch()).toMatchObject({ claimed: 1, succeeded: 1, pausedForCapacity: false });

    // The import is stored and queued. Nothing ran after the response.
    const receipt = await body<ImportReceiptDto>(await api.importExport(atlas.browser, profile.id, FIRST_EXPORT), 201);
    expect(receipt.job).toMatchObject({ kind: "derive_profile", status: "queued" });
    const waiting = await readProfile(atlas.browser, profile.id);
    expect(waiting).toMatchObject({
      processing: true,
      activeJob: { id: receipt.job?.id, status: "queued" },
      currentSnapshotId: receipt.snapshotId,
      snapshotCount: 1,
      // Nothing has been derived yet, so there is no summary to show.
      coverage: null,
      metrics: null,
    });
    expect(kinds(await readActivity(atlas.browser, "?kind=import_processed"))).toEqual([]);

    // The hourly run cannot take it either while the capacity is used up.
    expect(await runBatch()).toMatchObject({ pausedForCapacity: true, claimed: 0 });
    expect((await readProfile(atlas.browser, profile.id)).processing).toBe(true);

    // The next run with capacity does.
    restoreTestEnv();
    const summary: TickSummaryDto = await runBatch();
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, remaining: 0, pausedForCapacity: false });
    expect(await readProfile(atlas.browser, profile.id)).toMatchObject({
      processing: false,
      activeJob: null,
      evidence: "stale",
      metrics: { followers: 2, following: 2, mutuals: 1 },
    });
    expect((await readEvents(atlas.browser, profile.id)).data).toEqual([]);
    expect((await readActivity(atlas.browser, "?kind=import_processed")).data.map((entry) => entry.title)).toEqual([
      "Baseline stored",
    ]);
  });

  it("needs no hourly run when the run after the response happens", async () => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");

    await importInto(atlas.browser, profile.id, FIRST_EXPORT);
    await importInto(atlas.browser, profile.id, SECOND_EXPORT);

    expect(await readProfile(atlas.browser, profile.id)).toMatchObject({ processing: false, activeJob: null, snapshotCount: 2 });
    expect((await readEvents(atlas.browser, profile.id)).pagination.totalItems).toBe(2);
    // The hourly run then finds nothing left to do.
    expect(await runBatch()).toMatchObject({ enqueued: 0, claimed: 0, remaining: 0 });
  });
});
