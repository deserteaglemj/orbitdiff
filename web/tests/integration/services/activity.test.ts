import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { activityEntry } from "@/server/db/schema";
import { listActivity } from "@/server/services/activity";
import type { ActivityDto, ReviewRecord } from "@/server/services/contracts";
import { importExport } from "@/server/services/imports";
import { createProfile, setProfileStatus } from "@/server/services/profiles";

import { createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, exportPayload, insertEvents, markDerived, NOW, RANDOM_ID, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

async function atlasProfile(timezone?: string) {
  const owner = await createVerifiedUser({ email: ATLAS, onboarded: true, timezone });
  const created = await createProfile(owner.userId, "atlas_studio", new Date("2026-09-30T08:00:00Z"));
  return { userId: owner.userId, profileId: created.id };
}

async function only(userId: string, kind: ActivityDto["kind"]): Promise<ActivityDto> {
  const page = await listActivity(userId, { kind });
  if (page.data.length !== 1) throw new Error(`expected one ${kind} entry, found ${page.data.length}`);
  return page.data[0]!;
}

async function addEntry(
  userId: string,
  profileId: string,
  kind: string,
  status: string,
  summary: unknown,
  occurredAt: Date = NOW,
): Promise<void> {
  await getDb().insert(activityEntry).values({ userId, profileId, kind, status, summary, occurredAt });
}

const review = (overrides: Partial<ReviewRecord> = {}): ReviewRecord => ({
  trigger: "daily",
  evidence: "ok",
  capturedAt: "2026-09-30T07:00:00+00:00",
  ageHours: 5,
  followers: 100,
  following: 80,
  ...overrides,
});

const SECOND = exportPayload({
  capturedAt: "2026-09-08T12:00:00+00:00",
  followers: ["ember_lab", "nova_labs"],
  following: ["nova_labs"],
});

describe("listActivity: shape and order", () => {
  it("lists the user's entries newest first with the profile handle", async () => {
    const { userId, profileId } = await atlasProfile();
    await setProfileStatus(userId, profileId, "paused", new Date("2026-09-30T09:00:00Z"));
    await setProfileStatus(userId, profileId, "active", new Date("2026-09-30T10:00:00Z"));
    const page = await listActivity(userId, {});
    expect(page.data.map((entry) => entry.kind)).toEqual(["profile_resumed", "profile_paused", "profile_added"]);
    expect(page.data[0]).toEqual({
      id: expect.any(String),
      profileId,
      profileHandle: "atlas_studio",
      kind: "profile_resumed",
      status: "info",
      occurredAt: "2026-09-30T10:00:00.000Z",
      title: "Profile resumed",
      detail: "Scheduled reviews run again for atlas_studio.",
    });
    expect(page.pagination).toMatchObject({ page: 1, totalItems: 3, totalPages: 1 });
  });

  it("words a profile that was added and one that was paused", async () => {
    const { userId, profileId } = await atlasProfile();
    await setProfileStatus(userId, profileId, "paused", NOW);
    expect(await only(userId, "profile_added")).toMatchObject({
      title: "Profile added",
      detail: "atlas_studio was added. Import an export to store a baseline.",
    });
    expect(await only(userId, "profile_paused")).toMatchObject({
      title: "Profile paused",
      detail: "Scheduled reviews are paused for atlas_studio. Stored imports are unchanged.",
    });
  });
});

describe("listActivity: import wording", () => {
  it("says the first import was stored as the baseline", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    expect(await only(userId, "import_received")).toMatchObject({
      status: "info",
      title: "Import received",
      detail: "Your first import was stored as the baseline and is being processed.",
    });
  });

  it("names the capture date of a later import", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, new Date("2026-09-30T13:00:00Z"));
    const [latest] = (await listActivity(userId, { kind: "import_received" })).data;
    expect(latest?.detail).toBe("An export captured on 8 Sep 2026 was stored and is being processed.");
  });

  it("says a baseline was stored and nothing can be compared yet", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId);
    const entry = await only(userId, "import_processed");
    expect(entry).toMatchObject({
      status: "ok",
      title: "Baseline stored",
      detail: "A baseline was stored. Nothing can be compared yet: differences appear after a second dated import.",
    });
  });

  it("says how many differences were observed between the two capture times", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, NOW);
    await insertEvents(userId, profileId, [
      { type: "follower_observed_added", username: "ember_lab" },
      { type: "following_observed_removed", username: "pixel_forge" },
    ]);
    await markDerived(profileId, { processed: { added: { followers: 1, following: 0 }, removed: { followers: 0, following: 1 } } });
    const entry = await only(userId, "import_processed");
    expect(entry.title).toBe("2 export observations");
    expect(entry.detail).toBe(
      "2 differences were observed in your export between 1 Sep 2026 and 8 Sep 2026. " +
        "These are export observations, not live follows or unfollows.",
    );
  });

  it("uses the singular for one difference", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, NOW);
    await insertEvents(userId, profileId, [{ type: "follower_observed_added", username: "ember_lab" }]);
    await markDerived(profileId);
    const entry = await only(userId, "import_processed");
    expect(entry.title).toBe("1 export observation");
    expect(entry.detail).toContain("1 difference was observed in your export between 1 Sep 2026 and 8 Sep 2026.");
  });

  it("says when two dated imports show no difference", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, NOW);
    await markDerived(profileId);
    const entry = await only(userId, "import_processed");
    expect(entry.title).toBe("No differences observed");
    expect(entry.detail).toBe("No differences were observed in your export between 1 Sep 2026 and 8 Sep 2026.");
  });

  it("says nothing can be compared while no import has a capture time", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ capturedAt: null }), NOW);
    await markDerived(profileId);
    const entry = await only(userId, "import_processed");
    expect(entry.title).toBe("Import processed");
    expect(entry.detail).toBe(
      "No import has a capture time yet, so nothing can be compared. Import an export with its capture time.",
    );
  });

  it("words capture dates in the user's timezone", async () => {
    const { userId, profileId } = await atlasProfile("Pacific/Auckland");
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, NOW);
    await markDerived(profileId);
    // 12:00 UTC is already the next calendar day in Auckland.
    expect((await only(userId, "import_processed")).detail).toContain("between 2 Sep 2026 and 9 Sep 2026");
  });
});

describe("listActivity: review wording", () => {
  it("says how old the evidence is", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "review", "ok", review());
    expect(await only(userId, "review")).toMatchObject({
      title: "Daily review",
      detail: "The current export was captured 5 hours ago, on 30 Sep 2026. It is current. Followers: 100. Following: 80.",
    });
  });

  it("counts the age in days once it passes two days and says the export is stale", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(
      userId,
      profileId,
      "review",
      "ok",
      review({ trigger: "manual", evidence: "stale", capturedAt: "2026-09-20T12:00:00+00:00", ageHours: 240, following: null }),
    );
    expect(await only(userId, "review")).toMatchObject({
      title: "Manual review",
      detail:
        "The current export was captured 10 days ago, on 20 Sep 2026. It is stale: import a newer export to refresh it. Followers: 100.",
    });
  });

  it("says coverage is incomplete for degraded evidence and shows no count it cannot support", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "review", "ok", review({ evidence: "degraded", ageHours: 1, followers: null, following: null }));
    expect((await only(userId, "review")).detail).toBe(
      "The current export was captured 1 hour ago, on 30 Sep 2026. Its coverage is incomplete, so some relationships stay unknown.",
    );
  });

  it("says the age is unknown when the export has no capture time", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "review", "ok", review({ evidence: "degraded", capturedAt: null, ageHours: null, followers: null, following: null }));
    expect((await only(userId, "review")).detail).toBe(
      "The current export has no capture time, so its age is unknown.",
    );
  });

  it("says there is nothing to review before the first import", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "review", "ok", review({ evidence: "missing", capturedAt: null, ageHours: null, followers: null, following: null }));
    expect((await only(userId, "review")).detail).toBe("No export has been imported yet, so there is nothing to review.");
  });
});

describe("listActivity: failure wording", () => {
  it("says processing failed, the last successful result is unchanged, and when that was", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId, { at: new Date("2026-09-29T09:00:00Z") });
    await addEntry(
      userId,
      profileId,
      "job_failed",
      "failed",
      { jobKind: "derive_profile", errorCode: "handler_error", attempts: 3 },
      new Date("2026-09-30T09:00:00Z"),
    );
    const entry = await only(userId, "job_failed");
    expect(entry).toMatchObject({
      status: "failed",
      title: "Processing failed",
      detail: "Processing failed. The last successful result is unchanged; it is from 29 Sep 2026.",
    });
  });

  it("says a review failed when the failed job was a review", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "review", "ok", review(), new Date("2026-09-29T09:00:00Z"));
    await addEntry(
      userId,
      profileId,
      "job_failed",
      "failed",
      { jobKind: "daily_review", errorCode: "database_error", attempts: 3 },
      new Date("2026-09-30T09:00:00Z"),
    );
    expect(await only(userId, "job_failed")).toMatchObject({
      title: "Review failed",
      detail: "The review failed. The last successful result is unchanged; it is from 29 Sep 2026.",
    });
  });

  it("keeps the successful entry next to the failure", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId, { at: new Date("2026-09-29T09:00:00Z") });
    await addEntry(userId, profileId, "job_failed", "failed", {}, new Date("2026-09-30T13:00:00Z"));
    const kinds = (await listActivity(userId, {})).data.map((entry) => entry.kind);
    expect(kinds).toContain("import_processed");
    expect(kinds[0]).toBe("job_failed");
  });

  it("ignores a success that happened after the failure", async () => {
    const { userId, profileId } = await atlasProfile();
    await addEntry(userId, profileId, "job_failed", "failed", {}, new Date("2026-09-29T09:00:00Z"));
    await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId, { at: new Date("2026-09-30T13:00:00Z") });
    expect((await only(userId, "job_failed")).detail).toBe(
      "Processing failed. Nothing was changed, and there is no earlier successful result.",
    );
  });
});

describe("listActivity: filters", () => {
  async function twoProfiles() {
    const { userId, profileId } = await atlasProfile();
    const other = await createProfile(userId, "nova_labs", new Date("2026-09-30T09:00:00Z"));
    await addEntry(userId, other.id, "job_failed", "failed", {});
    return { userId, profileId, otherId: other.id };
  }

  it("filters by profile", async () => {
    const { userId, otherId } = await twoProfiles();
    const page = await listActivity(userId, { profileId: otherId });
    expect(page.data.map((entry) => entry.kind)).toEqual(["job_failed", "profile_added"]);
    expect(new Set(page.data.map((entry) => entry.profileHandle))).toEqual(new Set(["nova_labs"]));
  });

  it("filters by kind", async () => {
    const { userId } = await twoProfiles();
    const page = await listActivity(userId, { kind: "profile_added" });
    expect(page.data.map((entry) => entry.profileHandle)).toEqual(["nova_labs", "atlas_studio"]);
  });

  it("filters by status", async () => {
    const { userId } = await twoProfiles();
    const page = await listActivity(userId, { status: "failed" });
    expect(page.data.map((entry) => entry.kind)).toEqual(["job_failed"]);
  });

  it("filters by a profile handle substring", async () => {
    const { userId } = await twoProfiles();
    const page = await listActivity(userId, { q: "ATLAS" });
    expect(page.data.map((entry) => entry.profileHandle)).toEqual(["atlas_studio"]);
  });

  it("rejects a kind it does not know", async () => {
    const { userId } = await twoProfiles();
    expect((await thrown(() => listActivity(userId, { kind: "login" as never }))).code).toBe("invalid_input");
  });

  it("rejects a status it does not know", async () => {
    const { userId } = await twoProfiles();
    expect((await thrown(() => listActivity(userId, { status: "pending" as never }))).code).toBe("invalid_input");
  });

  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await twoProfiles();
    expect((await thrown(() => listActivity(userId, { profileId: RANDOM_ID }))).code).toBe("not_found");
  });

  it("pages the feed", async () => {
    const { userId } = await twoProfiles();
    const page = await listActivity(userId, { page: 2, pageSize: 2 });
    expect(page.data).toHaveLength(1);
    expect(page.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });
});
