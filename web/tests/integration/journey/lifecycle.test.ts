import { sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import type { AccountExport } from "@/server/services/account";
import type { JobDto, MeDto, Page, ProfileDto } from "@/server/services/contracts";

import { authRequest, resetDatabase, restoreTestEnv, TEST_PASSWORD } from "../../helpers";
import { expectError, keysOf } from "../api/support";
import {
  addProfile,
  api,
  ATLAS,
  body,
  Browser,
  type Customer,
  type ExportBody,
  FIRST_CAPTURE,
  FIRST_EXPORT,
  importInto,
  mailLink,
  NOVA,
  readActivity,
  readEvents,
  readProfile,
  register,
  runBatch,
  SECOND_CAPTURE,
  SECOND_EXPORT,
  signInFrom,
} from "./support";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const NEW_PASSWORD = "orbit-test-pw-2";

const NOVA_EXPORT: ExportBody = {
  account: "sunset_field",
  capturedAt: "2026-09-05T12:00:00+00:00",
  completeFollowers: true,
  completeFollowing: true,
  followers: ["sunset_field_01"],
  following: ["sunset_field_02"],
  shards: { followers: [0], following: [0] },
};

interface Owner extends Customer {
  profileId: string;
}

/** A customer with a profile, two processed imports, export observations, and a review that is waiting. */
async function atlasWithHistory(): Promise<Owner> {
  const atlas = await register(ATLAS, "Atlas Owner");
  const profileId = (await addProfile(atlas.browser, "atlas_studio")).id;
  await importInto(atlas.browser, profileId, FIRST_EXPORT);
  await importInto(atlas.browser, profileId, SECOND_EXPORT);
  await body<JobDto>(await api.review(atlas.browser, profileId), 202);
  return { ...atlas, profileId };
}

async function novaWithHistory(): Promise<Owner> {
  const nova = await register(NOVA, "Nova Owner");
  const profileId = (await addProfile(nova.browser, "sunset_field")).id;
  await importInto(nova.browser, profileId, NOVA_EXPORT);
  await body<JobDto>(await api.review(nova.browser, profileId), 202);
  return { ...nova, profileId };
}

describe("the account export", () => {
  it("holds the account, consent history, profiles, snapshots with rosters, events, activity, and jobs", async () => {
    const atlas = await atlasWithHistory();

    const response = await api.download(atlas.browser);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="orbitdiff-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const data = JSON.parse(text) as AccountExport;

    expect(data).toMatchObject({ format: "orbitdiff.account-export", version: 1 });
    expect(data.account).toMatchObject({
      id: atlas.userId,
      email: ATLAS,
      name: "Atlas Owner",
      emailVerified: true,
      status: "active",
      timezone: "UTC",
      acceptedTermsVersion: CONSENT_VERSIONS.terms,
    });
    expect(data.account.onboardedAt).not.toBeNull();
    expect(data.signIns).toHaveLength(1);

    // Consent history: what was accepted at sign-up and again at onboarding, and the product news choice.
    expect(data.consent.map(({ kind, version, granted, source }) => `${source} ${kind} ${version} ${granted}`).sort()).toEqual(
      [
        `onboarding privacy ${CONSENT_VERSIONS.privacy} true`,
        `onboarding terms ${CONSENT_VERSIONS.terms} true`,
        `signup marketing ${CONSENT_VERSIONS.marketing} false`,
        `signup privacy ${CONSENT_VERSIONS.privacy} true`,
        `signup terms ${CONSENT_VERSIONS.terms} true`,
      ].sort(),
    );

    expect(data.profiles).toMatchObject([
      { id: atlas.profileId, handle: "atlas_studio", status: "active", contentRevision: 2, derivedRevision: 2 },
    ]);
    expect(data.profiles[0]?.summary).toMatchObject({ metrics: { followers: 2, following: 2, mutuals: 1 }, eventCount: 2 });

    // Snapshots carry the rosters the customer imported, exactly.
    expect(
      data.snapshots.map(({ profileId, capturedAt, isCurrent, followers, following, declaredComplete, source }) => ({
        profileId,
        capturedAt,
        isCurrent,
        followers,
        following,
        declaredComplete,
        source,
      })),
    ).toEqual([
      {
        profileId: atlas.profileId,
        capturedAt: FIRST_CAPTURE,
        isCurrent: false,
        followers: FIRST_EXPORT.followers,
        following: FIRST_EXPORT.following,
        declaredComplete: { followers: true, following: true },
        source: "instagram_export",
      },
      {
        profileId: atlas.profileId,
        capturedAt: SECOND_CAPTURE,
        isCurrent: true,
        followers: SECOND_EXPORT.followers,
        following: SECOND_EXPORT.following,
        declaredComplete: { followers: true, following: true },
        source: "instagram_export",
      },
    ]);
    for (const snapshot of data.snapshots) expect(snapshot.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);

    // The same export observations the events endpoint shows.
    const events = await readEvents(atlas.browser, atlas.profileId);
    expect(data.events.map(({ id, type, username, intervalStart, intervalEnd, evidence }) => ({ id, type, username, intervalStart, intervalEnd, evidence }))).toEqual(
      events.data.map(({ id, type, username, intervalStart, intervalEnd, evidence }) => ({ id, type, username, intervalStart, intervalEnd, evidence })),
    );
    expect(data.events).toHaveLength(2);

    // The same activity the feed shows.
    const feed = await readActivity(atlas.browser);
    expect(data.activity.map((entry) => entry.id).sort()).toEqual(feed.data.map((entry) => entry.id).sort());
    expect(data.activity.map((entry) => entry.kind).sort()).toEqual([
      "import_processed",
      "import_processed",
      "import_received",
      "import_received",
      "profile_added",
    ]);

    expect(data.jobs.map(({ profileId, kind, status }) => ({ profileId, kind, status }))).toEqual([
      { profileId: atlas.profileId, kind: "derive_profile", status: "succeeded" },
      { profileId: atlas.profileId, kind: "derive_profile", status: "succeeded" },
      { profileId: atlas.profileId, kind: "manual_review", status: "queued" },
    ]);
    expect(data.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "account", profileId: null, imports: 2 }),
        expect.objectContaining({ scope: "profile", profileId: atlas.profileId, manualReviews: 1 }),
      ]),
    );

    // No credential of any kind: not the password, not the login cookie, not a lock or a hash.
    expect(text).not.toContain(TEST_PASSWORD);
    const cookieValue = decodeURIComponent((atlas.browser.cookie ?? "").split("=").slice(1).join("="));
    expect(cookieValue.length).toBeGreaterThan(20);
    expect(text).not.toContain(cookieValue.split(".")[0]);
    expect([...keysOf(data)].filter((key) => /password|token|secret|hash|lock/i.test(key))).toEqual([]);
  });

  it("is refused without a login", async () => {
    await atlasWithHistory();
    await expectError(await api.download(new Browser()), 401, "unauthenticated");
  });
});

interface Who {
  userId: string;
  email: string;
  profileId: string;
}

/** Every table that can hold a row of one user, with the statement that counts that user's rows. */
const USER_ROWS: Record<string, (who: Who) => SQL> = {
  user: (who) => sql`select count(*)::int as n from "user" where id = ${who.userId} or email = ${who.email}`,
  session: (who) => sql`select count(*)::int as n from session where user_id = ${who.userId}`,
  account: (who) => sql`select count(*)::int as n from account where user_id = ${who.userId}`,
  verification: (who) =>
    sql`select count(*)::int as n from verification where value = ${who.userId} or identifier like ${`%${who.email}%`}`,
  consent_record: (who) => sql`select count(*)::int as n from consent_record where user_id = ${who.userId}`,
  profile: (who) => sql`select count(*)::int as n from profile where user_id = ${who.userId} or id = ${who.profileId}`,
  export_snapshot: (who) =>
    sql`select count(*)::int as n from export_snapshot where user_id = ${who.userId} or profile_id = ${who.profileId}`,
  change_event: (who) =>
    sql`select count(*)::int as n from change_event where user_id = ${who.userId} or profile_id = ${who.profileId}`,
  job: (who) => sql`select count(*)::int as n from job where user_id = ${who.userId} or profile_id = ${who.profileId}`,
  activity_entry: (who) =>
    sql`select count(*)::int as n from activity_entry where user_id = ${who.userId} or profile_id = ${who.profileId}`,
  usage_daily: (who) =>
    sql`select count(*)::int as n from usage_daily where scope_key in (${`user:${who.userId}`}, ${`profile:${who.profileId}`})`,
  mail_capture: (who) => sql`select count(*)::int as n from mail_capture where to_address = ${who.email}`,
  audit_event: (who) =>
    sql`select count(*)::int as n from audit_event where actor_user_id = ${who.userId} or detail::text like ${`%${who.userId}%`} or detail::text like ${`%${who.email}%`}`,
};

/** Tables that hold no row of any one user: the limiter's counters and the operational state. */
const SHARED_TABLES = ["rate_limit", "system_state"];

async function rowsOf(who: Who): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, statement] of Object.entries(USER_ROWS)) {
    const result = await getDb().execute<{ n: number }>(statement(who));
    counts[table] = result.rows[0]?.n ?? -1;
  }
  return counts;
}

describe("deleting an account", () => {
  it("counts rows in every table the application has", async () => {
    const tables = await getDb().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    // A new table has to be added to USER_ROWS or, when it holds no user data, to SHARED_TABLES.
    expect(tables.rows.map((row) => row.tablename)).toEqual([...Object.keys(USER_ROWS), ...SHARED_TABLES].sort());
  });

  it("removes every row of that user, touches nothing of another user, and refuses the old cookie", async () => {
    const first = await atlasWithHistory();
    const nova = await novaWithHistory();

    // The customer changes the password through a reset, which is recorded as a security event.
    expect((await authRequest("/request-password-reset", { json: { email: ATLAS, redirectTo: "/reset-password" } })).status).toBe(200);
    const token = new URL(await mailLink(ATLAS, "reset_password")).searchParams.get("token");
    expect((await authRequest("/reset-password", { json: { newPassword: NEW_PASSWORD, token } })).status).toBe(200);
    // The reset ended every login, so the customer signs in again with the new password.
    await expectError(await api.me(first.browser), 401, "unauthenticated");
    expect((await signInFrom(new Browser(), ATLAS)).status).toBe(401);
    const browser = new Browser();
    expect((await signInFrom(browser, ATLAS, NEW_PASSWORD)).status).toBe(200);
    // A second reset is asked for and never used, so a pending reset exists at the time of deletion.
    expect((await authRequest("/request-password-reset", { json: { email: ATLAS, redirectTo: "/reset-password" } })).status).toBe(200);

    const atlas: Who = { userId: first.userId, email: ATLAS, profileId: first.profileId };
    const other: Who = { userId: nova.userId, email: NOVA, profileId: nova.profileId };
    const atlasBefore = await rowsOf(atlas);
    const novaBefore = await rowsOf(other);
    // The user has rows in every table, so the zeros below mean something.
    expect(Object.entries(atlasBefore).filter(([, count]) => count < 1)).toEqual([]);
    const novaViewBefore = await (await api.download(nova.browser)).text();

    // The wrong password, the former password, and no password at all delete nothing.
    for (const json of [{ password: "not-the-password" }, { password: TEST_PASSWORD }, {}]) {
      const refused = await browser.auth("/delete-user", { json });
      expect(refused.status).toBe(400);
      expect(["INVALID_PASSWORD", "PASSWORD_REQUIRED"]).toContain((await refused.json()).code);
    }
    expect(await rowsOf(atlas)).toEqual(atlasBefore);

    const cookie = browser.cookie as string;
    const deleted = await browser.auth("/delete-user", { json: { password: NEW_PASSWORD } });
    expect(deleted.status).toBe(200);

    // Every table, counted directly: nothing of the deleted user is left.
    const atlasAfter = await rowsOf(atlas);
    expect(atlasAfter).toEqual(Object.fromEntries(Object.keys(USER_ROWS).map((table) => [table, 0])));
    // The operational state and the audit log hold nothing that points at the account.
    const shared = await getDb().execute<{ text: string }>(
      sql`select value::text as text from system_state union all select coalesce(detail::text, '') from audit_event`,
    );
    for (const row of shared.rows) {
      for (const marker of [first.userId, ATLAS, first.profileId, "atlas_studio"]) expect(row.text).not.toContain(marker);
    }
    const audit = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from audit_event where action = 'account_deleted' and actor_user_id is null`,
    );
    expect(audit.rows[0]?.n).toBe(1);

    // The other user lost nothing, and their waiting review was not cancelled.
    expect(await rowsOf(other)).toEqual(novaBefore);
    expect(await (await api.download(nova.browser)).text().then(withoutExportTime)).toBe(withoutExportTime(novaViewBefore));
    expect((await readProfile(nova.browser, nova.profileId)).activeJob).toMatchObject({ kind: "manual_review", status: "queued" });

    // The old cookie is refused everywhere, and the old passwords sign nobody in.
    await expectError(await api.meWith(cookie), 401, "unauthenticated");
    await expectError(await api.me(browser), 401, "unauthenticated");
    await expectError(await api.download(browser), 401, "unauthenticated");
    await expectError(await api.profile(browser, first.profileId), 401, "unauthenticated");
    expect(await (await authRequest("/get-session", { cookie })).json()).toBeNull();
    expect((await signInFrom(new Browser(), ATLAS, NEW_PASSWORD)).status).toBe(401);
    expect((await signInFrom(new Browser(), ATLAS)).status).toBe(401);

    // The hourly run afterwards does not fail. It runs the other user's review and nothing of the deleted user.
    const summary = await runBatch();
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, retried: 0, cancelled: 0, remaining: 0 });
    expect(await rowsOf(atlas)).toEqual(atlasAfter);
    expect((await readActivity(nova.browser, "?kind=review")).data).toMatchObject([{ title: "Manual review", profileHandle: "sunset_field" }]);
    expect(await runBatch()).toMatchObject({ claimed: 0, failed: 0, cancelled: 0 });
  });

  it("lets the same address register again with nothing of the old account", async () => {
    const first = await atlasWithHistory();
    expect((await first.browser.auth("/delete-user", { json: { password: TEST_PASSWORD } })).status).toBe(200);

    const again = await register(ATLAS, "Atlas Again");

    expect(again.userId).not.toBe(first.userId);
    expect(await body<MeDto>(await api.me(again.browser))).toMatchObject({ name: "Atlas Again", usage: { profiles: 0, rosterBytes: 0 } });
    expect((await body<Page<ProfileDto>>(await api.profiles(again.browser))).data).toEqual([]);
    expect((await readActivity(again.browser)).data).toEqual([]);
    await expectError(await api.profile(again.browser, first.profileId), 404, "not_found");
    const download = await (await api.download(again.browser)).text();
    for (const marker of [first.userId, first.profileId, "atlas_studio", "pixel_forge"]) expect(download).not.toContain(marker);
  });
});

/** An export download without the moment it was produced, so two downloads can be compared. */
function withoutExportTime(text: string): string {
  const data = JSON.parse(text) as AccountExport;
  return JSON.stringify({ ...data, exportedAt: null });
}
