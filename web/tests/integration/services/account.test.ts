import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { requireOnboardedUser } from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import { account, consentRecord, profile, session, user, verification } from "@/server/db/schema";
import {
  completeOnboarding,
  exportAccount,
  getMe,
  recordMarketingConsent,
  updateMe,
} from "@/server/services/account";
import { consentSatisfied, getConsentState, hasCurrentConsent } from "@/server/services/consent";
import { importExport } from "@/server/services/imports";
import { createProfile, setProfileStatus } from "@/server/services/profiles";

import { createVerifiedUser, resetDatabase, restoreTestEnv, signUp } from "../../helpers";
import {
  ATLAS,
  exportPayload,
  insertEvents,
  markDerived,
  NOVA,
  NOW,
  OWNER,
  thrown,
  withDocumentVersions,
} from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const db = () => getDb();
const withCookie = (cookie: string) => new Headers({ cookie });

const consentRows = (userId: string, kind?: string) =>
  db()
    .select()
    .from(consentRecord)
    .where(kind ? and(eq(consentRecord.userId, userId), eq(consentRecord.kind, kind)) : eq(consentRecord.userId, userId));

const userRow = async (userId: string) => (await db().select().from(user).where(eq(user.id, userId)))[0]!;

/** Replace the consent log of a user, to build one exact state. */
async function setConsent(
  userId: string,
  rows: Array<{ kind: string; version: string; granted: boolean; recordedAt: string }>,
): Promise<void> {
  await db().delete(consentRecord).where(eq(consentRecord.userId, userId));
  if (rows.length === 0) return;
  await db()
    .insert(consentRecord)
    .values(rows.map((row) => ({ ...row, userId, source: "signup", recordedAt: new Date(row.recordedAt) })));
}

const current = (kind: "terms" | "privacy", overrides: Partial<{ version: string; granted: boolean; recordedAt: string }> = {}) => ({
  kind,
  version: CONSENT_VERSIONS[kind],
  granted: true,
  recordedAt: "2026-09-30T08:00:00Z",
  ...overrides,
});

async function gateRefuses(cookie: string): Promise<void> {
  const error = await thrown(() => requireOnboardedUser(withCookie(cookie)));
  expect(error.code).toBe("conflict");
  expect(error.details).toEqual({ onboarding: true });
}

describe("consent state: the latest row per kind decides, and it fails closed", () => {
  it("passes with current terms and privacy consent", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect(await hasCurrentConsent(atlas.userId)).toBe(true);
    expect((await requireOnboardedUser(withCookie(atlas.cookie))).id).toBe(atlas.userId);
  });

  it("fails when there is no consent row", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, []);
    expect(await getConsentState(atlas.userId)).toEqual({ terms: null, privacy: null, marketing: null });
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("fails when the latest terms row is not granted", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [
      current("terms"),
      current("privacy"),
      current("terms", { granted: false, recordedAt: "2026-09-30T09:00:00Z" }),
    ]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("fails when the terms version is empty", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [current("terms", { version: "" }), current("privacy")]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("fails when the terms version is unknown", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [current("terms", { version: "2099-01-01" }), current("privacy")]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("fails when the terms version is older than the current one", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [current("terms", { version: "2025-01-01" }), current("privacy")]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("fails when privacy consent is missing although terms consent is current", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [current("terms")]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("is not rescued by an older granted row", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [
      current("terms", { recordedAt: "2026-09-30T08:00:00Z" }),
      current("terms", { version: "2025-01-01", recordedAt: "2026-09-30T09:00:00Z" }),
      current("privacy"),
    ]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("is not satisfied by marketing consent", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [
      { kind: "marketing", version: CONSENT_VERSIONS.marketing, granted: true, recordedAt: "2026-09-30T08:00:00Z" },
    ]);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    await gateRefuses(atlas.cookie);
  });

  it("reads each user's own log only", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await setConsent(nova.userId, []);
    expect(await hasCurrentConsent(atlas.userId)).toBe(true);
    expect(await hasCurrentConsent(nova.userId)).toBe(false);
  });

  it("judges a state without reading anything else", () => {
    const granted = { granted: true, version: CONSENT_VERSIONS.terms, recordedAt: "2026-09-30T08:00:00.000Z" };
    expect(consentSatisfied({ terms: granted, privacy: granted, marketing: null })).toBe(true);
    expect(consentSatisfied({ terms: granted, privacy: null, marketing: granted })).toBe(false);
    expect(consentSatisfied({ terms: { ...granted, granted: false }, privacy: granted, marketing: null })).toBe(false);
  });
});

describe("completeOnboarding", () => {
  async function outdated() {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await setConsent(atlas.userId, [current("terms", { version: "2025-01-01" }), current("privacy", { version: "2025-01-01" })]);
    return atlas;
  }

  /** What a page rendered right now sends: the versions of the two documents it showed. */
  const read = () => ({ termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy });
  const OLDER = "2025-01-01";
  const NEVER_PUBLISHED = "2099-01-01";
  const BUMPED = "2026-12-01";
  const BOTH = ["privacyVersion", "termsVersion"];

  const added = async (userId: string) =>
    (await consentRows(userId))
      .filter((row) => row.source === "onboarding")
      .map((row) => [row.kind, row.version, row.granted])
      .sort();

  /** One invalid request against an account whose recorded consent is outdated: refused, and nothing is written. */
  async function refused(input: unknown, fields: string[]) {
    const atlas = await outdated();
    const error = await thrown(() => completeOnboarding(atlas.userId, input as never, NOW));
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual({ fields });
    expect((await userRow(atlas.userId)).onboardedAt).toBeNull();
    expect(await consentRows(atlas.userId)).toHaveLength(2);
    expect(await hasCurrentConsent(atlas.userId)).toBe(false);
  }

  it("refuses a request that names no terms version", async () => {
    await refused({ privacyVersion: CONSENT_VERSIONS.privacy }, ["termsVersion"]);
  });

  it("refuses a request that names no privacy version", async () => {
    await refused({ termsVersion: CONSENT_VERSIONS.terms }, ["privacyVersion"]);
  });

  it("refuses a request that names no version at all", async () => {
    await refused({}, BOTH);
  });

  it("refuses an empty terms version", async () => {
    await refused({ ...read(), termsVersion: "" }, ["termsVersion"]);
  });

  it("refuses an empty privacy version", async () => {
    await refused({ ...read(), privacyVersion: "" }, ["privacyVersion"]);
  });

  it("refuses an outdated terms version", async () => {
    await refused({ ...read(), termsVersion: OLDER }, ["termsVersion"]);
  });

  it("refuses an outdated privacy version", async () => {
    await refused({ ...read(), privacyVersion: OLDER }, ["privacyVersion"]);
  });

  it("refuses a terms version that was never published", async () => {
    await refused({ ...read(), termsVersion: NEVER_PUBLISHED }, ["termsVersion"]);
  });

  it("refuses a privacy version that was never published", async () => {
    await refused({ ...read(), privacyVersion: NEVER_PUBLISHED }, ["privacyVersion"]);
  });

  it.each([
    ["the boolean true", true],
    ["the number 1", 1],
    ["null", null],
    ["a list holding the current version", [CONSENT_VERSIONS.terms]],
    ["an object holding the current version", { version: CONSENT_VERSIONS.terms }],
  ])("refuses %s as the terms version", async (_label, value) => {
    await refused({ ...read(), termsVersion: value }, ["termsVersion"]);
  });

  it.each([
    ["a leading space", ` ${CONSENT_VERSIONS.privacy}`],
    ["a trailing space", `${CONSENT_VERSIONS.privacy} `],
    ["a trailing line break", `${CONSENT_VERSIONS.privacy}\n`],
    ["text after it", `${CONSENT_VERSIONS.privacy}-draft`],
  ])("refuses the current privacy version with %s", async (_label, value) => {
    await refused({ ...read(), privacyVersion: value }, ["privacyVersion"]);
  });

  it("refuses the acceptance flags of the earlier contract, which name no version", async () => {
    await refused({ acceptTerms: true, acceptPrivacy: true }, ["acceptPrivacy", "acceptTerms", ...BOTH]);
  });

  it("refuses with only marketing accepted", async () => {
    await refused({ marketing: true }, ["marketing", ...BOTH]);
  });

  it("refuses marketing bundled into the acceptance", async () => {
    await refused({ ...read(), marketing: true }, ["marketing"]);
  });

  it("does not repeat what was sent in the refusal", async () => {
    const atlas = await outdated();
    const error = await thrown(() =>
      completeOnboarding(atlas.userId, { ...read(), termsVersion: "probe-value-7" } as never, NOW),
    );
    expect(error.message).not.toContain("probe-value-7");
  });

  it("refuses the versions an open page still holds after both documents changed", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const stale = read();
    await withDocumentVersions({ terms: BUMPED, privacy: BUMPED }, async () => {
      const before = await consentRows(atlas.userId);
      const error = await thrown(() => completeOnboarding(atlas.userId, stale, NOW));
      expect(error.code).toBe("invalid_input");
      expect(error.details).toEqual({ fields: BOTH });
      expect(await consentRows(atlas.userId)).toEqual(before);
      expect((await userRow(atlas.userId)).onboardedAt).toBeNull();
      expect(await hasCurrentConsent(atlas.userId)).toBe(false);
    });
  });

  it("refuses the earlier privacy version after only the privacy notice changed, and records no terms row either", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const stale = read();
    await withDocumentVersions({ privacy: BUMPED }, async () => {
      const error = await thrown(() => completeOnboarding(atlas.userId, stale, NOW));
      expect(error.code).toBe("invalid_input");
      expect(error.details).toEqual({ fields: ["privacyVersion"] });
      expect(await added(atlas.userId)).toEqual([]);
      expect((await userRow(atlas.userId)).onboardedAt).toBeNull();
    });
  });

  it("refuses versions swapped between the two documents", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await withDocumentVersions({ privacy: BUMPED }, async () => {
      const swapped = { termsVersion: CONSENT_VERSIONS.privacy, privacyVersion: CONSENT_VERSIONS.terms };
      const error = await thrown(() => completeOnboarding(atlas.userId, swapped, NOW));
      expect(error.code).toBe("invalid_input");
      expect(error.details).toEqual({ fields: BOTH });
      expect(await added(atlas.userId)).toEqual([]);
    });
  });

  it("records the versions the request names and sets onboarded_at", async () => {
    const atlas = await outdated();
    const me = await completeOnboarding(atlas.userId, read(), NOW);
    expect(me.onboarded).toBe(true);
    expect(await consentRows(atlas.userId)).toHaveLength(4);
    expect(await added(atlas.userId)).toEqual([
      ["privacy", CONSENT_VERSIONS.privacy, true],
      ["terms", CONSENT_VERSIONS.terms, true],
    ]);
    const stored = await userRow(atlas.userId);
    expect(stored.onboardedAt?.toISOString()).toBe(NOW.toISOString());
    expect(stored.acceptedTermsVersion).toBe(CONSENT_VERSIONS.terms);
    expect((await requireOnboardedUser(withCookie(atlas.cookie))).id).toBe(atlas.userId);
  });

  it("records the new versions once a request names them", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await withDocumentVersions({ terms: BUMPED, privacy: BUMPED }, async () => {
      const me = await completeOnboarding(atlas.userId, { termsVersion: BUMPED, privacyVersion: BUMPED }, NOW);
      expect(me.onboarded).toBe(true);
      expect(await added(atlas.userId)).toEqual([
        ["privacy", BUMPED, true],
        ["terms", BUMPED, true],
      ]);
      expect((await userRow(atlas.userId)).acceptedTermsVersion).toBe(BUMPED);
      expect((await requireOnboardedUser(withCookie(atlas.cookie))).id).toBe(atlas.userId);
    });
  });

  it("records only the document that changed for an account that was already onboarded", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await completeOnboarding(atlas.userId, read(), NOW);
    const before = await added(atlas.userId);
    await withDocumentVersions({ privacy: BUMPED }, async () => {
      await gateRefuses(atlas.cookie);
      await completeOnboarding(atlas.userId, read(), new Date("2026-12-02T00:00:00Z"));
      expect(await added(atlas.userId)).toEqual([["privacy", BUMPED, true], ...before].sort());
      expect((await requireOnboardedUser(withCookie(atlas.cookie))).id).toBe(atlas.userId);
    });
  });

  it("never creates or changes marketing consent", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const before = await consentRows(atlas.userId, "marketing");
    await completeOnboarding(atlas.userId, read(), NOW);
    expect(await consentRows(atlas.userId, "marketing")).toEqual(before);
    expect((await userRow(atlas.userId)).marketingOptIn).toBe(false);
    expect((await getConsentState(atlas.userId)).marketing?.granted).toBe(false);
  });

  it("adds nothing when onboarding is already complete", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    await completeOnboarding(atlas.userId, read(), NOW);
    const before = await consentRows(atlas.userId);
    await completeOnboarding(atlas.userId, read(), new Date("2026-10-05T00:00:00Z"));
    expect(await consentRows(atlas.userId)).toHaveLength(before.length);
    expect((await userRow(atlas.userId)).onboardedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("answers not_found for a user that does not exist", async () => {
    const error = await thrown(() => completeOnboarding("missing-user", read(), NOW));
    expect(error.code).toBe("not_found");
  });
});

describe("recordMarketingConsent", () => {
  it("appends a granted marketing row from settings", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const state = await recordMarketingConsent(atlas.userId, true, NOW);
    expect(state.marketing).toMatchObject({ granted: true, version: CONSENT_VERSIONS.marketing });
    const rows = await consentRows(atlas.userId, "marketing");
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.source === "settings")).toMatchObject({ granted: true });
    expect((await userRow(atlas.userId)).marketingOptIn).toBe(true);
  });

  it("withdraws by appending, never by editing the log", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await recordMarketingConsent(atlas.userId, true, NOW);
    const state = await recordMarketingConsent(atlas.userId, false, NOW);
    expect(state.marketing?.granted).toBe(false);
    const rows = await consentRows(atlas.userId, "marketing");
    expect(rows.map((row) => row.granted).sort()).toEqual([false, false, true]);
    expect((await userRow(atlas.userId)).marketingOptIn).toBe(false);
  });

  it("does not affect terms or privacy consent when marketing is withdrawn", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const before = [...(await consentRows(atlas.userId, "terms")), ...(await consentRows(atlas.userId, "privacy"))];
    await recordMarketingConsent(atlas.userId, true, NOW);
    await recordMarketingConsent(atlas.userId, false, NOW);
    const after = [...(await consentRows(atlas.userId, "terms")), ...(await consentRows(atlas.userId, "privacy"))];
    expect(after).toEqual(before);
    expect(await hasCurrentConsent(atlas.userId)).toBe(true);
    expect((await requireOnboardedUser(withCookie(atlas.cookie))).id).toBe(atlas.userId);
  });

  it("rejects a value that is not a boolean", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const error = await thrown(() => recordMarketingConsent(atlas.userId, "yes" as never, NOW));
    expect(error.code).toBe("invalid_input");
    expect(await consentRows(atlas.userId, "marketing")).toHaveLength(1);
  });
});

describe("getMe", () => {
  it("returns the account, consent state, and usage of the user", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas", timezone: "Europe/Berlin", onboarded: true });
    await createProfile(atlas.userId, "atlas_studio", NOW);
    const me = await getMe(atlas.userId, NOW);
    expect(me).toMatchObject({
      id: atlas.userId,
      email: ATLAS,
      name: "Atlas",
      timezone: "Europe/Berlin",
      reviewHour: 9,
      onboarded: true,
      isAdmin: false,
      usage: {
        profiles: 1,
        profilesLimit: LIMITS.profilesPerUser,
        importsToday: 0,
        importsPerDayLimit: LIMITS.importsPerUserPerDay,
        rosterBytes: 0,
        rosterBytesLimit: LIMITS.rosterBytesPerUser,
      },
    });
    expect(me.consent.terms).toMatchObject({ granted: true, version: CONSENT_VERSIONS.terms });
    expect(me.consent.marketing).toMatchObject({ granted: false });
  });

  it("reports onboarded false until onboarding is complete", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    expect((await getMe(atlas.userId, NOW)).onboarded).toBe(false);
  });

  it("reports onboarded false when consent is no longer current", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await setConsent(atlas.userId, [current("terms", { version: "2025-01-01" }), current("privacy")]);
    expect((await getMe(atlas.userId, NOW)).onboarded).toBe(false);
  });

  it("reports isAdmin only for a configured address", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    const nova = await createVerifiedUser({ email: NOVA });
    expect((await getMe(owner.userId, NOW)).isAdmin).toBe(true);
    expect((await getMe(nova.userId, NOW)).isAdmin).toBe(false);
  });

  it("does not report an unverified configured address as admin", async () => {
    await signUp({ email: OWNER });
    const [pending] = await db().select().from(user).where(eq(user.email, OWNER));
    expect((await getMe(pending!.id, NOW)).isAdmin).toBe(false);
  });

  it("answers not_found for a user that does not exist", async () => {
    expect((await thrown(() => getMe("missing-user", NOW))).code).toBe("not_found");
  });
});

describe("updateMe", () => {
  it("changes the name", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const me = await updateMe(atlas.userId, { name: "  Atlas Studio  " }, NOW);
    expect(me.name).toBe("Atlas Studio");
    expect((await userRow(atlas.userId)).name).toBe("Atlas Studio");
  });

  it("rejects an empty name", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas", onboarded: true });
    expect((await thrown(() => updateMe(atlas.userId, { name: "   " }, NOW))).code).toBe("invalid_input");
    expect((await userRow(atlas.userId)).name).toBe("Atlas");
  });

  it("changes the timezone and review hour", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const me = await updateMe(atlas.userId, { timezone: "Asia/Tokyo", reviewHour: 0 }, NOW);
    expect(me).toMatchObject({ timezone: "Asia/Tokyo", reviewHour: 0 });
  });

  it("rejects a UTC offset as a timezone", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const error = await thrown(() => updateMe(atlas.userId, { timezone: "+05:00" }, NOW));
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual({ fields: ["timezone"] });
    expect((await userRow(atlas.userId)).timezone).toBe("UTC");
  });

  it("rejects a timezone name that does not exist", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await thrown(() => updateMe(atlas.userId, { timezone: "Mars/Olympus" }, NOW))).code).toBe("invalid_input");
  });

  it.each([24, -1, 1.5, Number.NaN])("rejects the review hour %s", async (reviewHour) => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const error = await thrown(() => updateMe(atlas.userId, { reviewHour }, NOW));
    expect(error.code).toBe("invalid_input");
    expect((await userRow(atlas.userId)).reviewHour).toBe(9);
  });

  it("accepts the review hours 0 and 23", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await updateMe(atlas.userId, { reviewHour: 0 }, NOW)).reviewHour).toBe(0);
    expect((await updateMe(atlas.userId, { reviewHour: 23 }, NOW)).reviewHour).toBe(23);
  });

  it("rejects a change with no field", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    expect((await thrown(() => updateMe(atlas.userId, {}, NOW))).code).toBe("invalid_input");
  });

  it("rejects a field it does not own, such as status", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const error = await thrown(() => updateMe(atlas.userId, { name: "Atlas", status: "suspended" } as never, NOW));
    expect(error.code).toBe("invalid_input");
    expect((await userRow(atlas.userId)).status).toBe("active");
  });

  it("recomputes the next review of active profiles when the schedule changes", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const active = await createProfile(atlas.userId, "atlas_studio", NOW);
    expect(active.nextReviewAt).toBe("2026-10-01T09:00:00.000Z");
    await updateMe(atlas.userId, { timezone: "Asia/Tokyo", reviewHour: 6 }, NOW);
    // 12:00 UTC is 21:00 in Tokyo; the next 06:00 there is 21:00 UTC the same day.
    const [row] = await db().select().from(profile).where(eq(profile.id, active.id));
    expect(row?.nextReviewAt?.toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });

  it("leaves a paused profile without a next review", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const paused = await createProfile(atlas.userId, "atlas_studio", NOW);
    await setProfileStatus(atlas.userId, paused.id, "paused", NOW);
    await updateMe(atlas.userId, { reviewHour: 6 }, NOW);
    const [row] = await db().select().from(profile).where(eq(profile.id, paused.id));
    expect(row?.nextReviewAt).toBeNull();
  });

  it("does not reschedule when only the name changes", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await updateMe(atlas.userId, { name: "Atlas" }, new Date("2026-10-03T00:00:00Z"));
    const [row] = await db().select().from(profile).where(eq(profile.id, created.id));
    expect(row?.nextReviewAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("leaves another user's profiles alone", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    const theirs = await createProfile(nova.userId, "nova_labs", NOW);
    await updateMe(atlas.userId, { timezone: "Asia/Tokyo", reviewHour: 6 }, NOW);
    const [row] = await db().select().from(profile).where(eq(profile.id, theirs.id));
    expect(row?.nextReviewAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect((await userRow(nova.userId)).timezone).toBe("UTC");
  });
});

describe("exportAccount", () => {
  async function populated() {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas", onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio", NOW);
    await importExport(atlas.userId, created.id, exportPayload(), NOW);
    await importExport(
      atlas.userId,
      created.id,
      exportPayload({ capturedAt: "2026-09-08T12:00:00+00:00", followers: ["ember_lab", "nova_labs"] }),
      NOW,
    );
    await insertEvents(atlas.userId, created.id, [{ type: "follower_observed_added", username: "ember_lab" }]);
    await markDerived(created.id);
    await recordMarketingConsent(atlas.userId, true, NOW);
    return { atlas, profileId: created.id };
  }

  it("returns everything stored for the user", async () => {
    const { atlas, profileId } = await populated();
    const exported = await exportAccount(atlas.userId, NOW);
    expect(exported.exportedAt).toBe(NOW.toISOString());
    expect(exported.account).toMatchObject({ id: atlas.userId, email: ATLAS, name: "Atlas", timezone: "UTC", reviewHour: 9 });
    expect(exported.consent.map((row) => row.kind).sort()).toEqual(["marketing", "marketing", "privacy", "terms"]);
    expect(exported.profiles).toHaveLength(1);
    expect(exported.profiles[0]).toMatchObject({ id: profileId, handle: "atlas_studio", status: "active" });
    expect(exported.snapshots).toHaveLength(2);
    expect(exported.snapshots.map((snapshot) => snapshot.followers)).toContainEqual(["ember_lab", "nova_labs"]);
    expect(exported.snapshots[0]).toMatchObject({ profileId, following: ["nova_labs", "pixel_forge"] });
    expect(exported.events).toEqual([
      expect.objectContaining({ profileId, type: "follower_observed_added", username: "ember_lab", evidence: "export_observation" }),
    ]);
    expect(exported.activity.map((entry) => entry.kind).sort()).toEqual([
      "import_processed",
      "import_received",
      "import_received",
      "profile_added",
    ]);
    expect(exported.jobs).toHaveLength(1);
    expect(exported.jobs[0]).toMatchObject({ profileId, kind: "derive_profile", status: "succeeded" });
    expect(exported.usage).toEqual([{ day: "2026-09-30", scope: "account", profileId: null, imports: 2, manualReviews: 0, jobs: 0 }]);
    expect(exported.signIns).toHaveLength(1);
  });

  it("contains no password hash, session token, or verification value", async () => {
    const { atlas } = await populated();
    const [credential] = await db().select().from(account).where(eq(account.userId, atlas.userId));
    const sessions = await db().select().from(session).where(eq(session.userId, atlas.userId));
    await db().insert(verification).values({
      id: "v1",
      identifier: `reset-password:${atlas.userId}`,
      value: "verification-value-1",
      expiresAt: new Date("2026-10-01T00:00:00Z"),
    });
    const text = JSON.stringify(await exportAccount(atlas.userId, NOW));
    expect(credential?.password).toBeTruthy();
    expect(text).not.toContain(credential!.password!);
    expect(sessions).toHaveLength(1);
    for (const row of sessions) {
      expect(text).not.toContain(row.token);
      expect(text).not.toContain(row.id);
    }
    expect(text).not.toContain("verification-value-1");
    expect(text).not.toMatch(/"(password|token|lockToken|value)"/);
  });

  it("answers not_found for a user that does not exist", async () => {
    expect((await thrown(() => exportAccount("missing-user", NOW))).code).toBe("not_found");
  });
});
