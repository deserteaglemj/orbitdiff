import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as consentPOST } from "@/app/api/me/consent/route";
import { POST as onboardingPOST } from "@/app/api/me/onboarding/route";
import { GET, PATCH } from "@/app/api/me/route";
import { GET as profilesGET } from "@/app/api/profiles/route";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv } from "../../helpers";
import { ATLAS, OWNER, withDocumentVersions } from "../services/support";
import { callRaw, expectError } from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const userRow = async (userId: string) => (await getDb().select().from(user).where(eq(user.id, userId)))[0]!;
const consentRows = (userId: string) => getDb().select().from(consentRecord).where(eq(consentRecord.userId, userId));

describe("GET /api/me", () => {
  it("answers 401 without a session", async () => {
    await expectError(await callRoute(GET, { url: "/api/me" }), 401, "unauthenticated");
  });

  it("returns the signed-in user before onboarding is complete", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas" });
    const response = await callRoute(GET, { url: "/api/me", cookie: atlas.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      id: atlas.userId,
      email: ATLAS,
      name: "Atlas",
      timezone: "UTC",
      reviewHour: 9,
      onboarded: false,
      isAdmin: false,
    });
  });

  it("reports isAdmin for the configured address only", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    const body = await (await callRoute(GET, { url: "/api/me", cookie: owner.cookie })).json();
    expect(body.isAdmin).toBe(true);
  });

  it("answers 403 to a suspended account", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    await expectError(await callRoute(GET, { url: "/api/me", cookie: atlas.cookie }), 403, "suspended");
  });
});

describe("PATCH /api/me", () => {
  const patch = (cookie: string | undefined, json: unknown, origin?: string | null) =>
    callRoute(PATCH, { method: "PATCH", url: "/api/me", cookie, json, origin });

  it("changes the name, timezone, and review hour", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await patch(atlas.cookie, { name: "Atlas Studio", timezone: "Europe/Berlin", reviewHour: 7 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Atlas Studio", timezone: "Europe/Berlin", reviewHour: 7 });
    expect(await userRow(atlas.userId)).toMatchObject({ name: "Atlas Studio", timezone: "Europe/Berlin", reviewHour: 7 });
  });

  it.each([
    ["isAdmin", true],
    ["role", "admin"],
    ["status", "active"],
    ["emailVerified", true],
    ["onboardedAt", "2026-09-30T12:00:00.000Z"],
    ["email", "owner@orbitdiff.test"],
    ["marketingOptIn", true],
    ["acceptedTermsVersion", "2026-09-30"],
  ])("rejects %s in the body and changes nothing", async (field, value) => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas" });
    const before = await userRow(atlas.userId);
    const body = await expectError(await patch(atlas.cookie, { name: "Changed", [field]: value }), 422, "invalid_input");
    expect(body.error.details).toEqual({ fields: [field] });
    expect(await userRow(atlas.userId)).toEqual(before);
    const me = await (await callRoute(GET, { url: "/api/me", cookie: atlas.cookie })).json();
    expect(me).toMatchObject({ name: "Atlas", isAdmin: false, onboarded: false });
  });

  it("rejects a review hour out of range", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await patch(atlas.cookie, { reviewHour: 24 }), 422, "invalid_input");
  });

  it("rejects a timezone that is not an IANA name", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await patch(atlas.cookie, { timezone: "+02:00" }), 422, "invalid_input");
  });

  it("answers 403 without an Origin header", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas" });
    await expectError(await patch(atlas.cookie, { name: "Changed" }, null), 403, "forbidden_origin");
    expect((await userRow(atlas.userId)).name).toBe("Atlas");
  });

  it("answers 403 to another origin", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas" });
    await expectError(await patch(atlas.cookie, { name: "Changed" }, "https://elsewhere.test"), 403, "forbidden_origin");
    expect((await userRow(atlas.userId)).name).toBe("Atlas");
  });

  it("answers 401 without a session", async () => {
    await expectError(await patch(undefined, { name: "Changed" }), 401, "unauthenticated");
  });

  it("rejects a body over the byte cap", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await callRaw(PATCH, {
      method: "PATCH",
      url: "/api/me",
      cookie: atlas.cookie,
      body: JSON.stringify({ name: "a".repeat(20_000) }),
    });
    const body = await expectError(response, 422, "invalid_input");
    expect(body.error.details).toHaveProperty("maxBytes");
  });

  it("rejects a body that is not JSON", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await callRaw(PATCH, {
      method: "PATCH",
      url: "/api/me",
      cookie: atlas.cookie,
      body: "name=Changed",
      contentType: "application/x-www-form-urlencoded",
    });
    await expectError(response, 422, "invalid_input");
  });
});

describe("POST /api/me/consent", () => {
  const post = (cookie: string | undefined, json: unknown, origin?: string | null) =>
    callRoute(consentPOST, { method: "POST", url: "/api/me/consent", cookie, json, origin });

  it("records a marketing consent change", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await post(atlas.cookie, { granted: true });
    expect(response.status).toBe(200);
    expect((await response.json()).marketing).toMatchObject({ granted: true, version: CONSENT_VERSIONS.marketing });
    const rows = await getDb()
      .select()
      .from(consentRecord)
      .where(and(eq(consentRecord.userId, atlas.userId), eq(consentRecord.kind, "marketing")));
    expect(rows.map((row) => row.source).sort()).toEqual(["settings", "signup"]);
  });

  it("rejects a value that is not a boolean", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await post(atlas.cookie, { granted: "true" }), 422, "invalid_input");
  });

  it("rejects an attempt to record terms consent through this route", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const before = await consentRows(atlas.userId);
    await expectError(await post(atlas.cookie, { granted: true, kind: "terms" }), 422, "invalid_input");
    expect(await consentRows(atlas.userId)).toEqual(before);
  });

  it("answers 403 without an Origin header", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await post(atlas.cookie, { granted: true }, null), 403, "forbidden_origin");
  });

  it("answers 401 without a session", async () => {
    await expectError(await post(undefined, { granted: true }), 401, "unauthenticated");
  });
});

describe("POST /api/me/onboarding", () => {
  const post = (cookie: string | undefined, json: unknown, origin?: string | null) =>
    callRoute(onboardingPOST, { method: "POST", url: "/api/me/onboarding", cookie, json, origin });
  const product = (cookie: string) => callRoute(profilesGET, { url: "/api/profiles", cookie });

  /** What a page rendered right now sends: the versions of the two documents it showed. */
  const read = () => ({ termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy });
  const BUMPED = "2026-12-01";
  const BOTH = ["privacyVersion", "termsVersion"];
  /** Consent rows as kind:version:granted:source, sorted. */
  const log = async (userId: string) =>
    (await consentRows(userId)).map((row) => `${row.kind}:${row.version}:${row.granted}:${row.source}`).sort();

  async function refused(json: unknown, fields: string[]): Promise<void> {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const before = await consentRows(atlas.userId);
    const refusal = await expectError(await post(atlas.cookie, json), 422, "invalid_input");
    expect(refusal.error.details).toEqual({ fields });
    expect((await userRow(atlas.userId)).onboardedAt).toBeNull();
    expect(await consentRows(atlas.userId)).toEqual(before);
    const body = await expectError(await product(atlas.cookie), 409, "conflict");
    expect(body.error.details).toEqual({ onboarding: true });
  }

  it("refuses a body that names no terms version", async () => {
    await refused({ privacyVersion: CONSENT_VERSIONS.privacy }, ["termsVersion"]);
  });

  it("refuses a body that names no privacy version", async () => {
    await refused({ termsVersion: CONSENT_VERSIONS.terms }, ["privacyVersion"]);
  });

  it("refuses an empty object", async () => {
    await refused({}, BOTH);
  });

  it("refuses an empty terms version", async () => {
    await refused({ ...read(), termsVersion: "" }, ["termsVersion"]);
  });

  it("refuses an outdated terms version", async () => {
    await refused({ ...read(), termsVersion: "2025-01-01" }, ["termsVersion"]);
  });

  it("refuses an outdated privacy version", async () => {
    await refused({ ...read(), privacyVersion: "2025-01-01" }, ["privacyVersion"]);
  });

  it("refuses a terms version that was never published", async () => {
    await refused({ ...read(), termsVersion: "2099-01-01" }, ["termsVersion"]);
  });

  it("refuses the boolean true as a version", async () => {
    await refused({ termsVersion: true, privacyVersion: true }, BOTH);
  });

  it("refuses the current privacy version with a trailing space", async () => {
    await refused({ ...read(), privacyVersion: `${CONSENT_VERSIONS.privacy} ` }, ["privacyVersion"]);
  });

  it("refuses the acceptance flags of the earlier contract, which name no version", async () => {
    await refused({ acceptTerms: true, acceptPrivacy: true }, ["acceptPrivacy", "acceptTerms", ...BOTH]);
  });

  it("refuses the sign-up field name for the terms version", async () => {
    await refused({ acceptedTermsVersion: CONSENT_VERSIONS.terms }, ["acceptedTermsVersion", ...BOTH]);
  });

  it("refuses a body with only marketing accepted", async () => {
    await refused({ marketing: true }, ["marketing", ...BOTH]);
  });

  it("refuses marketing bundled into the acceptance", async () => {
    await refused({ ...read(), marketingOptIn: true }, ["marketingOptIn"]);
  });

  it("does not repeat what was sent in the refusal", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await post(atlas.cookie, { ...read(), termsVersion: "probe-value-7" });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("probe-value-7");
  });

  it("refuses the versions an open page still holds after both documents changed", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await product(atlas.cookie)).status).toBe(200);
    const stale = read();
    await withDocumentVersions({ terms: BUMPED, privacy: BUMPED }, async () => {
      await expectError(await product(atlas.cookie), 409, "conflict");
      const before = await log(atlas.userId);
      const refusal = await expectError(await post(atlas.cookie, stale), 422, "invalid_input");
      expect(refusal.error.details).toEqual({ fields: BOTH });
      expect(await log(atlas.userId)).toEqual(before);
      await expectError(await product(atlas.cookie), 409, "conflict");
    });
  });

  it("does not record the new versions for a request that names none", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await withDocumentVersions({ terms: BUMPED, privacy: BUMPED }, async () => {
      const before = await log(atlas.userId);
      await expectError(await post(atlas.cookie, { acceptTerms: true, acceptPrivacy: true }), 422, "invalid_input");
      expect(await log(atlas.userId)).toEqual(before);
      await expectError(await product(atlas.cookie), 409, "conflict");
    });
  });

  it("refuses the earlier privacy version after only the privacy notice changed", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const stale = read();
    await withDocumentVersions({ privacy: BUMPED }, async () => {
      const before = await log(atlas.userId);
      const refusal = await expectError(await post(atlas.cookie, stale), 422, "invalid_input");
      expect(refusal.error.details).toEqual({ fields: ["privacyVersion"] });
      expect(await log(atlas.userId)).toEqual(before);
      await expectError(await product(atlas.cookie), 409, "conflict");
    });
  });

  it("records the new versions once the request names them, and opens the product routes again", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await withDocumentVersions({ terms: BUMPED, privacy: BUMPED }, async () => {
      await expectError(await product(atlas.cookie), 409, "conflict");
      const response = await post(atlas.cookie, { termsVersion: BUMPED, privacyVersion: BUMPED });
      expect(response.status).toBe(200);
      expect(await log(atlas.userId)).toEqual(
        expect.arrayContaining([`privacy:${BUMPED}:true:onboarding`, `terms:${BUMPED}:true:onboarding`]),
      );
      expect((await product(atlas.cookie)).status).toBe(200);
    });
  });

  it("completes onboarding and opens the product routes", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await product(atlas.cookie), 409, "conflict");
    const response = await post(atlas.cookie, read());
    expect(response.status).toBe(200);
    expect((await response.json()).onboarded).toBe(true);
    expect((await userRow(atlas.userId)).onboardedAt).toBeInstanceOf(Date);
    expect(await log(atlas.userId)).toEqual(
      expect.arrayContaining([
        `privacy:${CONSENT_VERSIONS.privacy}:true:onboarding`,
        `terms:${CONSENT_VERSIONS.terms}:true:onboarding`,
      ]),
    );
    expect((await product(atlas.cookie)).status).toBe(200);
  });

  it("does not create or change marketing consent", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const marketing = async () => (await consentRows(atlas.userId)).filter((row) => row.kind === "marketing");
    const before = await marketing();
    expect((await post(atlas.cookie, read())).status).toBe(200);
    expect(await marketing()).toEqual(before);
    expect((await userRow(atlas.userId)).marketingOptIn).toBe(false);
  });

  it("answers 403 without an Origin header", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await expectError(await post(atlas.cookie, read(), null), 403, "forbidden_origin");
    expect((await userRow(atlas.userId)).onboardedAt).toBeNull();
  });

  it("answers 401 without a session", async () => {
    await expectError(await post(undefined, read()), 401, "unauthenticated");
  });
});

describe("product routes fail closed on consent", () => {
  const product = (cookie: string) => callRoute(profilesGET, { url: "/api/profiles", cookie });

  async function gateRefuses(mutate: (userId: string) => Promise<unknown>): Promise<void> {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await product(atlas.cookie)).status).toBe(200);
    await mutate(atlas.userId);
    const body = await expectError(await product(atlas.cookie), 409, "conflict");
    expect(body.error.details).toEqual({ onboarding: true });
  }

  const terms = (userId: string) => and(eq(consentRecord.userId, userId), eq(consentRecord.kind, "terms"));

  it("refuses when there is no consent row", async () => {
    await gateRefuses((userId) => getDb().delete(consentRecord).where(eq(consentRecord.userId, userId)));
  });

  it("refuses when the latest terms row is granted false", async () => {
    await gateRefuses((userId) =>
      getDb().insert(consentRecord).values({
        userId,
        kind: "terms",
        version: CONSENT_VERSIONS.terms,
        granted: false,
        source: "settings",
        recordedAt: new Date(Date.now() + 60_000),
      }),
    );
  });

  it("refuses when the terms version is empty", async () => {
    await gateRefuses((userId) => getDb().update(consentRecord).set({ version: "" }).where(terms(userId)));
  });

  it("refuses when the terms version is unknown", async () => {
    await gateRefuses((userId) => getDb().update(consentRecord).set({ version: "2099-01-01" }).where(terms(userId)));
  });

  it("refuses when the terms version is older than the current one", async () => {
    await gateRefuses((userId) => getDb().update(consentRecord).set({ version: "2025-01-01" }).where(terms(userId)));
  });

  it("refuses when onboarded_at is not set although consent is current", async () => {
    await gateRefuses((userId) => getDb().update(user).set({ onboardedAt: null }).where(eq(user.id, userId)));
  });
});
