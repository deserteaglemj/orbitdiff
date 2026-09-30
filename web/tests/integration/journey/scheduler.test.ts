import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/server/db/client";
import type { TickSummaryDto } from "@/server/services/contracts";

import { resetDatabase, restoreTestEnv } from "../../helpers";
import {
  addProfile,
  api,
  at,
  ATLAS,
  body,
  FIRST_EXPORT,
  importInto,
  NOVA,
  OWNER,
  readActivity,
  readProfile,
  register,
  runBatch,
  SECOND_EXPORT,
  tickSecret,
} from "./support";

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.useRealTimers();
});
afterAll(closeDb);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOT_FOUND = JSON.stringify({ error: { code: "not_found", message: "Not found." } });
const secret = () => process.env.JOBS_TICK_SECRET as string;

/** What a run that found nothing to do reports. */
const NOTHING = {
  recovered: 0,
  enqueued: 0,
  claimed: 0,
  succeeded: 0,
  failed: 0,
  retried: 0,
  cancelled: 0,
  remaining: 0,
  cleaned: 0,
  pausedForCapacity: false,
};

const lastTick = async () => (await body<{ lastTick: { at: string } | null }>(await api.health())).lastTick;

const plus = (instant: string, ms: number) => new Date(new Date(instant).getTime() + ms);

describe("the batch endpoint without its secret", () => {
  it.each<[string, () => string | undefined]>([
    ["no credential", () => undefined],
    ["a wrong secret", () => `Bearer ${"wrong-".repeat(6)}value`],
    ["the secret without its last character", () => `Bearer ${secret().slice(0, -1)}`],
    ["the secret with one more character", () => `Bearer ${secret()}x`],
    ["the secret under another scheme", () => `Basic ${secret()}`],
    ["the secret without a scheme", () => secret()],
    ["an empty bearer credential", () => "Bearer "],
  ])("answers 404 for %s and runs nothing", async (_label, credential) => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");
    const due = profile.nextReviewAt as string;

    // Called at a moment when a review is due, so a run would leave a trace.
    const refused = await at(due, () => api.tick(credential()));

    expect({ status: refused.status, body: await refused.text() }).toEqual({ status: 404, body: NOT_FOUND });
    expect(await lastTick()).toBeNull();
    expect((await readActivity(atlas.browser, "?kind=review")).data).toEqual([]);
    expect((await readProfile(atlas.browser, profile.id)).nextReviewAt).toBe(due);
  });

  it("answers 404 to a signed-in customer and to the configured admin", async () => {
    const atlas = await register(ATLAS);
    const owner = await register(OWNER);
    expect((await api.adminCapacity(owner.browser)).status).toBe(200);
    const { POST } = await import("@/app/api/jobs/tick/route");

    for (const browser of [atlas.browser, owner.browser]) {
      const refused = await browser.route(POST, { method: "POST", url: "/api/jobs/tick", json: {} });
      expect({ status: refused.status, body: await refused.text() }).toEqual({ status: 404, body: NOT_FOUND });
    }
    expect(await lastTick()).toBeNull();
  });

  it("runs with the secret, and the health endpoint then shows when", async () => {
    const response = await api.tick(tickSecret());
    expect(response.status).toBe(200);
    const summary = (await response.json()) as TickSummaryDto;
    expect(await lastTick()).toEqual({ at: summary.at });
  });
});

describe("a batch run with no due work", () => {
  it("reports zeros on an empty service", async () => {
    const { at: ranAt, durationMs, ...counts } = await runBatch();
    expect(counts).toEqual(NOTHING);
    expect(new Date(ranAt).toISOString()).toBe(ranAt);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports zeros when every import is processed and no review is due, and changes nothing", async () => {
    const atlas = await register(ATLAS);
    const profile = await addProfile(atlas.browser, "atlas_studio");
    await importInto(atlas.browser, profile.id, FIRST_EXPORT);
    const before = await readProfile(atlas.browser, profile.id);
    const feedBefore = await readActivity(atlas.browser);

    const summary = await runBatch();

    expect(summary).toEqual({ ...NOTHING, at: summary.at, durationMs: summary.durationMs });
    expect(await readProfile(atlas.browser, profile.id)).toEqual(before);
    expect(await readActivity(atlas.browser)).toEqual(feedBefore);
  });
});

describe("daily reviews", () => {
  it("creates one review per profile when two runs fall in the same hour", async () => {
    const atlas = await register(ATLAS);
    const studio = await addProfile(atlas.browser, "atlas_studio");
    const labs = await addProfile(atlas.browser, "nova_labs");
    const due = studio.nextReviewAt as string;
    expect(labs.nextReviewAt).toBe(due);

    const first = await at(plus(due, MINUTE), runBatch);
    const second = await at(plus(due, 21 * MINUTE), runBatch);
    const third = await at(plus(due, 59 * MINUTE), runBatch);

    expect(first).toMatchObject({ enqueued: 2, claimed: 2, succeeded: 2, failed: 0 });
    expect(second).toMatchObject({ enqueued: 0, claimed: 0, succeeded: 0 });
    expect(third).toMatchObject({ enqueued: 0, claimed: 0, succeeded: 0 });
    const reviews = (await readActivity(atlas.browser, "?kind=review")).data;
    expect(reviews.map((entry) => entry.profileHandle).sort()).toEqual(["atlas_studio", "nova_labs"]);
    expect(reviews.map((entry) => entry.title)).toEqual(["Daily review", "Daily review"]);
    // The next review of each profile is a day after the one that was due.
    for (const profile of [studio, labs]) {
      expect((await readProfile(atlas.browser, profile.id)).nextReviewAt).toBe(plus(due, 24 * HOUR).toISOString());
    }
  });

  it("creates one review per profile when two runs start at the same moment", async () => {
    const atlas = await register(ATLAS);
    const studio = await addProfile(atlas.browser, "atlas_studio");
    await addProfile(atlas.browser, "nova_labs");
    const due = studio.nextReviewAt as string;

    const [left, right] = await at(due, () => Promise.all([runBatch(), runBatch()]));

    expect(left.enqueued + right.enqueued).toBe(2);
    expect(left.succeeded + right.succeeded).toBe(2);
    expect(left.failed + right.failed).toBe(0);
    const reviews = (await readActivity(atlas.browser, "?kind=review")).data;
    expect(reviews.map((entry) => entry.profileHandle).sort()).toEqual(["atlas_studio", "nova_labs"]);
  });

  it("creates the next review a day later, again one per profile", async () => {
    const atlas = await register(ATLAS);
    const studio = await addProfile(atlas.browser, "atlas_studio");
    const due = studio.nextReviewAt as string;

    expect(await at(due, runBatch)).toMatchObject({ enqueued: 1, succeeded: 1 });
    expect(await at(plus(due, 23 * HOUR), runBatch)).toMatchObject({ enqueued: 0, claimed: 0 });
    expect(await at(plus(due, 24 * HOUR), runBatch)).toMatchObject({ enqueued: 1, succeeded: 1 });
    expect(await at(plus(due, 24 * HOUR + 30 * MINUTE), runBatch)).toMatchObject({ enqueued: 0, claimed: 0 });

    expect((await readActivity(atlas.browser, "?kind=review")).data.map((entry) => entry.occurredAt)).toEqual([
      plus(due, 24 * HOUR).toISOString(),
      due,
    ]);
  });

  it("reviews nobody before the review hour", async () => {
    const atlas = await register(ATLAS);
    const studio = await addProfile(atlas.browser, "atlas_studio");
    const due = studio.nextReviewAt as string;

    expect(await at(plus(due, -MINUTE), runBatch)).toMatchObject({ enqueued: 0, claimed: 0 });
    expect((await readActivity(atlas.browser, "?kind=review")).data).toEqual([]);
  });
});

describe("what a batch run answers", () => {
  it("holds counts and flags only, even after real work for two customers", async () => {
    const atlas = await register(ATLAS, "Atlas Owner");
    const studio = await addProfile(atlas.browser, "atlas_studio");
    await importInto(atlas.browser, studio.id, FIRST_EXPORT);
    await importInto(atlas.browser, studio.id, SECOND_EXPORT);
    const nova = await register(NOVA, "Nova Owner");
    const labs = await addProfile(nova.browser, "nova_labs");
    // The later of the two review times, so both are due even if the customers registered in different hours.
    const due = [studio.nextReviewAt as string, labs.nextReviewAt as string].sort().at(-1) as string;

    const response = await at(due, () => api.tick(tickSecret()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const summary = JSON.parse(text) as Record<string, unknown>;
    expect(summary).toMatchObject({ enqueued: 2, claimed: 2, succeeded: 2 });
    expect(Object.keys(summary).sort()).toEqual(
      [
        "at",
        "cancelled",
        "claimed",
        "cleaned",
        "durationMs",
        "enqueued",
        "failed",
        "pausedForCapacity",
        "recovered",
        "remaining",
        "retried",
        "succeeded",
      ].sort(),
    );
    const { at: ranAt, pausedForCapacity, ...numbers } = summary;
    expect(ranAt).toBe(due);
    expect(typeof pausedForCapacity).toBe("boolean");
    for (const value of Object.values(numbers)) {
      expect(typeof value).toBe("number");
      expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
    }
    // Nothing that identifies a customer, a profile, or an account in an export.
    const personal = [
      atlas.userId,
      nova.userId,
      studio.id,
      labs.id,
      ATLAS,
      NOVA,
      "orbitdiff.test",
      "Atlas Owner",
      "atlas_studio",
      "nova_labs",
      "pixel_forge",
      "lunar_arch",
      "ember_lab",
    ];
    for (const value of personal) expect(text).not.toContain(value);
  });
});
