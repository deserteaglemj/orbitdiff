import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET as getOne, PATCH } from "@/app/api/profiles/[id]/route";
import { GET as list, POST } from "@/app/api/profiles/route";
import { LIMITS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { exportSnapshot, job, profile, user } from "@/server/db/schema";
import { dedupeKey, enqueueJob } from "@/server/jobs/queue";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { addSnapshot, ATLAS, RANDOM_ID } from "../services/support";
import { callProfileRoute, callRaw, expectError } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const atlasUser = () => createVerifiedUser({ email: ATLAS, onboarded: true });

const create = (cookie: string | undefined, handle: unknown, origin?: string | null) =>
  callRoute(POST, { method: "POST", url: "/api/profiles", cookie, json: { handle }, origin });

async function created(cookie: string, handle = "atlas_studio"): Promise<{ id: string }> {
  const response = await create(cookie, handle);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

const rows = () => getDb().select().from(profile);

describe("POST /api/profiles", () => {
  it("adds a profile and answers 201 with the profile", async () => {
    const atlas = await atlasUser();
    const response = await create(atlas.cookie, "@Atlas_Studio");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      handle: "atlas_studio",
      status: "active",
      evidence: "missing",
      processing: false,
      snapshotCount: 0,
    });
    expect(await rows()).toHaveLength(1);
  });

  it("accepts a profile link", async () => {
    const atlas = await atlasUser();
    const response = await create(atlas.cookie, "https://www.instagram.com/nova_labs/");
    expect((await response.json()).handle).toBe("nova_labs");
  });

  it("answers 422 for a link that is not a profile", async () => {
    const atlas = await atlasUser();
    await expectError(await create(atlas.cookie, "https://www.instagram.com/reel/abc/"), 422, "invalid_input");
  });

  it("answers 409 for a handle the user already added", async () => {
    const atlas = await atlasUser();
    await created(atlas.cookie);
    await expectError(await create(atlas.cookie, "atlas_studio"), 409, "conflict");
  });

  it("answers 429 past the profile limit", async () => {
    const atlas = await atlasUser();
    for (const handle of ["atlas_studio", "nova_labs", "pixel_forge"].slice(0, LIMITS.profilesPerUser)) {
      await created(atlas.cookie, handle);
    }
    await expectError(await create(atlas.cookie, "lunar_arch"), 429, "quota_exhausted");
  });

  it("rejects an unknown key", async () => {
    const atlas = await atlasUser();
    const response = await callRoute(POST, {
      method: "POST",
      url: "/api/profiles",
      cookie: atlas.cookie,
      json: { handle: "atlas_studio", password: "x" },
    });
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: ["password"] });
    expect(await rows()).toHaveLength(0);
  });

  it("answers 403 without an Origin header and adds nothing", async () => {
    const atlas = await atlasUser();
    await expectError(await create(atlas.cookie, "atlas_studio", null), 403, "forbidden_origin");
    expect(await rows()).toHaveLength(0);
  });

  it("answers 403 to another origin", async () => {
    const atlas = await atlasUser();
    await expectError(await create(atlas.cookie, "atlas_studio", "https://elsewhere.test"), 403, "forbidden_origin");
  });

  it("answers 401 without a session", async () => {
    await expectError(await create(undefined, "atlas_studio"), 401, "unauthenticated");
  });

  it("answers 409 with the onboarding marker before onboarding", async () => {
    const pending = await createVerifiedUser({ email: ATLAS });
    const body = await expectError(await create(pending.cookie, "atlas_studio"), 409, "conflict");
    expect(body.error.details).toEqual({ onboarding: true });
    expect(await rows()).toHaveLength(0);
  });

  it("rejects a body over the byte cap", async () => {
    const atlas = await atlasUser();
    const response = await callRaw(POST, {
      method: "POST",
      url: "/api/profiles",
      cookie: atlas.cookie,
      body: JSON.stringify({ handle: "a".repeat(20_000) }),
    });
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toHaveProperty("maxBytes");
  });
});

describe("GET /api/profiles", () => {
  const get = (cookie: string | undefined, query = "") => callRoute(list, { url: `/api/profiles${query}`, cookie });

  it("returns the list envelope", async () => {
    const atlas = await atlasUser();
    await created(atlas.cookie);
    const response = await get(atlas.cookie);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((item: { handle: string }) => item.handle)).toEqual(["atlas_studio"]);
    expect(body.pagination).toEqual({ page: 1, pageSize: LIMITS.pageSizeDefault, totalItems: 1, totalPages: 1 });
  });

  it("answers 401 without a session", async () => {
    await expectError(await get(undefined), 401, "unauthenticated");
  });

  it.each(["?page=0", "?page=-1", "?page=abc", "?pageSize=0", "?pageSize=1.5", "?page=100001"])(
    "answers 422 for %s",
    async (query) => {
      const atlas = await atlasUser();
      await expectError(await get(atlas.cookie, query), 422, "invalid_input");
    },
  );

  it("caps the page size at the maximum", async () => {
    const atlas = await atlasUser();
    const body = await (await get(atlas.cookie, "?pageSize=100000")).json();
    expect(body.pagination.pageSize).toBe(LIMITS.pageSizeMax);
  });
});

describe("GET /api/profiles/:id", () => {
  it("returns the profile", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await addSnapshot(atlas.userId, id);
    const response = await callProfileRoute(getOne, id, { url: `/api/profiles/${id}`, cookie: atlas.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, handle: "atlas_studio", snapshotCount: 1 });
  });

  it("answers 404 for an id that does not exist", async () => {
    const atlas = await atlasUser();
    const response = await callProfileRoute(getOne, RANDOM_ID, { url: `/api/profiles/${RANDOM_ID}`, cookie: atlas.cookie });
    await expectError(response, 404, "not_found");
  });

  it.each(["not-an-id", "123", "' or 1=1 --", "3f2b8c1e5a4d4e6f9b7a0c1d2e3f4a5b"])(
    "answers 404 for the malformed id %s",
    async (id) => {
      const atlas = await atlasUser();
      const response = await callProfileRoute(getOne, id, { url: "/api/profiles/x", cookie: atlas.cookie });
      await expectError(response, 404, "not_found");
    },
  );

  it("answers 401 without a session", async () => {
    const response = await callProfileRoute(getOne, RANDOM_ID, { url: `/api/profiles/${RANDOM_ID}` });
    await expectError(response, 401, "unauthenticated");
  });
});

describe("PATCH /api/profiles/:id", () => {
  const patch = (cookie: string | undefined, id: string, json: unknown, origin?: string | null) =>
    callProfileRoute(PATCH, id, { method: "PATCH", url: `/api/profiles/${id}`, cookie, json, origin });

  it("pauses: clears the next review and cancels queued review jobs", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    const queued = await enqueueJob(getDb(), {
      userId: atlas.userId,
      profileId: id,
      kind: "daily_review",
      dedupeKey: dedupeKey.daily(id, "2026-09-30"),
    });
    const response = await patch(atlas.cookie, id, { status: "paused" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "paused", nextReviewAt: null });
    const [stored] = await getDb().select().from(profile).where(eq(profile.id, id));
    expect(stored).toMatchObject({ status: "paused", nextReviewAt: null });
    expect(stored?.pausedAt).toBeInstanceOf(Date);
    const [row] = await getDb().select().from(job).where(eq(job.id, queued.job.id));
    expect(row).toMatchObject({ status: "cancelled", cancelReason: "profile_paused" });
  });

  it("resumes: sets the next review again", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await patch(atlas.cookie, id, { status: "paused" });
    const response = await patch(atlas.cookie, id, { status: "active" });
    const body = await response.json();
    expect(body.status).toBe("active");
    expect(typeof body.nextReviewAt).toBe("string");
    const [stored] = await getDb().select().from(profile).where(eq(profile.id, id));
    expect(stored?.nextReviewAt).toBeInstanceOf(Date);
    expect(stored?.pausedAt).toBeNull();
  });

  it("answers 422 for a status it does not know", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await expectError(await patch(atlas.cookie, id, { status: "deleted" }), 422, "invalid_input");
  });

  it("rejects an attempt to change the handle or the owner", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    const body = await expectError(
      await patch(atlas.cookie, id, { status: "paused", handle: "nova_labs", userId: "someone" }),
      422,
      "invalid_input",
    );
    expect(body.error.details).toEqual({ fields: ["handle", "userId"] });
    const [stored] = await getDb().select().from(profile).where(eq(profile.id, id));
    expect(stored).toMatchObject({ status: "active", handle: "atlas_studio", userId: atlas.userId });
  });

  it("answers 403 without an Origin header and changes nothing", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await expectError(await patch(atlas.cookie, id, { status: "paused" }, null), 403, "forbidden_origin");
    expect((await rows())[0]?.status).toBe("active");
  });

  it("answers 404 for a malformed id before reading the body", async () => {
    const atlas = await atlasUser();
    await expectError(await patch(atlas.cookie, "not-an-id", { nonsense: true }), 404, "not_found");
  });

  it("answers 404 for an id that does not exist", async () => {
    const atlas = await atlasUser();
    await expectError(await patch(atlas.cookie, RANDOM_ID, { status: "paused" }), 404, "not_found");
  });
});

describe("DELETE /api/profiles/:id", () => {
  const remove = (cookie: string | undefined, id: string, origin?: string | null) =>
    callProfileRoute(DELETE, id, { method: "DELETE", url: `/api/profiles/${id}`, cookie, origin });

  it("removes the profile with its snapshots and jobs and answers 204", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await addSnapshot(atlas.userId, id);
    await enqueueJob(getDb(), {
      userId: atlas.userId,
      profileId: id,
      kind: "derive_profile",
      dedupeKey: dedupeKey.derive(id, 1),
    });
    const response = await remove(atlas.cookie, id);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await rows()).toHaveLength(0);
    expect(await getDb().select().from(exportSnapshot)).toHaveLength(0);
    expect(await getDb().select().from(job)).toHaveLength(0);
  });

  it("answers 404 the second time", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await remove(atlas.cookie, id);
    await expectError(await remove(atlas.cookie, id), 404, "not_found");
  });

  it("answers 403 without an Origin header and removes nothing", async () => {
    const atlas = await atlasUser();
    const { id } = await created(atlas.cookie);
    await expectError(await remove(atlas.cookie, id, null), 403, "forbidden_origin");
    expect(await rows()).toHaveLength(1);
  });

  it("answers 404 for a malformed id", async () => {
    const atlas = await atlasUser();
    await expectError(await remove(atlas.cookie, "not-an-id"), 404, "not_found");
  });

  it("answers 401 without a session", async () => {
    await expectError(await remove(undefined, RANDOM_ID), 401, "unauthenticated");
  });
});

describe("product routes and the state of the account", () => {
  const get = (cookie: string) => callRoute(list, { url: "/api/profiles", cookie });

  it("answers 403 once the email address is no longer verified", async () => {
    const atlas = await atlasUser();
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, atlas.userId));
    await expectError(await get(atlas.cookie), 403, "unverified");
  });

  it("answers 403 to a suspended account", async () => {
    const atlas = await atlasUser();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    await expectError(await get(atlas.cookie), 403, "suspended");
  });

  it("answers 401 to a forged session cookie", async () => {
    await expectError(await get("better-auth.session_token=forged.value"), 401, "unauthenticated");
  });
});
