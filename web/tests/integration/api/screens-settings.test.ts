import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as consentPOST } from "@/app/api/me/consent/route";
import { describeApiFailure } from "@/components/onboarding/api";
import { buildMarketingRequest, describeMarketingRefusal, marketingSummary } from "@/components/settings/consent-summary";
import { deleteAccount } from "@/components/settings/deletion";
import {
  buildPasswordChangeRequest,
  describeSecurityError,
  sessionRows,
  validatePasswordChange,
} from "@/components/settings/security";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { requireUser } from "@/server/auth/guards";
import { handleAuthRequest } from "@/server/auth/handler";
import { authSchemaOptions } from "@/server/auth/options";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, session, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";
import { settleBackground } from "@/server/http/background";
import type { ConsentStateDto } from "@/server/services/contracts";

import {
  callRoute,
  cookieHeader,
  createVerifiedUser,
  resetDatabase,
  restoreTestEnv,
  signIn,
  TEST_PASSWORD,
} from "../../helpers";
import { ATLAS, NOVA, withDocumentVersions } from "../services/support";

/**
 * The settings screen against the real routes. Each test builds a request with
 * the same pure function the screen uses and sends it to the real entry point:
 * the JSON route for product news, and the real Better Auth client, gate, and
 * database for the password, the sessions, and account deletion. Nothing is mocked.
 */
beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const NEW_PASSWORD = "silver harbour comet";

/** A browser that already holds the cookies of a login: the real client, a cookie jar, and a log of what it sent. */
function browser(cookie: string) {
  const jar = new Map<string, string>();
  for (const pair of cookie.split("; ").filter(Boolean)) {
    jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  const sent: string[] = [];
  const origin = getEnv().baseUrl;
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    sent.push(new URL(request.url).pathname);
    const headers = new Headers(request.headers);
    headers.set("origin", origin);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const response = await handleAuthRequest(new Request(request.url, { method: request.method, headers, body }));
    await settleBackground();
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const name = pair.slice(0, pair.indexOf("=")).trim();
      if (/;\s*max-age=0/i.test(line)) jar.delete(name);
      else jar.set(name, pair.slice(pair.indexOf("=") + 1));
    }
    return response;
  };
  const client = createAuthClient({
    baseURL: origin,
    plugins: [inferAdditionalFields({ user: authSchemaOptions.user.additionalFields })],
    fetchOptions: { customFetchImpl: send as typeof fetch },
  });
  const cookies = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { client, cookies, sent };
}

/** A second device of the same account: sign in again and keep its cookies. */
async function secondDevice(email: string, password: string = TEST_PASSWORD): Promise<string> {
  const response = await signIn({ email, password, headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0" } });
  expect(response.status).toBe(200);
  return cookieHeader(response);
}

/** True when the guards still accept these cookies. */
async function signedIn(cookie: string): Promise<boolean> {
  try {
    await requireUser(new Headers({ cookie }));
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "unauthenticated") return false;
    throw error;
  }
}

const userRows = (email: string) => getDb().select().from(user).where(eq(user.email, email));
const consentRows = (userId: string, kind: string) =>
  getDb()
    .select({ granted: consentRecord.granted, version: consentRecord.version, source: consentRecord.source })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, kind)))
    .orderBy(consentRecord.recordedAt);

describe("the product news toggle against POST /api/me/consent", () => {
  const post = (cookie: string, choice: unknown) => {
    const request = buildMarketingRequest(choice, CONSENT_VERSIONS.marketing);
    if (!request.ok) throw new Error(request.error);
    return callRoute(consentPOST, { method: "POST", url: "/api/me/consent", cookie, json: request.body });
  };

  it("records a grant that names the version the page showed", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const response = await post(atlas.cookie, true);
    const text = await response.text();
    expect({ status: response.status, refusal: response.ok ? null : describeApiFailure(response.status, text).message }).toEqual({
      status: 200,
      refusal: null,
    });
    const state = JSON.parse(text) as ConsentStateDto;
    expect(marketingSummary(state.marketing)).toMatchObject({ granted: true, badge: "On" });
    expect(await consentRows(atlas.userId, "marketing")).toEqual([
      { granted: false, version: CONSENT_VERSIONS.marketing, source: "signup" },
      { granted: true, version: CONSENT_VERSIONS.marketing, source: "settings" },
    ]);
  });

  it("records a withdrawal, sent as the boolean false with no version", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const response = await post(atlas.cookie, false);
    expect(response.status).toBe(200);
    const state = (await response.json()) as ConsentStateDto;
    expect(marketingSummary(state.marketing)).toMatchObject({ granted: false, badge: "Off" });
    expect((await consentRows(atlas.userId, "marketing")).at(-1)).toMatchObject({ granted: false, source: "settings" });
  });

  it("refuses a grant from a page that was open while the consent text changed, and the form says so", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const before = await consentRows(atlas.userId, "marketing");
    // The page rendered, and so names, the version that was current before the change.
    const stale = buildMarketingRequest(true, CONSENT_VERSIONS.marketing);
    if (!stale.ok) throw new Error(stale.error);
    const response = await withDocumentVersions({ marketing: "2027-01-15" }, () =>
      callRoute(consentPOST, { method: "POST", url: "/api/me/consent", cookie: atlas.cookie, json: stale.body }),
    );
    expect(response.status).toBe(422);
    const failure = describeApiFailure(response.status, await response.text());
    expect(describeMarketingRefusal(failure)).toBe(
      "The product news consent changed while this page was open. Reload this page, read it again, and choose again.",
    );
    expect(await consentRows(atlas.userId, "marketing")).toEqual(before);
  });

  it("still records a withdrawal from such a page: turning product news off always works", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await post(atlas.cookie, true);
    const withdrawal = buildMarketingRequest(false, CONSENT_VERSIONS.marketing);
    if (!withdrawal.ok) throw new Error(withdrawal.error);
    const response = await withDocumentVersions({ marketing: "2027-01-15" }, () =>
      callRoute(consentPOST, { method: "POST", url: "/api/me/consent", cookie: atlas.cookie, json: withdrawal.body }),
    );
    expect(response.status).toBe(200);
    expect((await consentRows(atlas.userId, "marketing")).at(-1)).toMatchObject({ granted: false, source: "settings" });
  });

  it("never touches the terms or the privacy record, whichever way the toggle goes", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const before = { terms: await consentRows(atlas.userId, "terms"), privacy: await consentRows(atlas.userId, "privacy") };
    await post(atlas.cookie, false);
    await post(atlas.cookie, true);
    expect({ terms: await consentRows(atlas.userId, "terms"), privacy: await consentRows(atlas.userId, "privacy") }).toEqual(
      before,
    );
    // The account still passes the product guard: nothing about product consent moved.
    expect(await signedIn(atlas.cookie)).toBe(true);
  });
});

describe("changing the password, as the Security section does it", () => {
  const values = (currentPassword: string, newPassword: string = NEW_PASSWORD) => ({
    currentPassword,
    newPassword,
    confirmPassword: newPassword,
  });

  it("puts a wrong current password on its field and changes nothing", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const tab = browser(atlas.cookie);
    const { error } = await tab.client.changePassword(buildPasswordChangeRequest(values("not the password")));
    expect(describeSecurityError(error)).toEqual({
      kind: "field",
      field: "currentPassword",
      message: "That is not your current password.",
    });
    expect((await signIn({ email: ATLAS })).status).toBe(200);
  });

  it("changes the password, keeps this device signed in, and signs every other device out", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const other = await secondDevice(ATLAS);
    const tab = browser(atlas.cookie);
    const form = values(TEST_PASSWORD);
    expect(validatePasswordChange(form)).toEqual({});

    const { error } = await tab.client.changePassword(buildPasswordChangeRequest(form));
    expect(error).toBeNull();
    expect(await signedIn(tab.cookies())).toBe(true);
    expect(await signedIn(other)).toBe(false);
    expect(await getDb().select().from(session)).toHaveLength(1);
    expect((await signIn({ email: ATLAS, password: NEW_PASSWORD })).status).toBe(200);
    expect((await signIn({ email: ATLAS })).status).toBe(401);
  });

  it("puts a new password the server finds too short on its field", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const tab = browser(atlas.cookie);
    const { error } = await tab.client.changePassword(buildPasswordChangeRequest(values(TEST_PASSWORD, "short")));
    expect(describeSecurityError(error)).toMatchObject({ kind: "field", field: "newPassword" });
    expect((await signIn({ email: ATLAS })).status).toBe(200);
  });

  it("answers signed out once the login is gone", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    await getDb().delete(session);
    const { error } = await browser(atlas.cookie).client.changePassword(buildPasswordChangeRequest(values(TEST_PASSWORD)));
    expect(describeSecurityError(error).kind).toBe("signed_out");
  });
});

describe("the list of signed-in devices, as the Security section reads it", () => {
  async function twoDevices() {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const other = await secondDevice(ATLAS);
    return { atlas, other, tab: browser(atlas.cookie) };
  }

  async function rows(tab: ReturnType<typeof browser>) {
    const [list, current] = await Promise.all([tab.client.listSessions(), tab.client.getSession()]);
    expect(list.error).toBeNull();
    return sessionRows(list.data, current.data?.session.token ?? null);
  }

  it("lists this device first and the other device after it", async () => {
    const { tab } = await twoDevices();
    const list = await rows(tab);
    expect(list.map((row) => row.current)).toEqual([true, false]);
    expect(list[1]).toMatchObject({ device: "Firefox on Linux" });
    for (const row of list) expect(row.signedInAt).toMatch(/^2\d{3}-/);
  });

  it("lists only the sessions of the signed-in account", async () => {
    const { tab } = await twoDevices();
    await createVerifiedUser({ email: NOVA, onboarded: true });
    expect(await rows(tab)).toHaveLength(2);
  });

  it("signs one other device out and leaves this one signed in", async () => {
    const { other, tab } = await twoDevices();
    const target = (await rows(tab)).find((row) => !row.current);
    const { error } = await tab.client.revokeSession({ token: target!.token });
    expect(error).toBeNull();
    expect(await signedIn(other)).toBe(false);
    expect(await signedIn(tab.cookies())).toBe(true);
    expect((await rows(tab)).map((row) => row.current)).toEqual([true]);
  });

  it("cannot sign out a device of another account", async () => {
    const { tab } = await twoDevices();
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    const novaRows = await rows(browser(nova.cookie));
    await tab.client.revokeSession({ token: novaRows[0]!.token });
    expect(await signedIn(nova.cookie)).toBe(true);
  });

  it("signs every other device out at once", async () => {
    const { other, tab } = await twoDevices();
    const third = await secondDevice(ATLAS);
    const { error } = await tab.client.revokeOtherSessions();
    expect(error).toBeNull();
    expect([await signedIn(other), await signedIn(third), await signedIn(tab.cookies())]).toEqual([false, false, true]);
  });

  it("is refused for a login older than a day, and the screen says why", async () => {
    const { atlas, tab } = await twoDevices();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await getDb().update(session).set({ createdAt: twoDaysAgo }).where(eq(session.userId, atlas.userId));
    const { data, error } = await tab.client.listSessions();
    expect(data).toBeNull();
    expect(describeSecurityError(error).kind).toBe("not_fresh");
  });

  it("answers signed out once the login is gone", async () => {
    const { tab } = await twoDevices();
    await getDb().delete(session);
    const { error } = await tab.client.listSessions();
    expect(describeSecurityError(error).kind).toBe("signed_out");
  });
});

describe("deleting the account, as the danger section does it", () => {
  async function account() {
    const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
    const tab = browser(atlas.cookie);
    return { atlas, tab, call: (body: { password: string }) => tab.client.deleteUser(body) };
  }

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not text", 12345678901],
  ])("sends nothing and deletes nothing when the password is %s", async (_label, password) => {
    const { tab, call } = await account();
    expect(await deleteAccount(call, password)).toEqual({
      kind: "password",
      message: "Enter your password to delete your account.",
    });
    expect(tab.sent).toEqual([]);
    expect(await userRows(ATLAS)).toHaveLength(1);
  });

  it("shows the server's refusal for a wrong password and keeps the account", async () => {
    const { tab, call } = await account();
    expect(await deleteAccount(call, "not the password")).toEqual({
      kind: "password",
      message: "Invalid password. Your account was not deleted.",
    });
    expect(tab.sent).toEqual(["/api/auth/delete-user"]);
    expect(await userRows(ATLAS)).toHaveLength(1);
    expect(await signedIn(tab.cookies())).toBe(true);
  });

  it("reports the account as not deleted once the login is gone, whatever the password", async () => {
    const { call } = await account();
    await getDb().delete(session);
    const outcome = await deleteAccount(call, TEST_PASSWORD);
    expect(outcome.kind).toBe("refused");
    expect(await userRows(ATLAS)).toHaveLength(1);
  });

  it("deletes the account with the right password, ends the login, and leaves another account alone", async () => {
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    const { atlas, tab, call } = await account();
    expect(await deleteAccount(call, TEST_PASSWORD)).toEqual({ kind: "deleted" });
    expect(await userRows(ATLAS)).toEqual([]);
    expect(await consentRows(atlas.userId, "terms")).toEqual([]);
    expect(await signedIn(tab.cookies())).toBe(false);
    expect(await signedIn(nova.cookie)).toBe(true);
    expect(await userRows(NOVA)).toHaveLength(1);
  });
});
