import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as capacityGET } from "@/app/api/admin/capacity/route";
import { GET as usersGET } from "@/app/api/admin/users/route";
import { PATCH as mePATCH } from "@/app/api/me/route";
import { closeDb, getDb } from "@/server/db/client";
import { account, session, user } from "@/server/db/schema";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { ATLAS, exportPayload, NOVA, OWNER } from "../services/support";
import { expectError, keysOf } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const users = (cookie?: string, query = "") => callRoute(usersGET, { url: `/api/admin/users${query}`, cookie });
const capacity = (cookie?: string) => callRoute(capacityGET, { url: "/api/admin/capacity", cookie });

describe("the admin boundary", () => {
  it("gives the configured admin the user list", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await createVerifiedUser({ email: ATLAS });
    const response = await users(owner.cookie);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((item: { email: string }) => item.email)).toEqual([ATLAS, OWNER]);
    expect(body.pagination).toMatchObject({ page: 1, totalItems: 2, totalPages: 1 });
  });

  it("gives the configured admin the capacity report", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    const response = await capacity(owner.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      users: { used: 1, paused: false },
      jobsToday: { used: 0, paused: false },
      database: { bytes: null, paused: false },
      mail: { available: true, mode: "captured" },
      registration: { open: true, reason: null },
    });
  });

  it("answers 404 from the user list to a verified user who is not an admin", async () => {
    await createVerifiedUser({ email: OWNER });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await expectError(await users(nova.cookie), 404, "not_found");
  });

  it("answers 404 from the capacity report to a verified user who is not an admin", async () => {
    await createVerifiedUser({ email: OWNER });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await expectError(await capacity(nova.cookie), 404, "not_found");
  });

  it("answers 404 to a signed-out caller on both routes", async () => {
    await expectError(await users(), 404, "not_found");
    await expectError(await capacity(), 404, "not_found");
  });

  it("answers 404 when the configured address is no longer verified", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, owner.userId));
    await expectError(await users(owner.cookie), 404, "not_found");
    await expectError(await capacity(owner.cookie), 404, "not_found");
  });

  it("answers 404 when the configured admin is suspended", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));
    await expectError(await users(owner.cookie), 404, "not_found");
  });

  it("answers 404 once the address is removed from ADMIN_EMAILS", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    setTestEnv({ ADMIN_EMAILS: "" });
    await expectError(await users(owner.cookie), 404, "not_found");
  });

  it("is not opened by a self-granted flag", async () => {
    await createVerifiedUser({ email: OWNER });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    for (const body of [{ isAdmin: true }, { role: "admin" }, { name: "Nova", isAdmin: true }]) {
      const response = await callRoute(mePATCH, { method: "PATCH", url: "/api/me", cookie: nova.cookie, json: body });
      await expectError(response, 422, "invalid_input");
    }
    await expectError(await users(nova.cookie, "?isAdmin=true&role=admin"), 404, "not_found");
    await expectError(await capacity(nova.cookie), 404, "not_found");
  });

  it("is not opened by a request header", async () => {
    await createVerifiedUser({ email: OWNER });
    const nova = await createVerifiedUser({ email: NOVA });
    const response = await callRoute(usersGET, {
      url: "/api/admin/users",
      cookie: nova.cookie,
      headers: { "x-admin": "true", "x-user-email": OWNER, authorization: `Bearer ${OWNER}` },
    });
    await expectError(response, 404, "not_found");
  });
});

describe("GET /api/admin/users", () => {
  it("contains no password, token, handle, or roster field", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio");
    await importExport(atlas.userId, created.id, exportPayload());
    const [credential] = await getDb().select().from(account).where(eq(account.userId, atlas.userId));
    const sessions = await getDb().select().from(session);

    const text = await (await users(owner.cookie)).text();

    const keys = [...keysOf(JSON.parse(text))];
    expect(keys.filter((key) => /password|token|secret|followers|following|handle|username/i.test(key))).toEqual([]);
    expect(text).not.toContain(credential!.password!);
    for (const row of sessions) expect(text).not.toContain(row.token);
    for (const word of ["atlas_studio", "nova_labs", "pixel_forge"]) expect(text).not.toContain(word);
  });

  it("filters with q and pages the result", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    await createVerifiedUser({ email: ATLAS });
    await createVerifiedUser({ email: NOVA });
    // Every test user is named "Atlas Tester", so the search text has to be part of the address only.
    const filtered = await (await users(owner.cookie, "?q=atlas%40")).json();
    expect(filtered.data.map((item: { email: string }) => item.email)).toEqual([ATLAS]);
    const paged = await (await users(owner.cookie, "?page=2&pageSize=2")).json();
    expect(paged.data.map((item: { email: string }) => item.email)).toEqual([OWNER]);
    expect(paged.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
  });

  it.each(["?page=0", "?pageSize=-5", "?page=1e3"])("answers 422 for %s", async (query) => {
    const owner = await createVerifiedUser({ email: OWNER });
    await expectError(await users(owner.cookie, query), 422, "invalid_input");
  });
});

describe("GET /api/admin/capacity", () => {
  it("contains counts and flags only", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio");
    await importExport(atlas.userId, created.id, exportPayload());
    const text = await (await capacity(owner.cookie)).text();
    for (const word of [ATLAS, OWNER, "atlas_studio", "nova_labs", atlas.userId]) expect(text).not.toContain(word);
    expect([...keysOf(JSON.parse(text))].sort()).toEqual([
      "available",
      "bytes",
      "database",
      "jobsToday",
      "lastTick",
      "limit",
      "mail",
      "measuredAt",
      "mode",
      "open",
      "paused",
      "reason",
      "registration",
      "used",
      "users",
    ]);
  });
});
