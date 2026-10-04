import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { identifySnapshot } from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import {
  activityEntry,
  changeEvent,
  exportSnapshot,
  job,
  profile,
  systemState,
  usageDaily,
} from "@/server/db/schema";
import { importExport, listSnapshots } from "@/server/services/imports";
import { createProfile, setProfileStatus } from "@/server/services/profiles";
import { DATABASE_SIZE_STATE_KEY, importsToday, userScope } from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { addSnapshot, ATLAS, exportPayload, markDerived, NOW, RANDOM_ID, roster, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

async function atlasProfile() {
  const owner = await createVerifiedUser({ email: ATLAS, onboarded: true });
  const created = await createProfile(owner.userId, "atlas_studio", NOW);
  return { userId: owner.userId, profileId: created.id };
}

const db = () => getDb();
const snapshots = (profileId: string) => db().select().from(exportSnapshot).where(eq(exportSnapshot.profileId, profileId));
const jobs = (profileId: string) => db().select().from(job).where(eq(job.profileId, profileId));
const received = (profileId: string) =>
  db()
    .select()
    .from(activityEntry)
    .where(eq(activityEntry.profileId, profileId))
    .then((rows) => rows.filter((row) => row.kind === "import_received"));
const revision = async (profileId: string) =>
  (await db().select().from(profile).where(eq(profile.id, profileId)))[0]?.contentRevision;

/** Everything an import may write, to prove a refused import wrote nothing. */
async function footprint(profileId: string) {
  return {
    snapshots: (await snapshots(profileId)).length,
    jobs: (await jobs(profileId)).length,
    received: (await received(profileId)).length,
    revision: await revision(profileId),
  };
}

const SECOND = exportPayload({
  capturedAt: "2026-09-08T12:00:00+00:00",
  followers: ["ember_lab", "nova_labs"],
  following: ["nova_labs"],
});

describe("importExport: baseline", () => {
  it("stores the first import as a baseline with one queued derive job and no change entries", async () => {
    const { userId, profileId } = await atlasProfile();

    const receipt = await importExport(userId, profileId, exportPayload(), NOW);

    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ isCurrent: true, userId, followers: ["nova_labs"] });
    expect(await revision(profileId)).toBe(1);
    const queued = await jobs(profileId);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "derive_profile", status: "queued", dedupeKey: `derive:${profileId}:1` });
    expect(await received(profileId)).toHaveLength(1);
    expect(await db().select().from(changeEvent)).toHaveLength(0);
    expect(receipt).toMatchObject({
      snapshotId: stored[0]!.id,
      duplicate: false,
      provenanceEnriched: false,
      current: true,
      capturedAt: "2026-09-01T12:00:00+00:00",
      importedAt: NOW.toISOString(),
    });
    expect(receipt.job).toMatchObject({ id: queued[0]!.id, kind: "derive_profile", status: "queued" });
  });

  it("computes the digests itself, equal to the domain digests", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const expected = await identifySnapshot("atlas_studio", {
      followers: ["nova_labs"],
      following: ["nova_labs", "pixel_forge"],
      shards: { followers: [0], following: [0] },
      capturedAt: "2026-09-01T12:00:00+00:00",
      declarations: { followers: true, following: true },
    });
    const [stored] = await snapshots(profileId);
    expect(stored).toMatchObject({
      contentDigest: expected.contentDigest,
      snapshotDigest: expected.snapshotDigest,
    });
  });

  it("stores effective complete coverage only for a declared, dated, contiguous direction", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ completeFollowing: false }), NOW);
    const [stored] = await snapshots(profileId);
    expect(stored).toMatchObject({
      declaredCompleteFollowers: true,
      declaredCompleteFollowing: false,
      followersComplete: true,
      followingComplete: false,
    });
  });

  it("never stores complete coverage for an undated import", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ capturedAt: null }), NOW);
    const [stored] = await snapshots(profileId);
    expect(stored).toMatchObject({
      capturedAt: null,
      declaredCompleteFollowers: true,
      followersComplete: false,
      followingComplete: false,
    });
  });

  it("stores a missing direction as null, not as an empty list", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(
      userId,
      profileId,
      exportPayload({ following: null, shards: { followers: [0], following: [] } }),
      NOW,
    );
    const [stored] = await snapshots(profileId);
    expect(stored?.following).toBeNull();
    expect(stored?.followingShards).toEqual([]);
  });

  it("records the roster bytes of the snapshot", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const [stored] = await snapshots(profileId);
    expect(stored?.rosterBytes).toBe("nova_labs".length * 2 + "pixel_forge".length);
  });

  it("counts the import against the daily quota", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    expect(await importsToday(userId, NOW)).toBe(1);
  });

  it("accepts an import into a paused profile", async () => {
    const { userId, profileId } = await atlasProfile();
    await setProfileStatus(userId, profileId, "paused", NOW);
    const receipt = await importExport(userId, profileId, exportPayload(), NOW);
    expect(receipt.duplicate).toBe(false);
  });
});

describe("importExport: a second dated import", () => {
  it("stores the second snapshot, makes it current, and queues another derive job", async () => {
    const { userId, profileId } = await atlasProfile();
    const first = await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId);

    const second = await importExport(userId, profileId, SECOND, NOW);

    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(2);
    expect(stored.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([second.snapshotId]);
    expect(second.current).toBe(true);
    expect(await revision(profileId)).toBe(2);
    const all = await jobs(profileId);
    expect(all).toHaveLength(2);
    expect(second.job).toMatchObject({ status: "queued", kind: "derive_profile" });
    expect(second.job?.id).not.toBe(first.job?.id);
    expect(all.find((row) => row.id === second.job?.id)?.dedupeKey).toBe(`derive:${profileId}:2`);
  });

  it("returns the derive job that is already queued instead of adding one", async () => {
    const { userId, profileId } = await atlasProfile();
    const first = await importExport(userId, profileId, exportPayload(), NOW);
    const second = await importExport(userId, profileId, SECOND, NOW);
    expect(second.job?.id).toBe(first.job?.id);
    expect(await jobs(profileId)).toHaveLength(1);
    expect(await revision(profileId)).toBe(2);
  });

  it("writes no change entries itself", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    await importExport(userId, profileId, SECOND, NOW);
    expect(await db().select().from(changeEvent)).toHaveLength(0);
  });
});

describe("importExport: store decisions", () => {
  it("answers a repeated import as a duplicate that changes nothing", async () => {
    const { userId, profileId } = await atlasProfile();
    const first = await importExport(userId, profileId, exportPayload(), NOW);
    await markDerived(profileId);
    const before = await footprint(profileId);

    const again = await importExport(userId, profileId, exportPayload(), new Date("2026-09-30T13:00:00Z"));

    expect(again).toMatchObject({
      snapshotId: first.snapshotId,
      duplicate: true,
      provenanceEnriched: false,
      current: true,
      importedAt: NOW.toISOString(),
      job: null,
    });
    expect(await footprint(profileId)).toEqual(before);
    expect(await importsToday(userId, NOW)).toBe(1);
  });

  it("strengthens a declaration on a duplicate and reprocesses", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ completeFollowing: false }), NOW);
    await markDerived(profileId);

    const again = await importExport(userId, profileId, exportPayload({ completeFollowers: false }), NOW);

    expect(again.duplicate).toBe(true);
    expect(again.job).toMatchObject({ status: "queued" });
    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      declaredCompleteFollowers: true,
      declaredCompleteFollowing: true,
      followersComplete: true,
      followingComplete: true,
    });
    expect(await revision(profileId)).toBe(2);
  });

  it("never weakens a declaration on a duplicate", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const again = await importExport(
      userId,
      profileId,
      exportPayload({ completeFollowers: false, completeFollowing: false }),
      NOW,
    );
    expect(again).toMatchObject({ duplicate: true, job: null });
    const [stored] = await snapshots(profileId);
    expect(stored).toMatchObject({ declaredCompleteFollowers: true, followersComplete: true });
    expect(await revision(profileId)).toBe(1);
  });

  it("enriches a stored undated snapshot in place when the same content arrives dated", async () => {
    const { userId, profileId } = await atlasProfile();
    const undated = await importExport(userId, profileId, exportPayload({ capturedAt: null }), NOW);
    await markDerived(profileId);
    const later = new Date("2026-09-30T13:00:00Z");

    const dated = await importExport(userId, profileId, exportPayload(), later);

    expect(dated).toMatchObject({
      snapshotId: undated.snapshotId,
      duplicate: false,
      provenanceEnriched: true,
      current: true,
      capturedAt: "2026-09-01T12:00:00+00:00",
      importedAt: later.toISOString(),
    });
    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.capturedAt?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(stored[0]).toMatchObject({ followersComplete: true, followingComplete: true, isCurrent: true });
    expect(await revision(profileId)).toBe(2);
    expect(dated.job).toMatchObject({ status: "queued" });
  });

  it("rejects different rosters at a stored capture time as a conflict", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const before = await footprint(profileId);
    const error = await thrown(() =>
      importExport(userId, profileId, exportPayload({ followers: ["ember_lab"] }), NOW),
    );
    expect(error.code).toBe("conflict");
    expect(error.status).toBe(409);
    expect(await footprint(profileId)).toEqual(before);
  });

  it("stores an older dated import without making it current", async () => {
    const { userId, profileId } = await atlasProfile();
    const newer = await importExport(userId, profileId, SECOND, NOW);
    const older = await importExport(userId, profileId, exportPayload(), NOW);
    expect(older).toMatchObject({ duplicate: false, current: false });
    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(2);
    expect(stored.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([newer.snapshotId]);
    expect(await revision(profileId)).toBe(2);
  });

  it("stores an undated import after a dated one without making it current", async () => {
    const { userId, profileId } = await atlasProfile();
    const dated = await importExport(userId, profileId, exportPayload(), NOW);
    const undated = await importExport(
      userId,
      profileId,
      exportPayload({ capturedAt: null, followers: ["ember_lab"] }),
      NOW,
    );
    expect(undated).toMatchObject({ duplicate: false, current: false, capturedAt: null });
    const stored = await snapshots(profileId);
    expect(stored.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([dated.snapshotId]);
  });

  it("makes a dated import current over an undated current snapshot with other content", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ capturedAt: null, followers: ["ember_lab"] }), NOW);
    const dated = await importExport(userId, profileId, exportPayload(), NOW);
    expect(dated.current).toBe(true);
    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(2);
    expect(stored.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([dated.snapshotId]);
  });
});

describe("importExport: limits", () => {
  it("refuses with quota_exhausted once the profile holds the snapshot limit", async () => {
    const { userId, profileId } = await atlasProfile();
    for (let index = 0; index < LIMITS.snapshotsPerProfile; index += 1) {
      await addSnapshot(userId, profileId, {
        capturedAt: new Date(Date.UTC(2026, 7, 1 + index)),
        isCurrent: index === LIMITS.snapshotsPerProfile - 1,
      });
    }
    const error = await thrown(() => importExport(userId, profileId, exportPayload(), NOW));
    expect(error.code).toBe("quota_exhausted");
    expect(await snapshots(profileId)).toHaveLength(LIMITS.snapshotsPerProfile);
    expect(await jobs(profileId)).toHaveLength(0);
  });

  it("rejects more usernames than one snapshot may hold", async () => {
    const { userId, profileId } = await atlasProfile();
    const tooMany = roster(LIMITS.accountsPerSnapshot + 1);
    const error = await thrown(() =>
      importExport(
        userId,
        profileId,
        exportPayload({ followers: tooMany, following: null, shards: { followers: [0], following: [] } }),
        NOW,
      ),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.details).toMatchObject({ reason: "too_large" });
    expect(await snapshots(profileId)).toHaveLength(0);
  });

  it("accepts exactly the username limit", async () => {
    const { userId, profileId } = await atlasProfile();
    const full = roster(LIMITS.accountsPerSnapshot);
    const receipt = await importExport(
      userId,
      profileId,
      exportPayload({ followers: full, following: null, shards: { followers: [0], following: [] } }),
      NOW,
    );
    expect(receipt.duplicate).toBe(false);
  });

  it("refuses with quota_exhausted once the daily import quota is used", async () => {
    const { userId, profileId } = await atlasProfile();
    await db()
      .insert(usageDaily)
      .values({ day: "2026-09-30", scopeKey: userScope(userId), imports: LIMITS.importsPerUserPerDay });
    const error = await thrown(() => importExport(userId, profileId, exportPayload(), NOW));
    expect(error.code).toBe("quota_exhausted");
    expect(error.details).toMatchObject({ quota: "imports_per_day" });
    expect(await footprint(profileId)).toEqual({ snapshots: 0, jobs: 0, received: 0, revision: 0 });
  });

  it("allows imports again on the next UTC day", async () => {
    const { userId, profileId } = await atlasProfile();
    await db()
      .insert(usageDaily)
      .values({ day: "2026-09-30", scopeKey: userScope(userId), imports: LIMITS.importsPerUserPerDay });
    const receipt = await importExport(userId, profileId, exportPayload(), new Date("2026-10-01T00:00:01Z"));
    expect(receipt.duplicate).toBe(false);
  });

  it("refuses with quota_exhausted when the user's stored rosters are at the byte limit", async () => {
    const { userId, profileId } = await atlasProfile();
    const other = await createProfile(userId, "nova_labs", NOW);
    await addSnapshot(userId, other.id, { rosterBytes: LIMITS.rosterBytesPerUser });
    const error = await thrown(() => importExport(userId, profileId, exportPayload(), NOW));
    expect(error.code).toBe("quota_exhausted");
    expect(error.details).toMatchObject({ quota: "roster_bytes" });
    expect(await footprint(profileId)).toEqual({ snapshots: 0, jobs: 0, received: 0, revision: 0 });
  });

  it("refuses with capacity_paused while the database is at its size limit", async () => {
    const { userId, profileId } = await atlasProfile();
    setTestEnv({ CAPACITY_MAX_DB_BYTES: "5000" });
    await db()
      .insert(systemState)
      .values({ key: DATABASE_SIZE_STATE_KEY, value: { bytes: 5000, measuredAt: NOW.toISOString() } });
    const error = await thrown(() => importExport(userId, profileId, exportPayload(), NOW));
    expect(error.code).toBe("capacity_paused");
    expect(error.status).toBe(503);
    expect(await footprint(profileId)).toEqual({ snapshots: 0, jobs: 0, received: 0, revision: 0 });
  });
});

describe("importExport: payload validation", () => {
  async function rejected(overrides: Record<string, unknown>) {
    const { userId, profileId } = await atlasProfile();
    const error = await thrown(() => importExport(userId, profileId, exportPayload(overrides), NOW));
    expect(await snapshots(profileId)).toHaveLength(0);
    return error;
  }

  it("rejects an import whose account differs from the profile handle", async () => {
    const error = await rejected({ account: "nova_labs" });
    expect(error.code).toBe("invalid_input");
    expect(error.details).toMatchObject({ reason: "owner_mismatch" });
  });

  it("rejects a payload with an unknown key", async () => {
    expect((await rejected({ sessionId: "x" })).code).toBe("invalid_input");
  });

  it("rejects an unsorted list", async () => {
    expect((await rejected({ following: ["pixel_forge", "nova_labs"] })).code).toBe("invalid_input");
  });

  it("rejects a repeated username", async () => {
    expect((await rejected({ following: ["nova_labs", "nova_labs"] })).code).toBe("invalid_input");
  });

  it("rejects an uppercase username", async () => {
    expect((await rejected({ followers: ["Nova_Labs"] })).code).toBe("invalid_input");
  });

  it("rejects a shard list without its direction", async () => {
    expect((await rejected({ following: null })).code).toBe("invalid_input");
  });

  it("rejects a direction without its shard list", async () => {
    expect((await rejected({ shards: { followers: [0], following: [] } })).code).toBe("invalid_input");
  });

  it("rejects an import with no direction at all", async () => {
    const error = await rejected({ followers: null, following: null, shards: { followers: [], following: [] } });
    expect(error.code).toBe("invalid_input");
  });

  it("rejects a capture time in the future", async () => {
    expect((await rejected({ capturedAt: "2026-10-02T12:00:00+00:00" })).code).toBe("invalid_input");
  });

  it("rejects a capture time without a timezone", async () => {
    expect((await rejected({ capturedAt: "2026-09-01T12:00:00" })).code).toBe("invalid_input");
  });

  it("rejects a declaration that is not a boolean", async () => {
    expect((await rejected({ completeFollowers: "true" })).code).toBe("invalid_input");
  });
});

describe("importExport: the profile", () => {
  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await atlasProfile();
    expect((await thrown(() => importExport(userId, RANDOM_ID, exportPayload(), NOW))).code).toBe("not_found");
  });

  it("answers not_found for a malformed profile id", async () => {
    const { userId } = await atlasProfile();
    expect((await thrown(() => importExport(userId, "1 or 1=1", exportPayload(), NOW))).code).toBe("not_found");
  });
});

describe("listSnapshots", () => {
  it("lists the import history, newest capture first and undated last", async () => {
    const { userId, profileId } = await atlasProfile();
    const first = await importExport(userId, profileId, exportPayload(), NOW);
    const second = await importExport(userId, profileId, SECOND, NOW);
    const undated = await importExport(
      userId,
      profileId,
      exportPayload({ capturedAt: null, followers: ["lunar_arch"] }),
      NOW,
    );
    const page = await listSnapshots(userId, profileId);
    expect(page.data.map((item) => item.id)).toEqual([second.snapshotId, first.snapshotId, undated.snapshotId]);
    expect(page.pagination).toMatchObject({ page: 1, totalItems: 3, totalPages: 1 });
  });

  it("reports counts only for a direction with complete coverage", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload({ completeFollowing: false }), NOW);
    const [item] = (await listSnapshots(userId, profileId)).data;
    expect(item).toMatchObject({
      capturedAt: "2026-09-01T12:00:00+00:00",
      importedAt: NOW.toISOString(),
      isCurrent: true,
      followers: 1,
      following: null,
      followersObserved: 1,
      followingObserved: 2,
      source: "instagram_export",
    });
    expect(item?.coverage.followers).toEqual({
      present: true,
      complete: true,
      declaredComplete: true,
      shards: [0],
      shardsContiguous: true,
      capturedAtKnown: true,
      independentlyVerified: false,
    });
    expect(item?.coverage.following).toMatchObject({ present: true, complete: false, declaredComplete: false });
  });

  it("reports an absent direction as unknown, not zero", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(
      userId,
      profileId,
      exportPayload({ following: null, shards: { followers: [0], following: [] } }),
      NOW,
    );
    const [item] = (await listSnapshots(userId, profileId)).data;
    expect(item).toMatchObject({ following: null, followingObserved: null });
    expect(item?.coverage.following).toMatchObject({ present: false, complete: false, shards: [] });
  });

  it("never returns the rosters", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const text = JSON.stringify(await listSnapshots(userId, profileId));
    expect(text).not.toContain("nova_labs");
    expect(text).not.toContain("pixel_forge");
  });

  it("pages the history", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, exportPayload(), NOW);
    const second = await importExport(userId, profileId, SECOND, NOW);
    const page = await listSnapshots(userId, profileId, { page: 1, pageSize: 1 });
    expect(page.data.map((item) => item.id)).toEqual([second.snapshotId]);
    expect(page.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
  });

  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await atlasProfile();
    expect((await thrown(() => listSnapshots(userId, RANDOM_ID))).code).toBe("not_found");
  });
});

describe("importExport: concurrent imports", () => {
  it("stores two different imports that arrive together, with one current snapshot", async () => {
    const { userId, profileId } = await atlasProfile();
    const results = await Promise.all([
      importExport(userId, profileId, exportPayload(), NOW),
      importExport(userId, profileId, SECOND, NOW),
    ]);
    const stored = await snapshots(profileId);
    expect(stored).toHaveLength(2);
    const current = stored.filter((row) => row.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.capturedAt?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(await revision(profileId)).toBe(2);
    expect(await jobs(profileId)).toHaveLength(1);
    expect(new Set(results.map((receipt) => receipt.job?.id)).size).toBe(1);
    expect(await importsToday(userId, NOW)).toBe(2);
  });

  it("stores the same import once when it arrives twice together", async () => {
    const { userId, profileId } = await atlasProfile();
    const results = await Promise.all([
      importExport(userId, profileId, exportPayload(), NOW),
      importExport(userId, profileId, exportPayload(), NOW),
    ]);
    expect(await snapshots(profileId)).toHaveLength(1);
    expect(results.map((receipt) => receipt.duplicate).sort()).toEqual([false, true]);
    expect(await revision(profileId)).toBe(1);
    expect(await importsToday(userId, NOW)).toBe(1);
  });

  it("never passes the daily quota when imports race", async () => {
    const { userId, profileId } = await atlasProfile();
    await db()
      .insert(usageDaily)
      .values({ day: "2026-09-30", scopeKey: userScope(userId), imports: LIMITS.importsPerUserPerDay - 1 });
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const results = await Promise.allSettled(
      days.map((day) => importExport(userId, profileId, exportPayload({ capturedAt: `${day}T12:00:00+00:00` }), NOW)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await snapshots(profileId)).toHaveLength(1);
    expect(await importsToday(userId, NOW)).toBe(LIMITS.importsPerUserPerDay);
  });

  it("never passes the roster byte quota when imports into two profiles race", async () => {
    const { userId, profileId } = await atlasProfile();
    const other = await createProfile(userId, "nova_labs", NOW);
    const filler = await createProfile(userId, "pixel_forge", NOW);
    // Room for exactly one of the two imports below (29 bytes each).
    await addSnapshot(userId, filler.id, { rosterBytes: LIMITS.rosterBytesPerUser - 40 });
    const results = await Promise.allSettled([
      importExport(userId, profileId, exportPayload(), NOW),
      importExport(userId, other.id, exportPayload({ account: "nova_labs" }), NOW),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = [...(await snapshots(profileId)), ...(await snapshots(other.id))];
    expect(stored).toHaveLength(1);
  });
});
