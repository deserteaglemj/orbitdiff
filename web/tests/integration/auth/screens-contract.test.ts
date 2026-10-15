import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as onboardingPOST } from "@/app/api/me/onboarding/route";
import { GET as meGET, PATCH as mePATCH } from "@/app/api/me/route";
import { POST as profilesPOST } from "@/app/api/profiles/route";
import { describeAuthError, verifyPageState } from "@/components/auth/auth-errors";
import { buildSignUpRequest, VERIFY_CALLBACK_PATH, type SignUpValues } from "@/components/auth/sign-up-model";
import { describeApiFailure } from "@/components/onboarding/api";
import {
  buildOnboardingBody,
  consentToConfirm,
  initialStep,
  isReturning,
  onboardingAccount,
  stepAfterAgreement,
  validateDetails,
} from "@/components/onboarding/model";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { getSessionUser, requireOnboardedUser } from "@/server/auth/guards";
import { handleAuthRequest } from "@/server/auth/handler";
import { authSchemaOptions } from "@/server/auth/options";
import { afterSignInPath } from "@/server/auth/paths";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, session, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";
import type { MeDto } from "@/server/services/contracts";

import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";
const PASSWORD = "copper lantern orbit";

const form: SignUpValues = {
  name: "Atlas Tester",
  email: EMAIL,
  password: PASSWORD,
  timezone: "Europe/Berlin",
  acceptTerms: true,
  marketing: false,
  accessCode: "",
};

/**
 * A browser, as far as the account screens are concerned: the same Better Auth
 * client the screens use, sending its requests to the real guarded entry point,
 * with an Origin header and a cookie jar. Nothing is mocked: the client library,
 * the gate, Better Auth, and the database are the real ones.
 */
function browser() {
  const jar = new Map<string, string>();
  const origin = getEnv().baseUrl;
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
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
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { client, send, cookie };
}

type Browser = ReturnType<typeof browser>;

/** The document versions a page rendered now shows, and so names in its requests. */
const shown = () => ({ terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy });

async function submitSignUp(tab: Browser, values: SignUpValues = form, versions = shown()) {
  const request = buildSignUpRequest(values, versions);
  return tab.client.signUp.email(request.body, { headers: request.headers });
}

/** Open the link of the newest confirmation message in this browser and return where it leads. */
async function openConfirmationLink(tab: Browser): Promise<string> {
  const mail = await latestMail(EMAIL, "verify_email");
  const response = await tab.send(extractLink(mail!));
  expect(response.status).toBe(302);
  return response.headers.get("location") ?? "";
}

async function userRow() {
  const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
  return row;
}

async function consent(kind: string) {
  const row = await userRow();
  const rows = await getDb().select().from(consentRecord).where(eq(consentRecord.userId, row!.id));
  return rows.filter((entry) => entry.kind === kind).map((entry) => ({ granted: entry.granted, version: entry.version }));
}

describe("what the sign-up form sends is what the server accepts", () => {
  it("creates the account with the timezone, the accepted version, and no marketing consent", async () => {
    const { data, error } = await submitSignUp(browser());
    expect(error).toBeNull();
    expect(data?.user.email).toBe(EMAIL);
    expect(await userRow()).toMatchObject({ name: "Atlas Tester", timezone: "Europe/Berlin", emailVerified: false });
    expect(await consent("terms")).toEqual([{ granted: true, version: CONSENT_VERSIONS.terms }]);
    expect(await consent("privacy")).toEqual([{ granted: true, version: CONSENT_VERSIONS.privacy }]);
    expect(await consent("marketing")).toEqual([{ granted: false, version: CONSENT_VERSIONS.marketing }]);
  });

  it("records marketing consent only when the product news box was ticked", async () => {
    expect((await submitSignUp(browser(), { ...form, marketing: true })).error).toBeNull();
    expect(await consent("marketing")).toEqual([{ granted: true, version: CONSENT_VERSIONS.marketing }]);
  });

  it("is refused without the agreement box, and the refusal lands on that box", async () => {
    const { error } = await submitSignUp(browser(), { ...form, acceptTerms: false, marketing: true });
    expect(describeAuthError(error)).toMatchObject({ kind: "field", field: "acceptTerms" });
    expect(await userRow()).toBeUndefined();
  });

  it("sends the access code as a header, and a missing code lands on the access code field", async () => {
    setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    const refused = await submitSignUp(browser());
    expect(describeAuthError(refused.error)).toMatchObject({ kind: "field", field: "accessCode" });
    expect(await userRow()).toBeUndefined();
    const accepted = await submitSignUp(browser(), { ...form, accessCode: "orbit-preview-1" });
    expect(accepted.error).toBeNull();
    expect(await userRow()).toBeDefined();
  });

  it("shows the server's reason when registration is closed", async () => {
    setTestEnv({ OPERATOR_NAME: undefined });
    const { error } = await submitSignUp(browser());
    expect(describeAuthError(error)).toEqual({
      kind: "closed",
      message: "Registration is closed: the operator of this service has not been named yet.",
    });
  });

  it("ties a server-side field refusal to its field", async () => {
    const { error } = await submitSignUp(browser(), { ...form, timezone: "Mars/Olympus" });
    expect(describeAuthError(error)).toMatchObject({ kind: "field", field: "timezone" });
  });

  /** Run with the server holding another version of the Privacy notice, as after a deploy that changed it. */
  async function withPrivacyVersion(version: string, run: () => Promise<void>): Promise<void> {
    const versions = CONSENT_VERSIONS as unknown as { privacy: string };
    const before = versions.privacy;
    versions.privacy = version;
    try {
      await run();
    } finally {
      versions.privacy = before;
    }
  }

  it("names the privacy version the page showed, so each document is recorded at its own version", async () => {
    await withPrivacyVersion("2099-01-01", async () => {
      // A page rendered now shows, and so names, the new version of the Privacy notice.
      const { error } = await submitSignUp(browser(), form, shown());
      expect(error).toBeNull();
      expect(await consent("privacy")).toEqual([{ granted: true, version: "2099-01-01" }]);
      expect(await consent("terms")).toEqual([{ granted: true, version: CONSENT_VERSIONS.terms }]);
    });
  });

  it("is refused on the agreement box when the page was rendered before the Privacy notice changed", async () => {
    const stale = shown();
    await withPrivacyVersion("2099-01-01", async () => {
      const { error } = await submitSignUp(browser(), form, stale);
      expect(describeAuthError(error)).toEqual({
        kind: "field",
        field: "acceptTerms",
        message:
          "The Privacy notice was not accepted at its current version. Reload this page, read the current Privacy notice, and agree again.",
      });
      expect(await userRow()).toBeUndefined();
    });
  });
});

describe("confirming the address and signing in, as the screens do it", () => {
  it("answers unverified before the link is opened, and a new message can be requested", async () => {
    const tab = browser();
    await submitSignUp(tab);
    const { error } = await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    expect(describeAuthError(error).kind).toBe("unverified");

    const before = await latestMail(EMAIL, "verify_email");
    const resend = await tab.client.sendVerificationEmail({ email: EMAIL, callbackURL: VERIFY_CALLBACK_PATH });
    expect(resend.error).toBeNull();
    const after = await latestMail(EMAIL, "verify_email");
    expect(after?.id).not.toBe(before?.id);
  });

  it("returns from the link to the opened state, then sign-in confirms the address and leads to onboarding", async () => {
    const tab = browser();
    await submitSignUp(tab);
    const location = new URL(await openConfirmationLink(tab), getEnv().baseUrl);
    expect(`${location.pathname}${location.search}`).toBe(VERIFY_CALLBACK_PATH);
    expect(verifyPageState(Object.fromEntries(location.searchParams))).toBe("opened");
    expect((await userRow())?.emailVerified).toBe(false);

    const { data, error } = await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    expect(error).toBeNull();
    expect((await userRow())?.emailVerified).toBe(true);

    const me = (await (await callRoute(meGET, { url: "/api/me", cookie: tab.cookie() })).json()) as MeDto;
    expect(me.onboarded).toBe(false);
    expect(Boolean(data?.user.onboardedAt)).toBe(me.onboarded);
    expect(afterSignInPath({ onboarded: me.onboarded, next: "/settings" })).toBe("/onboarding");
  });

  it("shows the invalid state for a link that does not verify", async () => {
    const tab = browser();
    await submitSignUp(tab);
    const link = new URL(extractLink((await latestMail(EMAIL, "verify_email"))!));
    link.searchParams.set("token", "not-a-real-token");
    const response = await tab.send(link.href);
    const location = new URL(response.headers.get("location") ?? "", getEnv().baseUrl);
    expect(location.pathname).toBe("/verify-email");
    expect(verifyPageState(Object.fromEntries(location.searchParams))).toBe("invalid");
  });

  it("does not confirm the address from a browser that never opened the link", async () => {
    const first = browser();
    await submitSignUp(first);
    await openConfirmationLink(first);
    const other = browser();
    const { error } = await other.client.signIn.email({ email: EMAIL, password: PASSWORD });
    expect(describeAuthError(error).kind).toBe("unverified");
    expect((await userRow())?.emailVerified).toBe(false);
  });

  it("does not say which of the email and the password was wrong", async () => {
    const tab = browser();
    await submitSignUp(tab);
    await openConfirmationLink(tab);
    await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    const wrong = await browser().client.signIn.email({ email: EMAIL, password: "not-the-password" });
    const unknown = await browser().client.signIn.email({ email: "nova@orbitdiff.test", password: PASSWORD });
    const expected = { kind: "form", message: "The email address or the password is not right." };
    expect(describeAuthError(wrong.error)).toEqual(expected);
    expect(describeAuthError(unknown.error)).toEqual(expected);
  });

  it("recognizes a suspended account at sign-in", async () => {
    const tab = browser();
    await submitSignUp(tab);
    await openConfirmationLink(tab);
    await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.email, EMAIL));
    const { error } = await browser().client.signIn.email({ email: EMAIL, password: PASSWORD });
    expect(describeAuthError(error)).toEqual({ kind: "suspended", message: "This account is suspended." });
  });

  it("ends the login on sign-out", async () => {
    const tab = browser();
    await submitSignUp(tab);
    await openConfirmationLink(tab);
    await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    expect(await getDb().select().from(session)).toHaveLength(1);
    expect((await tab.client.signOut()).error).toBeNull();
    expect(await getDb().select().from(session)).toHaveLength(0);
  });
});

describe("password reset, as the screens do it", () => {
  async function verifiedAccount(): Promise<Browser> {
    const tab = browser();
    await submitSignUp(tab);
    await openConfirmationLink(tab);
    await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    return tab;
  }

  it("creates a reset message that links to the reset page with a token, and the token sets a new password", async () => {
    await verifiedAccount();
    const tab = browser();
    const asked = await tab.client.requestPasswordReset({ email: EMAIL, redirectTo: "/reset-password" });
    expect(asked.error).toBeNull();
    const link = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!));
    expect(link.pathname).toBe("/reset-password");
    const token = link.searchParams.get("token") ?? "";
    expect(token.length).toBeGreaterThan(0);

    const changed = await tab.client.resetPassword({ newPassword: "harbor meadow lantern", token });
    expect(changed.error).toBeNull();
    expect(await getDb().select().from(session)).toHaveLength(0);
    expect((await browser().client.signIn.email({ email: EMAIL, password: "harbor meadow lantern" })).error).toBeNull();
  });

  it("answers the same for an address with no account", async () => {
    const asked = await browser().client.requestPasswordReset({
      email: "nobody@orbitdiff.test",
      redirectTo: "/reset-password",
    });
    expect(asked.error).toBeNull();
    expect(await latestMail("nobody@orbitdiff.test", "reset_password")).toBeNull();
  });

  it("shows the invalid link state for a token that is not valid, and for one that was used", async () => {
    await verifiedAccount();
    const tab = browser();
    const made = await tab.client.resetPassword({ newPassword: "harbor meadow lantern", token: "not-a-real-token" });
    expect(describeAuthError(made.error).kind).toBe("invalid_token");

    await tab.client.requestPasswordReset({ email: EMAIL, redirectTo: "/reset-password" });
    const token = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!)).searchParams.get("token") ?? "";
    expect((await tab.client.resetPassword({ newPassword: "harbor meadow lantern", token })).error).toBeNull();
    const again = await tab.client.resetPassword({ newPassword: "another meadow lantern", token });
    expect(describeAuthError(again.error).kind).toBe("invalid_token");
  });

  it("ties a new password that is too short to the password field", async () => {
    await verifiedAccount();
    const tab = browser();
    await tab.client.requestPasswordReset({ email: EMAIL, redirectTo: "/reset-password" });
    const token = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!)).searchParams.get("token") ?? "";
    const { error } = await tab.client.resetPassword({ newPassword: "short", token });
    expect(describeAuthError(error)).toMatchObject({ kind: "field", field: "password" });
  });

  it("shows the server's message when no mail can be handled", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const { error } = await browser().client.requestPasswordReset({ email: EMAIL, redirectTo: "/reset-password" });
    expect(describeAuthError(error)).toEqual({
      kind: "form",
      message: "Email delivery is not configured, so this message cannot be sent.",
    });
  });
});

describe("the onboarding flow against the real routes", () => {
  async function signedIn(): Promise<string> {
    const tab = browser();
    await submitSignUp(tab);
    await openConfirmationLink(tab);
    await tab.client.signIn.email({ email: EMAIL, password: PASSWORD });
    return tab.cookie();
  }

  const me = async (cookie: string) => (await (await callRoute(meGET, { url: "/api/me", cookie })).json()) as MeDto;

  /** The account as the onboarding page hands it to the flow: the user's own record and the session's onboarded_at. */
  async function standing(cookie: string) {
    const current = await getSessionUser(new Headers({ cookie }));
    if (!current) throw new Error("expected a signed-in user");
    return onboardingAccount(await me(cookie), current.onboardedAt);
  }

  const agree = async (cookie: string, needed: ReturnType<typeof consentToConfirm>) => {
    const body = buildOnboardingBody({ needed, ticked: { terms: true, privacy: true }, versions: shown() });
    if (!body.ok) throw new Error("expected a body");
    return callRoute(onboardingPOST, { method: "POST", url: "/api/me/onboarding", cookie, json: body.body });
  };

  const addProfile = (cookie: string, handle: string) =>
    callRoute(profilesPOST, { method: "POST", url: "/api/profiles", cookie, json: { handle } });

  /** Run while a document holds another version, as after a deploy that changed its text. */
  async function afterDocumentChange<T>(bump: Partial<Record<"terms" | "privacy", string>>, run: () => Promise<T>): Promise<T> {
    const versions = CONSENT_VERSIONS as unknown as Record<string, string>;
    const before = { ...versions };
    Object.assign(versions, bump);
    try {
      return await run();
    } finally {
      Object.assign(versions, before);
    }
  }

  it.each([
    ["one profile", ["atlas_studio"]],
    ["the maximum of three profiles", ["atlas_studio", "nova_labs", "pixel_forge"]],
  ])("asks a returning user with %s only for the agreement, then is done", async (_label, handles) => {
    const cookie = await signedIn();
    expect((await agree(cookie, [])).status).toBe(200);
    for (const handle of handles) expect((await addProfile(cookie, handle)).status).toBe(201);
    expect(initialStep(await standing(cookie))).toBe("done");

    await afterDocumentChange({ terms: "2099-01-01" }, async () => {
      // The guard sends the user back to onboarding: consent is no longer current.
      await expect(requireOnboardedUser(new Headers({ cookie }))).rejects.toMatchObject({ details: { onboarding: true } });
      const account = await standing(cookie);
      expect(account).toMatchObject({ onboarded: false, completedBefore: true, profiles: handles.length });
      expect(isReturning(account)).toBe(true);
      expect(initialStep(account)).toBe("consent");

      const needed = consentToConfirm(account.consent, shown());
      expect(needed).toEqual(["terms"]);
      expect((await agree(cookie, needed)).status).toBe(200);

      // Not "add your first profile": the account has profiles, and with three it could not add one.
      expect(stepAfterAgreement(account)).toBe("done");
      expect((await requireOnboardedUser(new Headers({ cookie }))).email).toBe(EMAIL);
      expect((await standing(cookie)).profiles).toBe(handles.length);
    });
  });

  it("asks a returning user who never added a profile for the agreement, then for a first profile", async () => {
    const cookie = await signedIn();
    expect((await agree(cookie, [])).status).toBe(200);

    await afterDocumentChange({ privacy: "2099-01-01" }, async () => {
      const account = await standing(cookie);
      expect(account).toMatchObject({ onboarded: false, completedBefore: true, profiles: 0 });
      expect(initialStep(account)).toBe("consent");
      expect((await agree(cookie, consentToConfirm(account.consent, shown()))).status).toBe(200);
      expect(stepAfterAgreement(account)).toBe("profile");
    });
  });

  it("walks the three steps: details, agreement, first profile", async () => {
    const cookie = await signedIn();
    expect(await standing(cookie)).toMatchObject({ onboarded: false, completedBefore: false });
    expect(initialStep(await standing(cookie))).toBe("details");

    const details = validateDetails({ name: "Atlas Studio", timezone: "America/Chicago", reviewHour: "7" });
    expect(details.ok).toBe(true);
    if (!details.ok) return;
    const patched = await callRoute(mePATCH, { method: "PATCH", url: "/api/me", cookie, json: details.body });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: "Atlas Studio", timezone: "America/Chicago", reviewHour: 7 });

    // Sign-up consent is current, so no box is shown and the flow confirms it.
    const needed = consentToConfirm((await me(cookie)).consent);
    expect(needed).toEqual([]);
    const body = buildOnboardingBody({ needed, ticked: { terms: false, privacy: false }, versions: shown() });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    const accepted = await callRoute(onboardingPOST, { method: "POST", url: "/api/me/onboarding", cookie, json: body.body });
    expect(accepted.status).toBe(200);
    const after = (await accepted.json()) as MeDto;
    expect(after.onboarded).toBe(true);
    expect(stepAfterAgreement({ profiles: after.usage.profiles })).toBe("profile");
    expect(initialStep(await standing(cookie))).toBe("profile");
    expect((await requireOnboardedUser(new Headers({ cookie }))).email).toBe(EMAIL);

    const added = await callRoute(profilesPOST, {
      method: "POST",
      url: "/api/profiles",
      cookie,
      json: { handle: "https://www.instagram.com/atlas_studio/" },
    });
    expect(added.status).toBe(201);
    expect((await added.json()).handle).toBe("atlas_studio");
    expect(initialStep(await standing(cookie))).toBe("done");
  });

  it("asks for both boxes when the recorded consent is outdated, and refuses until they are ticked", async () => {
    const cookie = await signedIn();
    const account = await userRow();
    await getDb().update(consentRecord).set({ version: "2020-01-01" }).where(eq(consentRecord.userId, account!.id));
    const needed = consentToConfirm((await me(cookie)).consent);
    expect(needed).toEqual(["terms", "privacy"]);
    expect(buildOnboardingBody({ needed, ticked: { terms: true, privacy: false }, versions: shown() }).ok).toBe(false);

    const body = buildOnboardingBody({ needed, ticked: { terms: true, privacy: true }, versions: shown() });
    if (!body.ok) throw new Error("expected a body");
    const accepted = await callRoute(onboardingPOST, { method: "POST", url: "/api/me/onboarding", cookie, json: body.body });
    expect(accepted.status).toBe(200);
    expect(consentToConfirm(((await accepted.json()) as MeDto).consent)).toEqual([]);
  });

  it("shows the route's own message when a call is refused", async () => {
    const cookie = await signedIn();
    const early = await callRoute(profilesPOST, { method: "POST", url: "/api/profiles", cookie, json: { handle: "atlas_studio" } });
    expect(describeApiFailure(early.status, await early.text())).toMatchObject({
      status: 409,
      code: "conflict",
      message: "Finish onboarding to continue.",
    });

    const agreed = buildOnboardingBody({ needed: [], ticked: { terms: false, privacy: false }, versions: shown() });
    if (!agreed.ok) throw new Error("expected a body");
    const onboarded = await callRoute(onboardingPOST, {
      method: "POST",
      url: "/api/me/onboarding",
      cookie,
      json: agreed.body,
    });
    expect(onboarded.status).toBe(200);
    const add = () => callRoute(profilesPOST, { method: "POST", url: "/api/profiles", cookie, json: { handle: "atlas_studio" } });
    expect((await add()).status).toBe(201);
    const duplicate = await add();
    expect(describeApiFailure(duplicate.status, await duplicate.text())).toMatchObject({
      status: 409,
      message: "You have already added that profile.",
    });

    const bad = await callRoute(mePATCH, { method: "PATCH", url: "/api/me", cookie, json: { timezone: "Mars/Olympus" } });
    const failure = describeApiFailure(bad.status, await bad.text());
    expect(failure.status).toBe(422);
    expect(failure.fields).toEqual(["timezone"]);
  });
});
