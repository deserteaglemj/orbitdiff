import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb } from "@/server/db/client";
import type { AccountExport } from "@/server/services/account";
import type { MeDto, Page, ProfileDto } from "@/server/services/contracts";

import { resetDatabase, restoreTestEnv, signUp } from "../../helpers";
import { expectError } from "../api/support";
import {
  addProfile,
  api,
  ATLAS,
  body,
  type Browser,
  type Customer,
  type ExportBody,
  FIRST_EXPORT,
  importInto,
  NOVA,
  OWNER,
  RANDOM_ID,
  readActivity,
  readEvents,
  readProfile,
  register,
  SECOND_EXPORT,
} from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

/** The export of user two. Its names appear nowhere in the data of user one. */
const NOVA_EXPORT: ExportBody = {
  account: "sunset_field",
  capturedAt: "2026-09-05T12:00:00+00:00",
  completeFollowers: true,
  completeFollowing: true,
  followers: ["sunset_field_01"],
  following: ["sunset_field_02"],
  shards: { followers: [0], following: [0] },
};

interface World {
  atlas: Customer;
  nova: Customer;
  atlasProfile: string;
  novaProfile: string;
  /** Text that belongs to user one only: ids, the address, the name, the handle, and every username. */
  atlasMarkers: string[];
}

/**
 * User one owns a profile with two processed imports, export observations,
 * and a queued review. User two owns a profile of their own. Everything is
 * created through the API, by the user it belongs to.
 */
async function world(): Promise<World> {
  const atlas = await register(ATLAS, "Atlas Owner");
  const atlasProfile = (await addProfile(atlas.browser, "atlas_studio")).id;
  const first = await importInto(atlas.browser, atlasProfile, FIRST_EXPORT);
  const second = await importInto(atlas.browser, atlasProfile, SECOND_EXPORT);
  const events = await readEvents(atlas.browser, atlasProfile);
  expect(events.data).toHaveLength(2);
  const queued = await body<{ id: string }>(await api.review(atlas.browser, atlasProfile), 202);

  const nova = await register(NOVA, "Nova Owner");
  const novaProfile = (await addProfile(nova.browser, "sunset_field")).id;
  await importInto(nova.browser, novaProfile, NOVA_EXPORT);

  return {
    atlas,
    nova,
    atlasProfile,
    novaProfile,
    atlasMarkers: [
      atlas.userId,
      ATLAS,
      "Atlas Owner",
      atlasProfile,
      first.snapshotId,
      second.snapshotId,
      queued.id,
      ...events.data.map((event) => event.id),
      "atlas_studio",
      "nova_labs",
      "pixel_forge",
      "lunar_arch",
      "ember_lab",
    ],
  };
}

/** Everything user one can read about the profile, as text. Compared before and after an attempt. */
async function viewOf(browser: Browser, profileId: string): Promise<string> {
  const parts = [
    await api.profile(browser, profileId),
    await api.snapshots(browser, profileId),
    await api.relationships(browser, profileId),
    await api.events(browser, profileId),
    await api.counts(browser, profileId),
    await api.activity(browser),
    await api.profiles(browser),
  ];
  for (const part of parts) expect(part.status).toBe(200);
  return (await Promise.all(parts.map((part) => part.text()))).join("\n");
}

const NOT_FOUND = JSON.stringify({ error: { code: "not_found", message: "Not found." } });

type Attempt = (browser: Browser, profileId: string) => Promise<Response>;

/** Every route that takes a profile id, as an attempt by someone who is signed in. */
const ATTEMPTS: ReadonlyArray<[string, Attempt]> = [
  ["read the profile", (b, id) => api.profile(b, id)],
  ["pause the profile", (b, id) => api.setStatus(b, id, { status: "paused" })],
  ["resume the profile", (b, id) => api.setStatus(b, id, { status: "active" })],
  ["remove the profile", (b, id) => api.removeProfile(b, id)],
  ["import into the profile with its handle", (b, id) => api.importExport(b, id, { ...FIRST_EXPORT, capturedAt: "2026-09-20T12:00:00+00:00" })],
  ["import into the profile with their own handle", (b, id) => api.importExport(b, id, NOVA_EXPORT)],
  ["import into the profile with a body that is not valid", (b, id) => api.importExport(b, id, { account: "atlas_studio" })],
  ["read the import history", (b, id) => api.snapshots(b, id)],
  ["read the relationships", (b, id) => api.relationships(b, id)],
  ["read the export observations", (b, id) => api.events(b, id)],
  ["read the count history", (b, id) => api.counts(b, id)],
  ["filter the activity feed by the profile", (b, id) => api.activity(b, `?profileId=${id}`)],
  ["ask for a review", (b, id) => api.review(b, id)],
];

describe("user two cannot reach a profile of user one", () => {
  it.each(ATTEMPTS)("cannot %s", async (_label, attempt) => {
    const w = await world();
    const before = await viewOf(w.atlas.browser, w.atlasProfile);

    const foreign = await attempt(w.nova.browser, w.atlasProfile);
    const missing = await attempt(w.nova.browser, RANDOM_ID);

    // The same answer for an id that is someone else's and an id that is nobody's.
    expect({ status: foreign.status, body: await foreign.text() }).toEqual({ status: 404, body: NOT_FOUND });
    expect({ status: missing.status, body: await missing.text() }).toEqual({ status: 404, body: NOT_FOUND });
    // Nothing of user one changed, and the queued review is still there.
    expect(await viewOf(w.atlas.browser, w.atlasProfile)).toBe(before);
    expect((await readProfile(w.atlas.browser, w.atlasProfile)).activeJob).toMatchObject({ kind: "manual_review", status: "queued" });
  });

  it("can do all of that with a profile of their own, so the refusals are about ownership", async () => {
    const w = await world();
    const own = w.novaProfile;
    expect((await api.profile(w.nova.browser, own)).status).toBe(200);
    expect((await api.snapshots(w.nova.browser, own)).status).toBe(200);
    expect((await api.relationships(w.nova.browser, own)).status).toBe(200);
    expect((await api.events(w.nova.browser, own)).status).toBe(200);
    expect((await api.counts(w.nova.browser, own)).status).toBe(200);
    expect((await api.activity(w.nova.browser, `?profileId=${own}`)).status).toBe(200);
    expect((await api.review(w.nova.browser, own)).status).toBe(202);
    expect((await api.setStatus(w.nova.browser, own, { status: "paused" })).status).toBe(200);
    expect((await api.setStatus(w.nova.browser, own, { status: "active" })).status).toBe(200);
    expect((await api.removeProfile(w.nova.browser, own)).status).toBe(204);
  });
});

describe("user two sees only their own data", () => {
  it("gets an empty list before adding anything, while user one has a profile", async () => {
    const atlas = await register(ATLAS, "Atlas Owner");
    const atlasProfile = (await addProfile(atlas.browser, "atlas_studio")).id;
    await importInto(atlas.browser, atlasProfile, FIRST_EXPORT);
    const nova = await register(NOVA, "Nova Owner");

    expect(await body<Page<ProfileDto>>(await api.profiles(nova.browser))).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
    expect((await readActivity(nova.browser)).data).toEqual([]);
    expect((await readActivity(nova.browser, "?q=atlas")).data).toEqual([]);
    expect((await body<MeDto>(await api.me(nova.browser))).usage).toMatchObject({ profiles: 0, importsToday: 0, rosterBytes: 0 });
  });

  it("lists and searches only their own profile and activity", async () => {
    const w = await world();
    const lists = [
      await api.profiles(w.nova.browser),
      await api.activity(w.nova.browser),
      await api.activity(w.nova.browser, "?q=atlas"),
      await api.events(w.nova.browser, w.novaProfile),
      await api.relationships(w.nova.browser, w.novaProfile),
      await api.me(w.nova.browser),
    ];
    for (const response of lists) {
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const marker of w.atlasMarkers) expect(text).not.toContain(marker);
    }
    expect((await body<Page<ProfileDto>>(await api.profiles(w.nova.browser))).data.map((row) => row.handle)).toEqual(["sunset_field"]);
  });

  it("downloads an export that holds none of user one's handles or ids", async () => {
    const w = await world();

    const response = await api.download(w.nova.browser);
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const marker of w.atlasMarkers) expect(text).not.toContain(marker);
    const mine = JSON.parse(text) as AccountExport;
    expect(mine.account).toMatchObject({ id: w.nova.userId, email: NOVA });
    expect(mine.profiles.map((row) => row.handle)).toEqual(["sunset_field"]);
    expect(mine.snapshots.map((row) => row.followers)).toEqual([["sunset_field_01"]]);

    // The other direction, so the check above is not passing on an empty download.
    const theirs = await (await api.download(w.atlas.browser)).text();
    for (const marker of w.atlasMarkers) expect(theirs).toContain(marker);
    for (const marker of [w.nova.userId, NOVA, w.novaProfile, "sunset_field"]) expect(theirs).not.toContain(marker);
  });

  it("keeps the same handle in two accounts as two separate profiles", async () => {
    const w = await world();
    const twin = await addProfile(w.nova.browser, "atlas_studio");
    expect(twin.id).not.toBe(w.atlasProfile);
    expect(twin).toMatchObject({ handle: "atlas_studio", evidence: "missing", snapshotCount: 0, metrics: null });
    expect((await readEvents(w.nova.browser, twin.id)).data).toEqual([]);
    expect((await readProfile(w.atlas.browser, w.atlasProfile)).snapshotCount).toBe(2);
  });
});

describe("user two cannot become an admin", () => {
  it("gets not_found from both admin routes, like a signed-out caller, while the configured admin gets in", async () => {
    const w = await world();
    const owner = await register(OWNER, "Owner");

    for (const route of [api.adminUsers, api.adminCapacity]) {
      const refused = await route(w.nova.browser);
      expect({ status: refused.status, body: await refused.text() }).toEqual({ status: 404, body: NOT_FOUND });
      expect((await route(owner.browser)).status).toBe(200);
    }
    expect((await body<MeDto>(await api.me(w.nova.browser))).isAdmin).toBe(false);
    expect((await body<MeDto>(await api.me(owner.browser))).isAdmin).toBe(true);
  });

  it.each([
    ["isAdmin", { isAdmin: true }],
    ["role", { role: "admin" }],
    ["isAdmin beside an allowed field", { name: "Nova Owner", isAdmin: true }],
    ["status", { status: "active", role: "admin" }],
  ])("is refused when the account update names %s", async (_label, json) => {
    const nova = await register(NOVA, "Nova Owner");
    const before = await body<MeDto>(await api.me(nova.browser));

    const refused = await expectError(await api.patchMe(nova.browser, json), 422, "invalid_input");
    expect(refused.error.details?.fields).toEqual(Object.keys(json).filter((key) => key !== "name").sort());

    expect(await body<MeDto>(await api.me(nova.browser))).toEqual(before);
    await expectError(await api.adminUsers(nova.browser), 404, "not_found");
    await expectError(await api.adminCapacity(nova.browser), 404, "not_found");
  });

  it("is refused when any other request body names isAdmin or role", async () => {
    const atlas = await register(ATLAS, "Atlas Owner");
    const nova = await register(NOVA, "Nova Owner");
    const versions = { termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy };

    await expectError(await api.onboard(nova.browser, { ...versions, role: "admin" }), 422, "invalid_input");
    await expectError(await api.addProfile(nova.browser, { handle: "sunset_field", isAdmin: true }), 422, "invalid_input");
    await expectError(await api.addProfile(nova.browser, { handle: "sunset_field", userId: atlas.userId }), 422, "invalid_input");
    for (const json of [{ role: "admin" }, { name: "Nova Owner", isAdmin: true }]) {
      const response = await nova.browser.auth("/update-user", { json });
      expect({ status: response.status, code: (await response.json()).code }).toEqual({ status: 400, code: "FIELD_NOT_ALLOWED" });
    }
    for (const extra of [{ isAdmin: true }, { role: "admin" }]) {
      const response = await signUp({ email: "ember@orbitdiff.test", extra });
      expect({ status: response.status, code: (await response.json()).code }).toEqual({ status: 400, code: "FIELD_NOT_ALLOWED" });
    }

    expect(await body<Page<ProfileDto>>(await api.profiles(nova.browser))).toMatchObject({ data: [] });
    expect(await body<MeDto>(await api.me(nova.browser))).toMatchObject({ isAdmin: false, name: "Nova Owner" });
    await expectError(await api.adminUsers(nova.browser), 404, "not_found");
    await expectError(await api.adminCapacity(nova.browser), 404, "not_found");
  });
});
