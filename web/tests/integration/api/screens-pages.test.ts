import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adminPage from "@/app/(app)/admin/page";
import SettingsPage from "@/app/(app)/settings/page";
import { metadata as notFoundMetadata } from "@/app/not-found";
import { GET as usersGET } from "@/app/api/admin/users/route";
import { PATCH as mePATCH } from "@/app/api/me/route";
import { AdminScreen, type AdminScreenProps } from "@/components/admin/admin-screen";
import { adminUserRow, describeResultCount, loadUsers } from "@/components/admin/users";
import { describeApiFailure, type ApiResult } from "@/components/onboarding/api";
import { SettingsScreen, type SettingsScreenProps } from "@/components/settings/settings-screen";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { closeDb, getDb } from "@/server/db/client";
import { account, session, user } from "@/server/db/schema";
import { importExport } from "@/server/services/imports";
import { createProfile, setProfileStatus } from "@/server/services/profiles";

import { callRoute, createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";
import { ATLAS, exportPayload, NOVA, OWNER } from "../services/support";

/**
 * The settings page and the admin page, called the way Next.js calls them.
 * The guards, the services, and the database are the real ones. The one thing
 * replaced is `headers()` from next/headers, which only exists inside a
 * request that Next.js is serving: here it returns the headers of the visitor
 * each test describes.
 */
const visitor = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => visitor.headers }));

beforeEach(async () => {
  visitor.headers = new Headers();
  await resetDatabase();
});
afterEach(restoreTestEnv);
afterAll(closeDb);

const visitAs = (cookie?: string) => {
  visitor.headers = new Headers(cookie ? { cookie } : {});
};

const AdminPage = adminPage.default;
/** The title of the admin page, as Next.js asks for it. Undefined until the page exports it. */
const generateAdminMetadata = async (): Promise<unknown> =>
  (adminPage as { generateMetadata?: () => Promise<unknown> }).generateMetadata?.();

/** What Next.js turns into its not-found page with status 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** The digest of the redirect a page asked for. */
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest;
    throw error;
  }
  throw new Error("the page did not redirect");
}

/** The screen element inside what a page returned, whatever wraps it. */
function findScreen<P>(node: unknown, screen: (props: P) => unknown): ReactElement<P> {
  if (isValidElement(node)) {
    if (node.type === screen) return node as ReactElement<P>;
    return findScreen((node.props as { children?: unknown }).children, screen);
  }
  throw new Error("the page did not render the expected screen");
}

describe("/admin", () => {
  const adminScreen = async () => findScreen<AdminScreenProps>(await AdminPage(), AdminScreen);

  it("renders not found for a verified, onboarded user who is not an admin", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    visitAs(nova.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("answers not found by itself for a visitor who is not signed in (a full page load is answered by the proxy first)", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    visitAs();
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("answers not found by itself for a forged session cookie (a full page load is answered by the layout first)", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    visitAs("better-auth.session_token=forged.value");
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("answers not found by itself for a user who is not onboarded and not an admin (a full page load goes to onboarding first)", async () => {
    const nova = await createVerifiedUser({ email: NOVA });
    visitAs(nova.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("answers not found by itself when the configured address is no longer verified (a full page load goes to the verify page first)", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, owner.userId));
    visitAs(owner.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("answers not found by itself when the configured admin is suspended (a full page load shows the suspended notice first)", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));
    visitAs(owner.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("renders not found once the address is removed from ADMIN_EMAILS", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    setTestEnv({ ADMIN_EMAILS: "" });
    visitAs(owner.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("is not opened by a request header that claims to be the admin", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    visitor.headers = new Headers({ cookie: nova.cookie, "x-admin": "true", "x-user-email": OWNER });
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("renders not found, without failing, on a deployment that is not configured", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    setTestEnv({ DATABASE_URL: undefined });
    visitAs(owner.cookie);
    await expect(AdminPage()).rejects.toMatchObject(NOT_FOUND);
  });

  it("gives everyone the page answers with not found the title of the not-found page", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    for (const cookie of [nova.cookie, undefined, "better-auth.session_token=forged.value"]) {
      visitAs(cookie);
      expect(await generateAdminMetadata()).toEqual({ title: notFoundMetadata.title });
    }
    visitAs(owner.cookie);
    expect(await generateAdminMetadata()).toMatchObject({ title: "Admin", robots: { index: false, follow: false } });
  });

  it("gives the configured admin the capacity report and the accounts", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await createVerifiedUser({ email: ATLAS, onboarded: true });
    visitAs(owner.cookie);
    const screen = await adminScreen();
    expect(screen.props.users.data.map((entry) => entry.email)).toEqual([ATLAS, OWNER]);
    expect(screen.props.users.pagination).toMatchObject({ page: 1, totalItems: 2 });
    expect(screen.props.capacity).toMatchObject({
      users: { used: 2, paused: false },
      mail: { available: true, mode: "captured" },
      registration: { open: true, reason: null },
    });
    const text = renderToStaticMarkup(screen);
    for (const phrase of [ATLAS, OWNER, "Capacity", "Accounts", "Showing 1 to 2 of 2 accounts."]) {
      expect(text).toContain(phrase);
    }
  });

  it("sends an admin who has not finished onboarding to onboarding first", async () => {
    const owner = await createVerifiedUser({ email: OWNER });
    visitAs(owner.cookie);
    expect(await redirectOf(AdminPage)).toContain(";/onboarding;");
  });

  it("puts no password, session token, roster, or Instagram username into what it renders", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const created = await createProfile(atlas.userId, "atlas_studio");
    await importExport(atlas.userId, created.id, exportPayload());
    const credentials = await getDb().select().from(account);
    const sessions = await getDb().select().from(session);
    visitAs(owner.cookie);

    const screen = await adminScreen();
    // The markup, and the props that travel to the browser with it.
    const sent = `${renderToStaticMarkup(screen)}\n${JSON.stringify(screen.props)}`;

    expect(sent).toContain(ATLAS);
    for (const row of credentials) expect(sent).not.toContain(row.password!);
    for (const row of sessions) expect(sent).not.toContain(row.token);
    for (const word of ["atlas_studio", "nova_labs", "pixel_forge"]) expect(sent).not.toContain(word);
    expect(JSON.stringify(screen.props)).not.toMatch(/password|token|secret|followers|following|handle|username/i);
  });
});

describe("the accounts table against GET /api/admin/users", () => {
  /** What getJson does in the browser, against the real route: the same path, the login of the caller. */
  const through = (cookie?: string) => async (path: string): Promise<ApiResult<unknown>> => {
    const response = await callRoute(usersGET, { url: path, cookie });
    const text = await response.text();
    if (!response.ok) return { ok: false, ...describeApiFailure(response.status, text) };
    return { ok: true, data: JSON.parse(text) as unknown };
  };

  it("searches by a part of the email address and words what it found", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await createVerifiedUser({ email: ATLAS, onboarded: true });
    await createVerifiedUser({ email: NOVA });
    const result = await loadUsers(through(owner.cookie), { q: "atlas@", page: 1 });
    if (!result.ok) throw new Error(result.message);
    expect(result.page.data.map((entry) => entry.email)).toEqual([ATLAS]);
    expect(describeResultCount(result.page.pagination, "atlas@")).toBe('Showing 1 account that matches "atlas@".');
    expect(adminUserRow(result.page.data[0]!)).toMatchObject({
      email: ATLAS,
      verified: { label: "Verified" },
      status: { label: "Active" },
      onboarding: { label: "Onboarded" },
      marketing: expect.stringMatching(/^Off since /),
    });
  });

  it("searches by a part of the display name", async () => {
    const owner = await createVerifiedUser({ email: OWNER, name: "Orbit Owner", onboarded: true });
    await createVerifiedUser({ email: NOVA, name: "Nova Quill" });
    const result = await loadUsers(through(owner.cookie), { q: "quill", page: 1 });
    expect(result.ok && result.page.data.map((entry) => entry.email)).toEqual([NOVA]);
  });

  it("pages through the accounts", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await createVerifiedUser({ email: ATLAS });
    const first = await loadUsers(through(owner.cookie), { q: "", page: 1 });
    expect(first.ok && first.page.pagination).toMatchObject({ page: 1, totalItems: 2, totalPages: 1 });
    const beyond = await loadUsers(through(owner.cookie), { q: "", page: 2 });
    expect(beyond.ok && beyond.page.data).toEqual([]);
  });

  it("puts a search the route finds too long on the search field", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    const result = await loadUsers(through(owner.cookie), { q: "a".repeat(101), page: 1 });
    expect(result).toMatchObject({ ok: false, field: "q" });
  });

  it("shows nothing but not found to a user who is not the admin", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    expect(await loadUsers(through(nova.cookie), { q: "", page: 1 })).toEqual({
      ok: false,
      field: null,
      message: "Not found.",
    });
  });
});

describe("/settings", () => {
  const settingsScreen = async () => findScreen<SettingsScreenProps>(await SettingsPage(), SettingsScreen);

  it("shows the signed-in account, and nothing of another account", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, name: "Atlas", timezone: "Europe/Berlin", onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, name: "Nova", onboarded: true });
    await createProfile(atlas.userId, "atlas_studio");
    await createProfile(nova.userId, "nova_labs");
    visitAs(atlas.cookie);

    const screen = await settingsScreen();
    expect(screen.props.me).toMatchObject({ id: atlas.userId, email: ATLAS, name: "Atlas", timezone: "Europe/Berlin" });
    expect(screen.props.profiles.map((profile) => profile.handle)).toEqual(["atlas_studio"]);
    const sent = `${renderToStaticMarkup(screen)}\n${JSON.stringify(screen.props)}`;
    expect(sent).toContain(ATLAS);
    expect(sent).not.toContain(NOVA);
    expect(sent).not.toContain("nova_labs");
  });

  it("offers the timezones this server accepts, UTC first, with the stored one among them", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, timezone: "Europe/Berlin", onboarded: true });
    visitAs(atlas.cookie);
    const { timezones } = (await settingsScreen()).props;
    expect(timezones[0]).toBe("UTC");
    expect(timezones).toContain("Europe/Berlin");
    expect(timezones.length).toBeGreaterThan(100);
  });

  it("names the versions of the documents as they are now", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    visitAs(atlas.cookie);
    expect((await settingsScreen()).props.versions).toEqual({ ...CONSENT_VERSIONS });
  });

  it("puts no password and no session token into what it renders", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const credentials = await getDb().select().from(account);
    const sessions = await getDb().select().from(session);
    visitAs(atlas.cookie);
    const screen = await settingsScreen();
    const sent = `${renderToStaticMarkup(screen)}\n${JSON.stringify(screen.props)}`;
    for (const row of credentials) expect(sent).not.toContain(row.password!);
    for (const row of sessions) expect(sent).not.toContain(row.token);
  });

  it("shows the next review of each profile, and a new time once the schedule is saved", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, timezone: "UTC", onboarded: true });
    const active = await createProfile(atlas.userId, "atlas_studio");
    const paused = await createProfile(atlas.userId, "pixel_forge");
    await setProfileStatus(atlas.userId, paused.id, "paused");
    visitAs(atlas.cookie);

    const before = (await settingsScreen()).props.profiles;
    expect(before.map((profile) => [profile.handle, profile.status])).toEqual([
      ["atlas_studio", "active"],
      ["pixel_forge", "paused"],
    ]);
    expect(before[0]!.nextReviewAt).toBe(active.nextReviewAt);
    expect(before[1]!.nextReviewAt).toBeNull();

    // What the Profile form sends: another timezone and another hour.
    const saved = await callRoute(mePATCH, {
      method: "PATCH",
      url: "/api/me",
      cookie: atlas.cookie,
      json: { name: "Atlas Tester", timezone: "Asia/Tokyo", reviewHour: 23 },
    });
    expect(saved.status).toBe(200);

    const after = (await settingsScreen()).props;
    expect(after.me).toMatchObject({ timezone: "Asia/Tokyo", reviewHour: 23 });
    expect(after.profiles[0]!.nextReviewAt).not.toBe(before[0]!.nextReviewAt);
    // 23:00 in Tokyo is 14:00 UTC.
    expect(after.profiles[0]!.nextReviewAt).toMatch(/T14:00:00\.000Z$/);
    expect(after.profiles[1]!.nextReviewAt).toBeNull();
  });

  it("sends a visitor who is not signed in to sign-in, remembering the page", async () => {
    visitAs();
    expect(await redirectOf(SettingsPage)).toContain(";/sign-in?next=%2Fsettings;");
  });

  it("sends a user who has not finished onboarding to onboarding", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    visitAs(atlas.cookie);
    expect(await redirectOf(SettingsPage)).toContain(";/onboarding;");
  });

  it("renders nothing for a suspended account: the layout shows the notice in its place", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    visitAs(atlas.cookie);
    expect(await SettingsPage()).toBeNull();
  });
});
