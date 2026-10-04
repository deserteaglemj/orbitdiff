import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { mailCapture, session, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";

import { authRequest, createVerifiedUser, signIn, signUp, TEST_PASSWORD } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { cookieHeader } from "../../helpers/http";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

async function currentSession(cookie: string): Promise<{ user: { email: string } } | null> {
  const response = await authRequest("/get-session", { cookie });
  return (await response.json()) as { user: { email: string } } | null;
}

describe("email verification", () => {
  it("refuses sign-in until the email is verified", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    const response = await signIn({ email: EMAIL });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await getDb().select().from(session)).toEqual([]);
  });

  it("allows sign-in from the browser that followed the captured verification link", async () => {
    await signUp({ email: EMAIL });
    const mail = await latestMail(EMAIL, "verify_email");
    expect(mail?.subject).toBe("Confirm your OrbitDiff email");
    const opened = await authRequest(extractLink(mail!));
    expect(opened.status).toBe(302);
    // The link alone neither verifies nor signs in. The takeover tests cover why.
    expect(await currentSession(cookieHeader(opened))).toBeNull();
    const response = await signIn({ email: EMAIL, cookie: cookieHeader(opened) });
    expect(response.status).toBe(200);
    const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
    expect(row?.emailVerified).toBe(true);
    expect((await currentSession(cookieHeader(response)))?.user.email).toBe(EMAIL);
  });

  it("rejects a tampered verification link and leaves the user unverified", async () => {
    await signUp({ email: EMAIL });
    const mail = await latestMail(EMAIL, "verify_email");
    const link = new URL(extractLink(mail!));
    link.searchParams.set("token", `${link.searchParams.get("token")}x`);
    const response = await authRequest(link.toString());
    expect(response.headers.getSetCookie()).toEqual([]);
    const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
    expect(row?.emailVerified).toBe(false);
  });
});

describe("session cookie", () => {
  it("is httpOnly and SameSite lax, and carries no cached session data", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    expect(created.cookie).toMatch(/^better-auth\.session_token=/);
    const response = await signIn({ email: EMAIL });
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((line) => line.startsWith("better-auth.session_token="));
    expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(sessionCookie).toMatch(/;\s*Path=\//i);
    expect(sessionCookie).not.toMatch(/;\s*Secure/i);
    expect(cookies.some((line) => line.includes("session_data"))).toBe(false);
  });

  it("is Secure with the __Secure- prefix when the base URL is https", async () => {
    await createVerifiedUser({ email: EMAIL });
    setTestEnv({ APP_BASE_URL: "https://app.orbitdiff.test" });
    const response = await signIn({ email: EMAIL });
    expect(response.status).toBe(200);
    const sessionCookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith("__Secure-better-auth.session_token="));
    expect(sessionCookie).toMatch(/;\s*Secure/i);
    expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
    expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);
  });

  it("stops working once the user signs out", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL });
    expect(await currentSession(cookie)).not.toBeNull();
    expect((await authRequest("/sign-out", { json: {}, cookie })).status).toBe(200);
    expect(await currentSession(cookie)).toBeNull();
  });
});

describe("password reset", () => {
  it("goes through captured mail and revokes every existing session", async () => {
    const first = await createVerifiedUser({ email: EMAIL });
    const second = cookieHeader(await signIn({ email: EMAIL }));
    expect(await currentSession(second)).not.toBeNull();

    const requested = await authRequest("/request-password-reset", {
      json: { email: EMAIL, redirectTo: "/reset-password" },
    });
    expect(requested.status).toBe(200);
    const mail = await latestMail(EMAIL, "reset_password");
    expect(mail?.subject).toBe("Reset your OrbitDiff password");

    // The link opens the app page named in redirectTo directly, with the token as a query parameter.
    const link = new URL(extractLink(mail!));
    expect(`${link.origin}${link.pathname}`).toBe(`${getEnv().baseUrl}/reset-password`);
    const token = link.searchParams.get("token");
    expect(token).toBeTruthy();
    expect(mail!.text).not.toContain("/api/auth/");

    const reset = await authRequest("/reset-password", {
      json: { newPassword: "a-brand-new-password", token },
    });
    expect(reset.status).toBe(200);

    expect(await currentSession(first.cookie)).toBeNull();
    expect(await currentSession(second)).toBeNull();
    expect(await getDb().select().from(session)).toEqual([]);
    expect((await signIn({ email: EMAIL, password: TEST_PASSWORD })).status).toBe(401);
    expect((await signIn({ email: EMAIL, password: "a-brand-new-password" })).status).toBe(200);
  });

  it("answers the same way for an address with no account and sends nothing", async () => {
    const response = await authRequest("/request-password-reset", {
      json: { email: "nobody@orbitdiff.test", redirectTo: "/reset-password" },
    });
    expect(response.status).toBe(200);
    expect(await latestMail("nobody@orbitdiff.test", "reset_password")).toBeNull();
  });

  it("keeps the query of the reset page and falls back to /reset-password without one", async () => {
    await createVerifiedUser({ email: EMAIL });
    await authRequest("/request-password-reset", {
      json: { email: EMAIL, redirectTo: "/reset-password?from=settings" },
    });
    const first = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!));
    expect(first.pathname).toBe("/reset-password");
    expect(first.searchParams.get("from")).toBe("settings");
    expect(first.searchParams.get("token")).toBeTruthy();

    await getDb().delete(mailCapture);
    await authRequest("/request-password-reset", { json: { email: EMAIL } });
    const second = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!));
    expect(`${second.origin}${second.pathname}`).toBe(`${getEnv().baseUrl}/reset-password`);
    expect(second.searchParams.get("token")).toBeTruthy();
  });

  it("does not accept a reset token twice", async () => {
    await createVerifiedUser({ email: EMAIL });
    await authRequest("/request-password-reset", { json: { email: EMAIL, redirectTo: "/reset-password" } });
    const mail = await latestMail(EMAIL, "reset_password");
    const token = new URL(extractLink(mail!)).searchParams.get("token");
    const use = () => authRequest("/reset-password", { json: { newPassword: "a-brand-new-password", token } });
    expect((await use()).status).toBe(200);
    expect((await use()).status).toBe(400);
  });
});

describe("endpoints that are switched off", () => {
  it("has no email change, social sign-in, or account linking endpoint", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL });
    const calls: Array<[string, unknown]> = [
      ["/change-email", { newEmail: "other@orbitdiff.test" }],
      ["/sign-in/social", { provider: "github" }],
      ["/link-social", { provider: "github" }],
      ["/unlink-account", { providerId: "credential" }],
    ];
    for (const [path, json] of calls) {
      const response = await authRequest(path, { json, cookie });
      expect(response.status, path).toBe(404);
    }
    const callback = await authRequest("/delete-user/callback?token=abc", { cookie });
    expect(callback.status).toBe(404);
    const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
    expect(row?.email).toBe(EMAIL);
  });
});
