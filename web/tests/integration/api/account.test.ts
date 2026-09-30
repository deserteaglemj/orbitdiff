import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/account/export/route";
import { closeDb, getDb } from "@/server/db/client";
import { account, session } from "@/server/db/schema";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, exportPayload, roster } from "../services/support";
import { expectError } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const get = (cookie?: string) => callRoute(GET, { url: "/api/account/export", cookie });

describe("GET /api/account/export", () => {
  it("answers with a JSON download of everything stored for the user", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio");
    await importExport(atlas.userId, created.id, exportPayload());

    const response = await get(atlas.cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="orbitdiff-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.account).toMatchObject({ id: atlas.userId, email: ATLAS });
    expect(body.profiles.map((item: { handle: string }) => item.handle)).toEqual(["atlas_studio"]);
    expect(body.snapshots[0]).toMatchObject({ followers: ["nova_labs"], following: ["nova_labs", "pixel_forge"] });
    expect(body.consent.length).toBeGreaterThanOrEqual(3);
    expect(body.jobs).toHaveLength(1);
    expect(body.activity.length).toBeGreaterThanOrEqual(2);
  });

  it("returns a large export intact", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio");
    const many = roster(30_000);
    await importExport(
      atlas.userId,
      created.id,
      exportPayload({ followers: many, following: null, shards: { followers: [0], following: [] } }),
    );
    const response = await get(atlas.cookie);
    const text = await response.text();
    expect(text.length).toBeGreaterThan(400_000);
    expect(JSON.parse(text).snapshots[0].followers).toEqual(many);
  });

  it("contains no password hash and no session token", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const [credential] = await getDb().select().from(account).where(eq(account.userId, atlas.userId));
    const [signedIn] = await getDb().select().from(session).where(eq(session.userId, atlas.userId));
    const text = await (await get(atlas.cookie)).text();
    expect(text).not.toContain(credential!.password!);
    expect(text).not.toContain(signedIn!.token);
    expect(text).not.toMatch(/"(password|token)"/);
  });

  it("is available before onboarding, so a user can always take their data", async () => {
    const pending = await createVerifiedUser({ email: ATLAS });
    const response = await get(pending.cookie);
    expect(response.status).toBe(200);
    expect((await response.json()).profiles).toEqual([]);
  });

  it("answers 401 without a session", async () => {
    await expectError(await get(), 401, "unauthenticated");
  });
});
