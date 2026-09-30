import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as exportGET } from "@/app/api/account/export/route";
import { GET as activityGET } from "@/app/api/activity/route";
import { GET as countsGET } from "@/app/api/profiles/[id]/counts/route";
import { GET as eventsGET } from "@/app/api/profiles/[id]/events/route";
import { POST as importPOST } from "@/app/api/profiles/[id]/imports/route";
import { GET as relationshipsGET } from "@/app/api/profiles/[id]/relationships/route";
import { DELETE, GET as profileGET, PATCH } from "@/app/api/profiles/[id]/route";
import { GET as snapshotsGET } from "@/app/api/profiles/[id]/snapshots/route";
import { GET as profilesGET } from "@/app/api/profiles/route";
import { closeDb, getDb } from "@/server/db/client";
import {
  activityEntry,
  changeEvent,
  consentRecord,
  exportSnapshot,
  job,
  profile,
  usageDaily,
  user,
} from "@/server/db/schema";
import { dedupeKey, enqueueJob } from "@/server/jobs/queue";
import { exportAccount, getMe, updateMe } from "@/server/services/account";
import { listActivity } from "@/server/services/activity";
import { getCountHistory } from "@/server/services/counts";
import { listEvents } from "@/server/services/events";
import { importExport, listSnapshots } from "@/server/services/imports";
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  setProfileStatus,
} from "@/server/services/profiles";
import { listRelationships } from "@/server/services/relationships";
import { getUserUsage } from "@/server/services/usage";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv, type VerifiedUser } from "../../helpers";
import { expectError } from "../api/support";
import { ATLAS, exportPayload, insertEvents, markDerived, NOVA, NOW, RANDOM_ID, thrown } from "../services/support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

/**
 * Two verified, onboarded users. A (atlas) owns a profile with two imports,
 * export observations, a queued review job, and activity. B (nova) owns a
 * profile of their own with different content. Every test then has B use A's
 * profile id, and a random id, and expects the same `not_found` with A's rows
 * untouched.
 */
interface World {
  a: VerifiedUser;
  b: VerifiedUser;
  aProfile: string;
  bProfile: string;
  /** Strings that belong to A only: ids, the handle, and usernames. */
  aMarkers: string[];
}

const B_PAYLOAD = exportPayload({
  account: "nova_labs",
  followers: ["sunset_field"],
  following: ["sunset_field"],
});

async function world(): Promise<World> {
  const a = await createVerifiedUser({ email: ATLAS, name: "Atlas Owner", onboarded: true });
  const b = await createVerifiedUser({ email: NOVA, name: "Nova Owner", onboarded: true });
  const aProfile = (await createProfile(a.userId, "atlas_studio", NOW)).id;
  const first = await importExport(a.userId, aProfile, exportPayload({ followers: ["ember_lab", "lunar_arch"], following: ["ember_lab", "pixel_forge"] }), NOW);
  const second = await importExport(
    a.userId,
    aProfile,
    exportPayload({ capturedAt: "2026-09-08T12:00:00+00:00", followers: ["ember_lab"], following: ["ember_lab", "pixel_forge"] }),
    NOW,
  );
  await insertEvents(a.userId, aProfile, [{ type: "follower_observed_removed", username: "lunar_arch" }]);
  await markDerived(aProfile);
  await enqueueJob(getDb(), {
    userId: a.userId,
    profileId: aProfile,
    kind: "daily_review",
    dedupeKey: dedupeKey.daily(aProfile, "2026-09-30"),
  });
  const bProfile = (await createProfile(b.userId, "nova_labs", NOW)).id;
  await importExport(b.userId, bProfile, B_PAYLOAD, NOW);
  return {
    a,
    b,
    aProfile,
    bProfile,
    aMarkers: [
      a.userId,
      aProfile,
      first.snapshotId,
      second.snapshotId,
      ATLAS,
      "Atlas Owner",
      "atlas_studio",
      "ember_lab",
      "lunar_arch",
      "pixel_forge",
    ],
  };
}

/** Everything A owns, read straight from the tables. */
async function stateOf(userId: string) {
  const db = getDb();
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return {
    user: await db.select().from(user).where(eq(user.id, userId)),
    consent: sorted(await db.select().from(consentRecord).where(eq(consentRecord.userId, userId))),
    profiles: sorted(await db.select().from(profile).where(eq(profile.userId, userId))),
    snapshots: sorted(await db.select().from(exportSnapshot).where(eq(exportSnapshot.userId, userId))),
    events: sorted(await db.select().from(changeEvent).where(eq(changeEvent.userId, userId))),
    jobs: sorted(await db.select().from(job).where(eq(job.userId, userId))),
    activity: sorted(await db.select().from(activityEntry).where(eq(activityEntry.userId, userId))),
    usage: await db.select().from(usageDaily).where(eq(usageDaily.scopeKey, `user:${userId}`)),
  };
}

function expectNoMarkers(value: unknown, markers: string[]): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const marker of markers) expect(text).not.toContain(marker);
}

describe("services: B cannot reach A's profile", () => {
  /** Run one service call as B against A's id and against a random id; both must be the same not_found. */
  async function sameNotFound(call: (w: World, profileId: string) => Promise<unknown>): Promise<void> {
    const w = await world();
    const before = await stateOf(w.a.userId);
    const foreign = await thrown(() => call(w, w.aProfile));
    const missing = await thrown(() => call(w, RANDOM_ID));
    expect({ code: foreign.code, status: foreign.status, message: foreign.message, details: foreign.details }).toEqual({
      code: "not_found",
      status: 404,
      message: missing.message,
      details: missing.details,
    });
    expect(missing.code).toBe("not_found");
    expect(await stateOf(w.a.userId)).toEqual(before);
  }

  it("getProfile", () => sameNotFound((w, id) => getProfile(w.b.userId, id, NOW)));

  it("setProfileStatus to paused", () => sameNotFound((w, id) => setProfileStatus(w.b.userId, id, "paused", NOW)));

  it("setProfileStatus to active", () => sameNotFound((w, id) => setProfileStatus(w.b.userId, id, "active", NOW)));

  it("deleteProfile", () => sameNotFound((w, id) => deleteProfile(w.b.userId, id)));

  it("importExport with A's handle", () => sameNotFound((w, id) => importExport(w.b.userId, id, exportPayload({ followers: ["sunset_field"] }), NOW)));

  it("importExport with B's own handle", () => sameNotFound((w, id) => importExport(w.b.userId, id, B_PAYLOAD, NOW)));

  it("importExport with an invalid payload still answers not_found", () =>
    sameNotFound((w, id) => importExport(w.b.userId, id, { nonsense: true }, NOW)));

  it("listSnapshots", () => sameNotFound((w, id) => listSnapshots(w.b.userId, id)));

  it("listRelationships", () => sameNotFound((w, id) => listRelationships(w.b.userId, id, {}, NOW)));

  it("listEvents filtered by the profile", () => sameNotFound((w, id) => listEvents(w.b.userId, { profileId: id })));

  it("getCountHistory", () => sameNotFound((w, id) => getCountHistory(w.b.userId, id)));

  it("listActivity filtered by the profile", () => sameNotFound((w, id) => listActivity(w.b.userId, { profileId: id })));
});

describe("services: B's lists and account never contain A's rows", () => {
  it("listProfiles", async () => {
    const w = await world();
    const page = await listProfiles(w.b.userId, {}, NOW);
    expect(page.data.map((item) => item.id)).toEqual([w.bProfile]);
    expect(page.pagination.totalItems).toBe(1);
    expectNoMarkers(page, w.aMarkers);
  });

  it("listEvents without a profile filter", async () => {
    const w = await world();
    const page = await listEvents(w.b.userId, {});
    expect(page.data).toEqual([]);
    expect(page.pagination.totalItems).toBe(0);
    expect((await listEvents(w.a.userId, {})).data).toHaveLength(1);
  });

  it("listEvents searching for one of A's usernames", async () => {
    const w = await world();
    expect((await listEvents(w.b.userId, { q: "lunar_arch" })).data).toEqual([]);
  });

  it("listActivity without a profile filter", async () => {
    const w = await world();
    const page = await listActivity(w.b.userId, {});
    expect(new Set(page.data.map((entry) => entry.profileId))).toEqual(new Set([w.bProfile]));
    expectNoMarkers(page, w.aMarkers);
  });

  it("listActivity searching for A's handle", async () => {
    const w = await world();
    expect((await listActivity(w.b.userId, { q: "atlas" })).data).toEqual([]);
  });

  it("listRelationships of B's own profile", async () => {
    const w = await world();
    const page = await listRelationships(w.b.userId, w.bProfile, {}, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["sunset_field"]);
  });

  it("getMe and the usage counters", async () => {
    const w = await world();
    const me = await getMe(w.b.userId, NOW);
    expect(me).toMatchObject({ id: w.b.userId, email: NOVA });
    expect(me.usage).toMatchObject({ profiles: 1, importsToday: 1 });
    expect(await getUserUsage(w.a.userId, NOW)).toMatchObject({ profiles: 1, importsToday: 2 });
    expectNoMarkers(me, w.aMarkers);
  });

  it("updateMe changes B only", async () => {
    const w = await world();
    const before = await stateOf(w.a.userId);
    await updateMe(w.b.userId, { name: "Nova Renamed", timezone: "Asia/Tokyo", reviewHour: 3 }, NOW);
    expect(await stateOf(w.a.userId)).toEqual(before);
  });

  it("deleteProfile of B's own profile leaves A's rows alone", async () => {
    const w = await world();
    const before = await stateOf(w.a.userId);
    await deleteProfile(w.b.userId, w.bProfile);
    expect(await stateOf(w.a.userId)).toEqual(before);
  });

  it("the same handle in two accounts stays two separate profiles", async () => {
    const w = await world();
    const twin = await createProfile(w.b.userId, "atlas_studio", NOW);
    expect(twin.id).not.toBe(w.aProfile);
    expect(twin).toMatchObject({ evidence: "missing", snapshotCount: 0 });
    expect((await listRelationships(w.b.userId, twin.id, {}, NOW)).data).toEqual([]);
    expect((await getCountHistory(w.b.userId, twin.id)).points).toEqual([]);
  });

  it("exportAccount of B holds none of A's handles, usernames, or ids", async () => {
    const w = await world();
    const exported = await exportAccount(w.b.userId, NOW);
    expect(exported.account.id).toBe(w.b.userId);
    expect(exported.profiles.map((item) => item.id)).toEqual([w.bProfile]);
    expect(exported.snapshots).toHaveLength(1);
    expectNoMarkers(exported, w.aMarkers);
  });

  it("exportAccount of A holds everything of A and nothing of B", async () => {
    const w = await world();
    const text = JSON.stringify(await exportAccount(w.a.userId, NOW));
    for (const marker of w.aMarkers) expect(text).toContain(marker);
    expectNoMarkers(text, [w.b.userId, w.bProfile, NOVA, "Nova Owner", "nova_labs", "sunset_field"]);
  });
});

describe("routes: B using A's profile id gets the same 404 as for a random id", () => {
  type Call = (w: World, profileId: string) => Promise<Response>;

  async function same404(call: Call): Promise<void> {
    const w = await world();
    const before = await stateOf(w.a.userId);
    const foreign = await call(w, w.aProfile);
    const missing = await call(w, RANDOM_ID);
    const foreignBody = await expectError(foreign, 404, "not_found");
    const missingBody = await expectError(missing, 404, "not_found");
    expect(foreignBody).toEqual(missingBody);
    expectNoMarkers(foreignBody, w.aMarkers);
    expect(await stateOf(w.a.userId)).toEqual(before);
  }

  const at = (id: string, path = "") => `/api/profiles/${id}${path}`;

  it("GET /api/profiles/:id", () =>
    same404((w, id) => callRoute(profileGET, { url: at(id), cookie: w.b.cookie, params: { id } })));

  it("PATCH /api/profiles/:id to pause", () =>
    same404((w, id) =>
      callRoute(PATCH, { method: "PATCH", url: at(id), cookie: w.b.cookie, params: { id }, json: { status: "paused" } }),
    ));

  it("PATCH /api/profiles/:id to resume", () =>
    same404((w, id) =>
      callRoute(PATCH, { method: "PATCH", url: at(id), cookie: w.b.cookie, params: { id }, json: { status: "active" } }),
    ));

  it("DELETE /api/profiles/:id", () =>
    same404((w, id) => callRoute(DELETE, { method: "DELETE", url: at(id), cookie: w.b.cookie, params: { id } })));

  it("POST /api/profiles/:id/imports", () =>
    same404((w, id) =>
      callRoute(importPOST, {
        method: "POST",
        url: at(id, "/imports"),
        cookie: w.b.cookie,
        params: { id },
        json: exportPayload({ followers: ["sunset_field"] }),
      }),
    ));

  it("POST /api/profiles/:id/imports with an invalid body", () =>
    same404((w, id) =>
      callRoute(importPOST, {
        method: "POST",
        url: at(id, "/imports"),
        cookie: w.b.cookie,
        params: { id },
        json: { nonsense: true },
      }),
    ));

  it("GET /api/profiles/:id/snapshots", () =>
    same404((w, id) => callRoute(snapshotsGET, { url: at(id, "/snapshots"), cookie: w.b.cookie, params: { id } })));

  it("GET /api/profiles/:id/relationships", () =>
    same404((w, id) =>
      callRoute(relationshipsGET, { url: at(id, "/relationships?q=ember"), cookie: w.b.cookie, params: { id } }),
    ));

  it("GET /api/profiles/:id/events", () =>
    same404((w, id) => callRoute(eventsGET, { url: at(id, "/events"), cookie: w.b.cookie, params: { id } })));

  it("GET /api/profiles/:id/counts", () =>
    same404((w, id) => callRoute(countsGET, { url: at(id, "/counts"), cookie: w.b.cookie, params: { id } })));

  it("GET /api/activity?profileId=", () =>
    same404((w, id) => callRoute(activityGET, { url: `/api/activity?profileId=${id}`, cookie: w.b.cookie })));
});

describe("routes: B's lists and export never contain A's rows", () => {
  it("GET /api/profiles", async () => {
    const w = await world();
    const text = await (await callRoute(profilesGET, { url: "/api/profiles", cookie: w.b.cookie })).text();
    expect(JSON.parse(text).data.map((item: { id: string }) => item.id)).toEqual([w.bProfile]);
    expectNoMarkers(text, w.aMarkers);
  });

  it("GET /api/activity", async () => {
    const w = await world();
    const text = await (await callRoute(activityGET, { url: "/api/activity?pageSize=100", cookie: w.b.cookie })).text();
    expect(JSON.parse(text).data.length).toBeGreaterThan(0);
    expectNoMarkers(text, w.aMarkers);
  });

  it("GET /api/activity searching for A's handle", async () => {
    const w = await world();
    const body = await (await callRoute(activityGET, { url: "/api/activity?q=atlas_studio", cookie: w.b.cookie })).json();
    expect(body.data).toEqual([]);
    expect(body.pagination.totalItems).toBe(0);
  });

  it("GET /api/profiles/:id/events of B's own profile", async () => {
    const w = await world();
    const body = await (
      await callRoute(eventsGET, { url: `/api/profiles/${w.bProfile}/events`, cookie: w.b.cookie, params: { id: w.bProfile } })
    ).json();
    expect(body.data).toEqual([]);
  });

  it("GET /api/account/export", async () => {
    const w = await world();
    const text = await (await callRoute(exportGET, { url: "/api/account/export", cookie: w.b.cookie })).text();
    const body = JSON.parse(text);
    expect(body.account.id).toBe(w.b.userId);
    expect(body.profiles.map((item: { id: string }) => item.id)).toEqual([w.bProfile]);
    expectNoMarkers(text, w.aMarkers);
  });

  it("a path id cannot be overridden by a query or body field naming A", async () => {
    const w = await world();
    const before = await stateOf(w.a.userId);
    const response = await callRoute(profileGET, {
      url: `/api/profiles/${w.bProfile}?userId=${w.a.userId}&profileId=${w.aProfile}`,
      cookie: w.b.cookie,
      params: { id: w.bProfile },
    });
    expect((await response.json()).id).toBe(w.bProfile);
    const patched = await callRoute(PATCH, {
      method: "PATCH",
      url: `/api/profiles/${w.bProfile}`,
      cookie: w.b.cookie,
      params: { id: w.bProfile },
      json: { status: "paused", userId: w.a.userId, profileId: w.aProfile },
    });
    await expectError(patched, 422, "invalid_input");
    expect(await stateOf(w.a.userId)).toEqual(before);
  });
});
