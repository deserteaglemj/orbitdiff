import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as activityGET } from "@/app/api/activity/route";
import { GET as countsGET } from "@/app/api/profiles/[id]/counts/route";
import { GET as eventsGET } from "@/app/api/profiles/[id]/events/route";
import { POST } from "@/app/api/profiles/[id]/imports/route";
import { GET as relationshipsGET } from "@/app/api/profiles/[id]/relationships/route";
import { POST as reviewPOST } from "@/app/api/profiles/[id]/review/route";
import { GET as snapshotsGET } from "@/app/api/profiles/[id]/snapshots/route";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { changeEvent, exportSnapshot, job, profile, systemState, usageDaily } from "@/server/db/schema";
import { drainJobs } from "@/server/jobs/tick";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";
import { bumpUsage, DATABASE_SIZE_STATE_KEY, GLOBAL_SCOPE, userScope, utcDay } from "@/server/services/usage";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { ATLAS, exportPayload, insertEvents, markDerived, RANDOM_ID, roster } from "../services/support";
import { callProfileRoute, callRaw, expectError, keysOf } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

async function atlasProfile() {
  const owner = await createVerifiedUser({ email: ATLAS, onboarded: true });
  const created = await createProfile(owner.userId, "atlas_studio");
  return { ...owner, profileId: created.id };
}

const importInto = (cookie: string | undefined, id: string, json: unknown, origin?: string | null) =>
  callProfileRoute(POST, id, { method: "POST", url: `/api/profiles/${id}/imports`, cookie, json, origin });

const read = (handler: unknown, cookie: string | undefined, id: string, path: string, query = "") =>
  callProfileRoute(handler, id, { url: `/api/profiles/${id}/${path}${query}`, cookie });

const snapshots = () => getDb().select().from(exportSnapshot);

const SECOND = exportPayload({
  capturedAt: "2026-09-08T12:00:00+00:00",
  followers: ["ember_lab", "nova_labs"],
  following: ["nova_labs"],
});

describe("POST /api/profiles/:id/imports", () => {
  it("stores a baseline and returns the receipt with the queued job", async () => {
    const atlas = await atlasProfile();
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());
    expect(response.status).toBe(201);
    const receipt = await response.json();
    expect(receipt).toMatchObject({
      duplicate: false,
      provenanceEnriched: false,
      current: true,
      capturedAt: "2026-09-01T12:00:00+00:00",
      job: { kind: "derive_profile", status: "queued" },
    });
    const stored = await snapshots();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: receipt.snapshotId, isCurrent: true, userId: atlas.userId });
    expect(await getDb().select().from(job)).toHaveLength(1);
    expect(await getDb().select().from(changeEvent)).toHaveLength(0);
  });

  it("answers 200 with duplicate true and no job for a repeated import", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true, job: null });
    expect(await snapshots()).toHaveLength(1);
  });

  it("answers 409 for different rosters at a stored capture time", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload({ followers: ["ember_lab"] }));
    await expectError(response, 409, "conflict");
  });

  it.each([
    ["an unknown key", { extra: true }],
    ["an unsorted list", { following: ["pixel_forge", "nova_labs"] }],
    ["an uppercase name", { followers: ["Nova_Labs"] }],
    ["a shard list without its direction", { following: null }],
    ["an account other than the profile handle", { account: "nova_labs" }],
    ["a capture time without a timezone", { capturedAt: "2026-09-01T12:00:00" }],
    ["a declaration that is not a boolean", { completeFollowers: 1 }],
    ["a shard number that is not an integer", { shards: { followers: [0.5], following: [0] } }],
    ["a password field", { password: "x" }],
  ])("answers 422 for %s", async (_label, overrides) => {
    const atlas = await atlasProfile();
    await expectError(await importInto(atlas.cookie, atlas.profileId, exportPayload(overrides)), 422, "invalid_input");
    expect(await snapshots()).toHaveLength(0);
  });

  it("answers 422 for a payload with a missing key", async () => {
    const atlas = await atlasProfile();
    const incomplete = exportPayload();
    delete incomplete.shards;
    await expectError(await importInto(atlas.cookie, atlas.profileId, incomplete), 422, "invalid_input");
  });

  it("answers 422 for a body over the import byte cap, without storing anything", async () => {
    const atlas = await atlasProfile();
    const padding = "a".repeat(LIMITS.importBodyBytes);
    const response = await callRaw(POST, {
      method: "POST",
      url: `/api/profiles/${atlas.profileId}/imports`,
      cookie: atlas.cookie,
      params: { id: atlas.profileId },
      body: JSON.stringify({ ...exportPayload(), padding }),
    });
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toEqual({ maxBytes: LIMITS.importBodyBytes });
    expect(await snapshots()).toHaveLength(0);
  });

  it("accepts a large import under the byte cap", async () => {
    const atlas = await atlasProfile();
    const response = await importInto(
      atlas.cookie,
      atlas.profileId,
      exportPayload({ followers: roster(20_000), following: roster(20_000, "lunar_arch") }),
    );
    expect(response.status).toBe(201);
  });

  it("answers 403 without an Origin header and stores nothing", async () => {
    const atlas = await atlasProfile();
    await expectError(await importInto(atlas.cookie, atlas.profileId, exportPayload(), null), 403, "forbidden_origin");
    expect(await snapshots()).toHaveLength(0);
  });

  it("answers 401 without a session", async () => {
    const atlas = await atlasProfile();
    await expectError(await importInto(undefined, atlas.profileId, exportPayload()), 401, "unauthenticated");
  });

  it("answers 404 for a malformed profile id", async () => {
    const atlas = await atlasProfile();
    await expectError(await importInto(atlas.cookie, "not-an-id", exportPayload()), 404, "not_found");
  });

  it("answers 404 for a profile id that does not exist", async () => {
    const atlas = await atlasProfile();
    await expectError(await importInto(atlas.cookie, RANDOM_ID, exportPayload()), 404, "not_found");
  });

  it("answers 429 once the daily import quota is used", async () => {
    const atlas = await atlasProfile();
    await getDb()
      .insert(usageDaily)
      .values({
        day: new Date().toISOString().slice(0, 10),
        scopeKey: userScope(atlas.userId),
        imports: LIMITS.importsPerUserPerDay,
      });
    const body = await expectError(await importInto(atlas.cookie, atlas.profileId, exportPayload()), 429, "quota_exhausted");
    expect(body.error.details).toMatchObject({ quota: "imports_per_day", limit: LIMITS.importsPerUserPerDay });
    expect(await snapshots()).toHaveLength(0);
  });

  it("answers 503 while the database is at its size limit", async () => {
    const atlas = await atlasProfile();
    setTestEnv({ CAPACITY_MAX_DB_BYTES: "1000" });
    await getDb()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 2000, measuredAt: new Date().toISOString() } });
    await expectError(await importInto(atlas.cookie, atlas.profileId, exportPayload()), 503, "capacity_paused");
    expect(await snapshots()).toHaveLength(0);
  });
});

describe("the run right after an import", () => {
  const profileRow = async (id: string) => (await getDb().select().from(profile).where(eq(profile.id, id)))[0]!;

  it("processes the queued job once the response is sent, without waiting for the hourly run", async () => {
    const atlas = await atlasProfile();
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());
    expect((await response.json()).job).toMatchObject({ status: "queued" });
    const row = await profileRow(atlas.profileId);
    expect({ content: row.contentRevision, derived: row.derivedRevision }).toEqual({ content: 1, derived: 1 });
    const [ran] = await getDb().select().from(job).where(eq(job.profileId, atlas.profileId));
    expect(ran?.status).toBe("succeeded");
    expect(await getDb().select().from(changeEvent)).toHaveLength(0);
  });

  it("leaves the job queued while the daily job capacity is used up", async () => {
    const atlas = await atlasProfile();
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "1" });
    await bumpUsage(getDb(), GLOBAL_SCOPE, utcDay(new Date()), "jobs");
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());
    expect(response.status).toBe(201);
    const [waiting] = await getDb().select().from(job).where(eq(job.profileId, atlas.profileId));
    expect(waiting?.status).toBe("queued");
    expect((await profileRow(atlas.profileId)).derivedRevision).toBe(0);
  });

  it("runs only the job of the imported profile", async () => {
    const atlas = await atlasProfile();
    const other = await createProfile(atlas.userId, "nova_labs");
    await importExport(atlas.userId, other.id, exportPayload({ account: "nova_labs" }));
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const [untouched] = await getDb().select().from(job).where(eq(job.profileId, other.id));
    expect(untouched?.status).toBe("queued");
  });

  it("processes the import even when a manual review of the profile was queued first", async () => {
    const atlas = await atlasProfile();
    const asked = await callProfileRoute(reviewPOST, atlas.profileId, {
      method: "POST",
      url: `/api/profiles/${atlas.profileId}/review`,
      cookie: atlas.cookie,
    });
    expect(asked.status).toBe(202);

    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());

    expect(response.status).toBe(201);
    const jobs = await getDb().select().from(job).where(eq(job.profileId, atlas.profileId));
    const statusOf = (kind: string) => jobs.find((row) => row.kind === kind)?.status;
    // The run after an import is for the import. The review waits for the hourly run.
    expect({ derive: statusOf("derive_profile"), review: statusOf("manual_review") }).toEqual({
      derive: "succeeded",
      review: "queued",
    });
    const row = await profileRow(atlas.profileId);
    expect({ content: row.contentRevision, derived: row.derivedRevision }).toEqual({ content: 1, derived: 1 });
  });

  it("queues the job at the time the import was taken, so a run at that time can claim it", async () => {
    const atlas = await atlasProfile();
    // The clock of this process, a minute behind the database's.
    const now = new Date(Date.now() - 60_000);

    const receipt = await importExport(atlas.userId, atlas.profileId, exportPayload(), now);

    expect(receipt.job?.runAfter).toBe(now.toISOString());
    const drained = await drainJobs({ now, limit: 1, profileId: atlas.profileId, kinds: ["derive_profile"] });
    expect(drained).toMatchObject({ claimed: 1, succeeded: 1 });
    expect((await profileRow(atlas.profileId)).derivedRevision).toBe(1);
  });

  it("starts nothing for a duplicate import", async () => {
    const atlas = await atlasProfile();
    await importExport(atlas.userId, atlas.profileId, exportPayload());
    const response = await importInto(atlas.cookie, atlas.profileId, exportPayload());
    expect(response.status).toBe(200);
    const [waiting] = await getDb().select().from(job).where(eq(job.profileId, atlas.profileId));
    expect(waiting?.status).toBe("queued");
  });
});

describe("GET /api/profiles/:id/snapshots", () => {
  it("returns the import history in the list envelope without rosters", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    await importInto(atlas.cookie, atlas.profileId, SECOND);
    const response = await read(snapshotsGET, atlas.cookie, atlas.profileId, "snapshots");
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.data.map((item: { capturedAt: string }) => item.capturedAt)).toEqual([
      "2026-09-08T12:00:00+00:00",
      "2026-09-01T12:00:00+00:00",
    ]);
    expect(body.pagination).toEqual({ page: 1, pageSize: LIMITS.pageSizeDefault, totalItems: 2, totalPages: 1 });
    expect(text).not.toContain("nova_labs");
  });

  it("answers 422 for a page that is not a positive whole number", async () => {
    const atlas = await atlasProfile();
    await expectError(await read(snapshotsGET, atlas.cookie, atlas.profileId, "snapshots", "?page=0"), 422, "invalid_input");
  });

  it("answers 404 for a malformed profile id", async () => {
    const atlas = await atlasProfile();
    await expectError(await read(snapshotsGET, atlas.cookie, "nope", "snapshots"), 404, "not_found");
  });
});

describe("GET /api/profiles/:id/relationships", () => {
  it("returns the accounts of the current snapshot", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const body = await (await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships")).json();
    expect(body.data).toEqual([
      { username: "nova_labs", following: true, followedBy: true, relationship: "mutual" },
      { username: "pixel_forge", following: true, followedBy: false, relationship: "not_following_back" },
    ]);
    expect(body.pagination).toMatchObject({ totalItems: 2 });
  });

  it("filters with q and relationship and pages the result", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const filtered = await (
      await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", "?q=pixel&relationship=not_following_back")
    ).json();
    expect(filtered.data.map((row: { username: string }) => row.username)).toEqual(["pixel_forge"]);
    const paged = await (
      await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", "?page=2&pageSize=1")
    ).json();
    expect(paged.data.map((row: { username: string }) => row.username)).toEqual(["pixel_forge"]);
    expect(paged.pagination).toEqual({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
  });

  it("answers 422 for a relationship it does not know", async () => {
    const atlas = await atlasProfile();
    const response = await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", "?relationship=enemy");
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: ["relationship"] });
  });

  it("answers 422 for a search text that is too long", async () => {
    const atlas = await atlasProfile();
    const response = await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", `?q=${"a".repeat(101)}`);
    await expectError(response, 422, "invalid_input");
  });

  it("answers 422 naming q for a search text with a NUL byte, like every other list", async () => {
    const atlas = await atlasProfile();
    const response = await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", "?q=nova%00");
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: ["q"] });
  });

  it("answers 422 for a page size that is not a number", async () => {
    const atlas = await atlasProfile();
    const response = await read(relationshipsGET, atlas.cookie, atlas.profileId, "relationships", "?pageSize=many");
    await expectError(response, 422, "invalid_input");
  });
});

describe("GET /api/profiles/:id/events", () => {
  async function withEvents() {
    const atlas = await atlasProfile();
    await insertEvents(atlas.userId, atlas.profileId, [
      { type: "follower_observed_added", username: "ember_lab" },
      { type: "following_observed_removed", username: "pixel_forge" },
    ]);
    return atlas;
  }

  it("returns export observations labelled as such", async () => {
    const atlas = await withEvents();
    const body = await (await read(eventsGET, atlas.cookie, atlas.profileId, "events")).json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      profileId: atlas.profileId,
      profileHandle: "atlas_studio",
      type: "follower_observed_added",
      username: "ember_lab",
      evidence: "export_observation",
    });
    expect(body.pagination).toMatchObject({ totalItems: 2 });
  });

  it("filters with type and q", async () => {
    const atlas = await withEvents();
    const byType = await (
      await read(eventsGET, atlas.cookie, atlas.profileId, "events", "?type=following_observed_removed")
    ).json();
    expect(byType.data.map((event: { username: string }) => event.username)).toEqual(["pixel_forge"]);
    const byName = await (await read(eventsGET, atlas.cookie, atlas.profileId, "events", "?q=ember")).json();
    expect(byName.data.map((event: { username: string }) => event.username)).toEqual(["ember_lab"]);
  });

  it.each([
    ["a NUL byte", "?q=ember%00lab"],
    ["only a NUL byte", "?q=%00"],
    ["a line break inside the text", "?q=ember%0Alab"],
    ["an escape character", "?q=%1Bember"],
  ])("answers 422 naming q for a search text with %s, not a server error", async (_label, query) => {
    const atlas = await withEvents();
    const body = await expectError(await read(eventsGET, atlas.cookie, atlas.profileId, "events", query), 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: ["q"] });
  });

  it("answers 422 for a type it does not know", async () => {
    const atlas = await withEvents();
    await expectError(await read(eventsGET, atlas.cookie, atlas.profileId, "events", "?type=unfollowed"), 422, "invalid_input");
  });
});

describe("GET /api/profiles/:id/counts", () => {
  const followersOnly = (count: number, capturedAt: string) =>
    exportPayload({
      capturedAt,
      followers: roster(count),
      following: null,
      shards: { followers: [0], following: [] },
    });

  it("reads 100 then 103 followers as net growth of 3 with no username field anywhere", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, followersOnly(100, "2026-09-01T12:00:00+00:00"));
    await importInto(atlas.cookie, atlas.profileId, followersOnly(103, "2026-09-08T12:00:00+00:00"));

    const response = await read(countsGET, atlas.cookie, atlas.profileId, "counts");

    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.followersChange).toBe("Net growth of 3");
    expect(body.followingChange).toBeNull();
    expect(body.points.map((point: { followers: number }) => point.followers)).toEqual([100, 103]);
    expect([...keysOf(body)].sort()).toEqual([
      "capturedAt",
      "followers",
      "followersChange",
      "following",
      "followingChange",
      "points",
      "snapshotId",
    ]);
    expect(text).not.toContain("pixel_forge");
    expect(text).not.toMatch(/username/i);
  });

  it("answers 404 for a profile id that does not exist", async () => {
    const atlas = await atlasProfile();
    await expectError(await read(countsGET, atlas.cookie, RANDOM_ID, "counts"), 404, "not_found");
  });
});

describe("GET /api/activity", () => {
  const get = (cookie: string | undefined, query = "") => callRoute(activityGET, { url: `/api/activity${query}`, cookie });

  it("returns the feed in the list envelope, worded for the interface", async () => {
    const atlas = await atlasProfile();
    // Stored through the service and derived by the test helper, so this read does not depend on the worker.
    await importExport(atlas.userId, atlas.profileId, exportPayload());
    await markDerived(atlas.profileId, { at: new Date() });
    const body = await (await get(atlas.cookie)).json();
    expect(body.data.map((entry: { kind: string }) => entry.kind).sort()).toEqual([
      "import_processed",
      "import_received",
      "profile_added",
    ]);
    const processed = body.data.find((entry: { kind: string }) => entry.kind === "import_processed");
    expect(processed).toMatchObject({
      profileHandle: "atlas_studio",
      status: "ok",
      title: "Baseline stored",
      detail: "A baseline was stored. Nothing can be compared yet: differences appear after a second dated import.",
    });
    expect(body.pagination).toMatchObject({ page: 1, totalItems: 3 });
  });

  it("filters with profileId, kind, status, and q", async () => {
    const atlas = await atlasProfile();
    await importExport(atlas.userId, atlas.profileId, exportPayload());
    const kinds = async (query: string) =>
      ((await (await get(atlas.cookie, query)).json()).data as Array<{ kind: string }>).map((entry) => entry.kind).sort();
    expect(await kinds(`?profileId=${atlas.profileId}&kind=import_received`)).toEqual(["import_received"]);
    expect(await kinds("?status=info")).toEqual(["import_received", "profile_added"]);
    expect(await kinds("?status=failed")).toEqual([]);
    expect(await kinds("?q=atlas")).toEqual(["import_received", "profile_added"]);
    expect(await kinds("?q=nova")).toEqual([]);
  });

  it.each(["?kind=login", "?status=pending", "?page=0", "?pageSize=x"])("answers 422 for %s", async (query) => {
    const atlas = await atlasProfile();
    await expectError(await get(atlas.cookie, query), 422, "invalid_input");
  });

  it("answers 422 naming q for a search text with a NUL byte, not a server error", async () => {
    const atlas = await atlasProfile();
    const body = await expectError(await get(atlas.cookie, "?q=atlas%00"), 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: ["q"] });
  });

  it("answers 404 for a profileId that does not exist or is malformed", async () => {
    const atlas = await atlasProfile();
    await expectError(await get(atlas.cookie, `?profileId=${RANDOM_ID}`), 404, "not_found");
    await expectError(await get(atlas.cookie, "?profileId=nope"), 404, "not_found");
  });

  it("answers 401 without a session", async () => {
    await expectError(await get(undefined), 401, "unauthenticated");
  });

  it("answers 409 with the onboarding marker before onboarding", async () => {
    const pending = await createVerifiedUser({ email: ATLAS });
    const body = await expectError(await get(pending.cookie), 409, "conflict");
    expect(body.error.details).toEqual({ onboarding: true });
  });
});

describe("the import stores the rows of the signed-in user only", () => {
  it("writes the user id of the session on every row it creates", async () => {
    const atlas = await atlasProfile();
    await importInto(atlas.cookie, atlas.profileId, exportPayload());
    const [snapshot] = await snapshots();
    const [queued] = await getDb().select().from(job).where(eq(job.profileId, atlas.profileId));
    expect(snapshot?.userId).toBe(atlas.userId);
    expect(queued?.userId).toBe(atlas.userId);
  });
});
