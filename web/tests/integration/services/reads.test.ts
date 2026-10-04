import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/server/db/client";
import { getCountHistory } from "@/server/services/counts";
import { listEvents } from "@/server/services/events";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";
import { listRelationships } from "@/server/services/relationships";

import { createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, exportPayload, insertEvents, NOW, RANDOM_ID, roster, thrown } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

async function atlasProfile(handle = "atlas_studio") {
  const owner = await createVerifiedUser({ email: ATLAS, onboarded: true });
  const created = await createProfile(owner.userId, handle, NOW);
  return { userId: owner.userId, profileId: created.id };
}

/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysOf(item, found);
    }
  }
  return found;
}

describe("listRelationships", () => {
  const BOTH = exportPayload({
    followers: ["ember_lab", "nova_labs"],
    following: ["nova_labs", "pixel_forge"],
  });

  it("lists the accounts of the current snapshot with their relationship", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, BOTH, NOW);
    const page = await listRelationships(userId, profileId, {}, NOW);
    expect(page.data).toEqual([
      { username: "ember_lab", following: false, followedBy: true, relationship: "follows_you" },
      { username: "nova_labs", following: true, followedBy: true, relationship: "mutual" },
      { username: "pixel_forge", following: true, followedBy: false, relationship: "not_following_back" },
    ]);
    expect(page.pagination).toMatchObject({ page: 1, totalItems: 3, totalPages: 1 });
  });

  it("keeps absence unknown when a direction is not complete", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, { ...BOTH, completeFollowers: false }, NOW);
    const page = await listRelationships(userId, profileId, {}, NOW);
    expect(page.data.find((row) => row.username === "pixel_forge")).toEqual({
      username: "pixel_forge",
      following: true,
      followedBy: null,
      relationship: "unknown",
    });
  });

  it("orders usernames by code point", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(
      userId,
      profileId,
      exportPayload({ followers: ["ember_lab", "ember_lab2", "ember_lab_2"], following: [] }),
      NOW,
    );
    const page = await listRelationships(userId, profileId, {}, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["ember_lab", "ember_lab2", "ember_lab_2"]);
  });

  it("filters by a username substring, ignoring case", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, BOTH, NOW);
    const page = await listRelationships(userId, profileId, { q: " FORGE " }, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["pixel_forge"]);
    expect(page.pagination.totalItems).toBe(1);
  });

  it("filters by relationship", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, BOTH, NOW);
    const page = await listRelationships(userId, profileId, { relationship: "not_following_back" }, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["pixel_forge"]);
  });

  it("rejects a relationship filter it does not know", async () => {
    const { userId, profileId } = await atlasProfile();
    const error = await thrown(() => listRelationships(userId, profileId, { relationship: "blocked" as never }, NOW));
    expect(error.code).toBe("invalid_input");
  });

  it("pages the accounts", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, BOTH, NOW);
    const page = await listRelationships(userId, profileId, { page: 2, pageSize: 2 }, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["pixel_forge"]);
    expect(page.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it("caps the page size at the maximum", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(
      userId,
      profileId,
      exportPayload({ followers: roster(150), following: null, shards: { followers: [0], following: [] } }),
      NOW,
    );
    const page = await listRelationships(userId, profileId, { pageSize: 5000 }, NOW);
    expect(page.data).toHaveLength(100);
    expect(page.pagination).toMatchObject({ pageSize: 100, totalItems: 150, totalPages: 2 });
  });

  it("reads only the current snapshot", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, BOTH, NOW);
    await importExport(
      userId,
      profileId,
      exportPayload({ capturedAt: "2026-09-08T12:00:00+00:00", followers: ["lunar_arch"], following: [] }),
      NOW,
    );
    const page = await listRelationships(userId, profileId, {}, NOW);
    expect(page.data.map((row) => row.username)).toEqual(["lunar_arch"]);
  });

  it("returns an empty page before the first import", async () => {
    const { userId, profileId } = await atlasProfile();
    const page = await listRelationships(userId, profileId, {}, NOW);
    expect(page.data).toEqual([]);
    expect(page.pagination).toMatchObject({ totalItems: 0, totalPages: 0 });
  });

  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await atlasProfile();
    expect((await thrown(() => listRelationships(userId, RANDOM_ID, {}, NOW))).code).toBe("not_found");
  });
});

describe("listEvents", () => {
  async function seeded() {
    const { userId, profileId } = await atlasProfile();
    await insertEvents(userId, profileId, [
      {
        type: "follower_observed_added",
        username: "ember_lab",
        intervalStart: "2026-09-08T12:00:00Z",
        intervalEnd: "2026-09-15T12:00:00Z",
      },
      {
        type: "following_observed_removed",
        username: "pixel_forge",
        intervalStart: "2026-09-08T12:00:00Z",
        intervalEnd: "2026-09-15T12:00:00Z",
      },
      {
        type: "follower_observed_removed",
        username: "lunar_arch",
        intervalStart: "2026-09-01T12:00:00Z",
        intervalEnd: "2026-09-08T12:00:00Z",
      },
    ]);
    return { userId, profileId };
  }

  it("lists export observations, newest interval first and then by position", async () => {
    const { userId, profileId } = await seeded();
    const page = await listEvents(userId, {});
    expect(page.data.map((event) => event.username)).toEqual(["ember_lab", "pixel_forge", "lunar_arch"]);
    expect(page.data[0]).toEqual({
      id: expect.any(String),
      profileId,
      profileHandle: "atlas_studio",
      type: "follower_observed_added",
      direction: "followers",
      username: "ember_lab",
      intervalStart: "2026-09-08T12:00:00+00:00",
      intervalEnd: "2026-09-15T12:00:00+00:00",
      evidence: "export_observation",
    });
    expect(page.pagination).toMatchObject({ page: 1, totalItems: 3, totalPages: 1 });
  });

  it("labels every entry as an export observation", async () => {
    const { userId } = await seeded();
    const page = await listEvents(userId, {});
    expect(new Set(page.data.map((event) => event.evidence))).toEqual(new Set(["export_observation"]));
  });

  it("filters by type", async () => {
    const { userId } = await seeded();
    const page = await listEvents(userId, { type: "follower_observed_removed" });
    expect(page.data.map((event) => event.username)).toEqual(["lunar_arch"]);
  });

  it("rejects a type it does not know", async () => {
    const { userId } = await seeded();
    expect((await thrown(() => listEvents(userId, { type: "unfollowed" as never }))).code).toBe("invalid_input");
  });

  it("filters by a username substring", async () => {
    const { userId } = await seeded();
    const page = await listEvents(userId, { q: "Pixel" });
    expect(page.data.map((event) => event.username)).toEqual(["pixel_forge"]);
  });

  it("treats the wildcard characters of a search as plain text", async () => {
    const { userId } = await seeded();
    expect((await listEvents(userId, { q: "%" })).data).toEqual([]);
    expect((await listEvents(userId, { q: "lunar_arch" })).data).toHaveLength(1);
    expect((await listEvents(userId, { q: "lunar.arch" })).data).toHaveLength(0);
  });

  it("filters by profile", async () => {
    const { userId, profileId } = await seeded();
    const other = await createProfile(userId, "nova_labs", NOW);
    await insertEvents(userId, other.id, [{ type: "following_observed_added", username: "sunset_field" }]);
    expect((await listEvents(userId, {})).data).toHaveLength(4);
    const page = await listEvents(userId, { profileId: other.id });
    expect(page.data.map((event) => event.username)).toEqual(["sunset_field"]);
    expect(page.data[0]?.profileHandle).toBe("nova_labs");
    expect((await listEvents(userId, { profileId })).data).toHaveLength(3);
  });

  it("pages the observations", async () => {
    const { userId } = await seeded();
    const page = await listEvents(userId, { page: 2, pageSize: 2 });
    expect(page.data.map((event) => event.username)).toEqual(["lunar_arch"]);
    expect(page.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await seeded();
    expect((await thrown(() => listEvents(userId, { profileId: RANDOM_ID }))).code).toBe("not_found");
  });
});

describe("getCountHistory", () => {
  const followersOnly = (count: number, capturedAt: string | null, complete = true) =>
    exportPayload({
      capturedAt,
      completeFollowers: complete,
      followers: roster(count),
      following: null,
      shards: { followers: [0], following: [] },
    });

  it("reads 100 then 103 followers as net growth of 3 and names nobody", async () => {
    const { userId, profileId } = await atlasProfile();
    const first = await importExport(userId, profileId, followersOnly(100, "2026-09-01T12:00:00+00:00"), NOW);
    const second = await importExport(userId, profileId, followersOnly(103, "2026-09-08T12:00:00+00:00"), NOW);

    const history = await getCountHistory(userId, profileId);

    expect(history).toEqual({
      points: [
        { snapshotId: first.snapshotId, capturedAt: "2026-09-01T12:00:00+00:00", followers: 100, following: null },
        { snapshotId: second.snapshotId, capturedAt: "2026-09-08T12:00:00+00:00", followers: 103, following: null },
      ],
      followersChange: "Net growth of 3",
      followingChange: null,
    });
    const keys = keysOf(history);
    expect([...keys].filter((key) => /user|name|handle|account/i.test(key))).toEqual([]);
    expect(JSON.stringify(history)).not.toContain("pixel_forge");
  });

  it("reads a lower count as a net decline", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, followersOnly(12, "2026-09-01T12:00:00+00:00"), NOW);
    await importExport(userId, profileId, followersOnly(7, "2026-09-08T12:00:00+00:00"), NOW);
    expect((await getCountHistory(userId, profileId)).followersChange).toBe("Net decline of 5");
  });

  it("reads an equal count as no net change even when the accounts differ", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, followersOnly(5, "2026-09-01T12:00:00+00:00"), NOW);
    await importExport(
      userId,
      profileId,
      exportPayload({
        capturedAt: "2026-09-08T12:00:00+00:00",
        followers: roster(5, "lunar_arch"),
        following: null,
        shards: { followers: [0], following: [] },
      }),
      NOW,
    );
    expect((await getCountHistory(userId, profileId)).followersChange).toBe("No net change");
  });

  it("has no change wording with a single point", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, followersOnly(5, "2026-09-01T12:00:00+00:00"), NOW);
    const history = await getCountHistory(userId, profileId);
    expect(history.points).toHaveLength(1);
    expect(history.followersChange).toBeNull();
  });

  it("leaves undated imports out of the series", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, followersOnly(5, null), NOW);
    expect(await getCountHistory(userId, profileId)).toEqual({
      points: [],
      followersChange: null,
      followingChange: null,
    });
  });

  it("leaves a direction without complete coverage out of the series", async () => {
    const { userId, profileId } = await atlasProfile();
    await importExport(userId, profileId, followersOnly(100, "2026-09-01T12:00:00+00:00"), NOW);
    await importExport(userId, profileId, followersOnly(40, "2026-09-08T12:00:00+00:00", false), NOW);
    const history = await getCountHistory(userId, profileId);
    expect(history.points).toHaveLength(1);
    expect(history.followersChange).toBeNull();
  });

  it("is empty before the first import", async () => {
    const { userId, profileId } = await atlasProfile();
    expect((await getCountHistory(userId, profileId)).points).toEqual([]);
  });

  it("answers not_found for a profile id that does not exist", async () => {
    const { userId } = await atlasProfile();
    expect((await thrown(() => getCountHistory(userId, RANDOM_ID))).code).toBe("not_found");
  });
});
