import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSessionUser, requireAdmin } from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import { account, consentRecord, mailCapture, session, user, verification } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import {
  authRequest,
  createVerifiedUser,
  openVerificationLink,
  signIn,
  signUp,
  TEST_PASSWORD,
} from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { cookieHeader } from "../../helpers/http";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(() => {
  restoreTestEnv();
  vi.useRealTimers();
});
afterAll(closeDb);

/** Listed in ADMIN_EMAILS by the integration configuration. */
const OWNER = "owner@orbitdiff.test";
const VICTIM = "victim@orbitdiff.test";
const MALLORY = "mallory@orbitdiff.test";
const FIRST_PW = "first-comer-pw-1";
const OWNER_PW = "real-owner-pw-22";

async function row(email: string) {
  const [found] = await getDb().select().from(user).where(eq(user.email, email));
  return found;
}

async function sessionEmail(cookie: string): Promise<string | null> {
  const response = await authRequest("/get-session", { cookie });
  return ((await response.json()) as { user: { email: string } } | null)?.user.email ?? null;
}

const sessionCookies = (response: Response) =>
  response.headers.getSetCookie().filter((line) => line.includes("session_token"));

describe("an address registered by someone who cannot read its mailbox", () => {
  it("cannot be entered with the first password once the owner registers and confirms", async () => {
    expect((await signUp({ email: OWNER, password: FIRST_PW })).status).toBe(200);
    expect((await signUp({ email: OWNER, password: OWNER_PW })).status).toBe(200);
    const opened = await openVerificationLink(OWNER);
    expect(opened.response.status).toBe(302);

    expect((await signIn({ email: OWNER, password: FIRST_PW })).status).not.toBe(200);
    const owner = await signIn({ email: OWNER, password: OWNER_PW, cookie: opened.cookie });
    expect(owner.status).toBe(200);
    expect((await requireAdmin(new Headers({ cookie: cookieHeader(owner) }))).email).toBe(OWNER);

    const late = await signIn({ email: OWNER, password: FIRST_PW });
    expect(late.status).toBe(401);
    expect(sessionCookies(late)).toEqual([]);
    expect(await getDb().select().from(session)).toHaveLength(1);
  });

  it("replaces the pending account and sends a fresh mail when the address is registered again", async () => {
    await signUp({ email: VICTIM, password: FIRST_PW, name: "First" });
    const before = await row(VICTIM);
    const firstMail = await latestMail(VICTIM, "verify_email");
    // A reset requested for the pending account leaves a token that points at it.
    await authRequest("/request-password-reset", { json: { email: VICTIM, redirectTo: "/reset-password" } });
    expect(await getDb().select().from(verification).where(eq(verification.value, before!.id))).toHaveLength(1);

    const second = await signUp({ email: "Victim@OrbitDiff.test", password: OWNER_PW, name: "Second" });
    expect(second.status).toBe(200);
    const after = await row(VICTIM);
    expect(after?.id).not.toBe(before?.id);
    expect(after?.name).toBe("Second");
    expect(after?.emailVerified).toBe(false);
    expect((await latestMail(VICTIM, "verify_email"))?.id).not.toBe(firstMail?.id);

    expect(await getDb().select().from(user)).toHaveLength(1);
    expect(await getDb().select().from(verification)).toEqual([]);
    const credentials = await getDb().select().from(account);
    expect(credentials.map((entry) => entry.userId)).toEqual([after?.id]);
    const consent = await getDb().select().from(consentRecord);
    expect(consent).toHaveLength(3);
    expect(new Set(consent.map((entry) => entry.userId))).toEqual(new Set([after?.id]));
  });

  it("stays unusable when the owner opens the link without ever registering", async () => {
    await signUp({ email: OWNER, password: FIRST_PW });
    const opened = await openVerificationLink(OWNER);
    expect(opened.response.status).toBe(302);
    expect(sessionCookies(opened.response)).toEqual([]);
    expect((await row(OWNER))?.emailVerified).toBe(false);

    const firstComer = await signIn({ email: OWNER, password: FIRST_PW });
    expect(firstComer.status).toBe(403);
    expect((await firstComer.json()).code).toBe("EMAIL_NOT_VERIFIED");
    // The owner's browser holds the proof but the owner does not know the first password.
    expect((await signIn({ email: OWNER, password: OWNER_PW, cookie: opened.cookie })).status).toBe(401);
    expect((await row(OWNER))?.emailVerified).toBe(false);
    expect(await getDb().select().from(session)).toEqual([]);
  });

  it("is not taken over when the first comer registers again after the owner", async () => {
    await signUp({ email: OWNER, password: OWNER_PW });
    await signUp({ email: OWNER, password: FIRST_PW });
    const opened = await openVerificationLink(OWNER);

    expect((await signIn({ email: OWNER, password: OWNER_PW, cookie: opened.cookie })).status).toBe(401);
    expect((await signIn({ email: OWNER, password: FIRST_PW })).status).toBe(403);
    expect((await row(OWNER))?.emailVerified).toBe(false);
    expect(await getDb().select().from(session)).toEqual([]);
  });

  it("is not taken over through a resent verification mail", async () => {
    await signUp({ email: VICTIM, password: FIRST_PW });
    const firstMail = await latestMail(VICTIM, "verify_email");
    await signUp({ email: VICTIM, password: OWNER_PW });
    const secondMail = await latestMail(VICTIM, "verify_email");
    expect(secondMail?.id).not.toBe(firstMail?.id);

    expect((await authRequest("/send-verification-email", { json: { email: VICTIM } })).status).toBe(200);
    const resent = await latestMail(VICTIM, "verify_email");
    expect(resent?.id).not.toBe(secondMail?.id);
    const opened = await openVerificationLink(VICTIM);
    expect(sessionCookies(opened.response)).toEqual([]);

    expect((await signIn({ email: VICTIM, password: FIRST_PW })).status).toBe(401);
    const victim = await signIn({ email: VICTIM, password: OWNER_PW, cookie: opened.cookie });
    expect(victim.status).toBe(200);
    expect(await sessionEmail(cookieHeader(victim))).toBe(VICTIM);
    expect((await signIn({ email: VICTIM, password: FIRST_PW })).status).toBe(401);
  });

  it("accepts an older link of the same mailbox as proof, because the password is what is checked", async () => {
    await signUp({ email: VICTIM, password: FIRST_PW });
    const firstLink = extractLink((await latestMail(VICTIM, "verify_email"))!);
    await signUp({ email: VICTIM, password: OWNER_PW });
    const proof = cookieHeader(await authRequest(firstLink));
    expect((await signIn({ email: VICTIM, password: FIRST_PW, cookie: proof })).status).toBe(401);
    expect((await signIn({ email: VICTIM, password: OWNER_PW, cookie: proof })).status).toBe(200);
  });

  it("leaves a verified account alone when its address is registered again", async () => {
    const created = await createVerifiedUser({ email: OWNER });
    await getDb().delete(mailCapture);
    const repeat = await signUp({ email: OWNER, password: "another-password-9", name: "Someone Else" });
    expect(repeat.status).toBe(200);
    const kept = await row(OWNER);
    expect(kept?.id).toBe(created.userId);
    expect(kept?.name).toBe("Atlas Tester");
    expect(await getDb().select().from(mailCapture)).toEqual([]);
    expect((await signIn({ email: OWNER, password: "another-password-9" })).status).toBe(401);
    expect((await signIn({ email: OWNER, password: TEST_PASSWORD })).status).toBe(200);
  });

  it("does not replace a pending account that is not active", async () => {
    await signUp({ email: VICTIM, password: FIRST_PW });
    const before = await row(VICTIM);
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, before!.id));
    expect((await signUp({ email: VICTIM, password: OWNER_PW })).status).toBe(200);
    const after = await row(VICTIM);
    expect(after?.id).toBe(before?.id);
    expect(after?.status).toBe("suspended");
  });

  it("keeps the pending account when the second registration is refused", async () => {
    await signUp({ email: VICTIM, password: FIRST_PW });
    const before = await row(VICTIM);
    expect((await signUp({ email: VICTIM, password: "short" })).status).toBe(400);
    expect((await signUp({ email: VICTIM, password: "x".repeat(200) })).status).toBe(400);
    expect((await signUp({ email: VICTIM, password: OWNER_PW, timezone: "Mars/Olympus" })).status).toBe(422);
    expect((await signUp({ email: VICTIM, password: OWNER_PW, extra: { rememberMe: "yes" } })).status).toBe(400);
    expect((await row(VICTIM))?.id).toBe(before?.id);
  });
});

describe("the verification link", () => {
  it("never signs anyone in and does not verify the address by itself", async () => {
    await signUp({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    expect(opened.response.status).toBe(302);
    expect(opened.response.headers.get("location")).toBe("/");
    expect(sessionCookies(opened.response)).toEqual([]);
    expect(await getDb().select().from(session)).toEqual([]);
    expect((await row(VICTIM))?.emailVerified).toBe(false);
    expect(await sessionEmail(opened.cookie)).toBeNull();
  });

  it("arrives in a message that says a sign-in in the same browser is the second step", async () => {
    await signUp({ email: VICTIM });
    const mail = await latestMail(VICTIM, "verify_email");
    expect(mail!.text).toContain("sign in");
    expect(mail!.text).toContain("same browser");
    expect(mail!.text).toContain("one hour");
    expect(mail!.text).toContain("Opening the link alone confirms nothing");
    expect(mail!.text.match(/https?:\/\//g)).toHaveLength(1);
  });

  it("leaves a proof that is httpOnly, SameSite lax, and short-lived", async () => {
    await signUp({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    const cookies = opened.response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^better-auth\.mailbox_proof=/);
    expect(cookies[0]).toMatch(/;\s*HttpOnly/i);
    expect(cookies[0]).toMatch(/;\s*SameSite=Lax/i);
    expect(cookies[0]).toMatch(/;\s*Max-Age=3600/i);
    expect(cookies[0]).not.toContain("victim");
  });

  it("leaves a Secure proof with the __Secure- prefix when the base URL is https", async () => {
    setTestEnv({ APP_BASE_URL: "https://app.orbitdiff.test" });
    await signUp({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    const cookies = opened.response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Secure-better-auth\.mailbox_proof=/);
    expect(cookies[0]).toMatch(/;\s*Secure/i);
    expect((await signIn({ email: VICTIM, cookie: opened.cookie })).status).toBe(200);
  });

  it("completes verification at the first sign-in with the right password in the browser that opened it", async () => {
    await signUp({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    expect((await signIn({ email: VICTIM, password: "not-the-password", cookie: opened.cookie })).status).toBe(401);
    expect((await row(VICTIM))?.emailVerified).toBe(false);

    const signedIn = await signIn({ email: "Victim@OrbitDiff.test", cookie: opened.cookie });
    expect(signedIn.status).toBe(200);
    expect((await row(VICTIM))?.emailVerified).toBe(true);
    expect(await sessionEmail(cookieHeader(signedIn))).toBe(VICTIM);
    // From then on any browser can sign in.
    expect((await signIn({ email: VICTIM })).status).toBe(200);
  });

  it("does not complete verification in a browser that did not open the link", async () => {
    await signUp({ email: VICTIM });
    await openVerificationLink(VICTIM);
    const response = await signIn({ email: VICTIM });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect((await row(VICTIM))?.emailVerified).toBe(false);
  });

  it("does not accept the proof of one address for another", async () => {
    await signUp({ email: VICTIM });
    await signUp({ email: MALLORY });
    const mallory = await openVerificationLink(MALLORY);
    expect((await signIn({ email: VICTIM, cookie: mallory.cookie })).status).toBe(403);
    expect((await row(VICTIM))?.emailVerified).toBe(false);
  });

  it("does not accept a proof that was altered", async () => {
    await signUp({ email: VICTIM });
    await signUp({ email: MALLORY });
    const victim = await openVerificationLink(VICTIM);
    const mallory = await openVerificationLink(MALLORY);
    const valueOf = (cookie: string) => decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    const name = victim.cookie.slice(0, victim.cookie.indexOf("="));
    // Mallory's signature under the victim's payload, and a payload with a later expiry.
    const [victimDigest] = valueOf(victim.cookie).split(".");
    const [, expiry, signature] = valueOf(mallory.cookie).split(".");
    for (const forged of [
      `${victimDigest}.${expiry}.${signature}`,
      valueOf(mallory.cookie).replace(`.${expiry}.`, `.${Number(expiry) + 1}.`),
    ]) {
      const cookie = `${name}=${encodeURIComponent(forged)}`;
      expect((await signIn({ email: VICTIM, cookie })).status).toBe(403);
      expect((await signIn({ email: MALLORY, cookie })).status).toBe(403);
    }
    expect((await row(VICTIM))?.emailVerified).toBe(false);
  });

  it("does not accept a proof older than an hour", async () => {
    await signUp({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 60 * 1000 });
    expect((await signIn({ email: VICTIM, cookie: opened.cookie })).status).toBe(403);
    vi.useRealTimers();
    expect((await signIn({ email: VICTIM, cookie: opened.cookie })).status).toBe(200);
  });

  it("does not touch the session of someone who is signed in to another account", async () => {
    const victim = await createVerifiedUser({ email: VICTIM });
    await signUp({ email: MALLORY });
    const opened = await openVerificationLink(MALLORY, { cookie: victim.cookie });
    expect(sessionCookies(opened.response)).toEqual([]);
    expect(await sessionEmail(`${victim.cookie}; ${opened.cookie}`)).toBe(VICTIM);
    expect((await getSessionUser(new Headers({ cookie: `${victim.cookie}; ${opened.cookie}` })))?.id).toBe(
      victim.userId,
    );
  });

  it("returns to the callback path with an error for a link that is not valid", async () => {
    await signUp({ email: VICTIM, extra: { callbackURL: "/sign-in?from=mail" } });
    const link = new URL(extractLink((await latestMail(VICTIM, "verify_email"))!));
    link.searchParams.set("token", `${link.searchParams.get("token")}x`);
    const response = await authRequest(link.toString());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sign-in?from=mail&error=INVALID_TOKEN");
    expect(response.headers.getSetCookie()).toEqual([]);

    link.searchParams.delete("token");
    expect((await authRequest(link.toString())).headers.get("location")).toBe(
      "/sign-in?from=mail&error=INVALID_TOKEN",
    );
  });

  it("refuses a link that is older than an hour", async () => {
    await signUp({ email: VICTIM, extra: { callbackURL: "/sign-in" } });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61 * 60 * 1000 });
    const opened = await openVerificationLink(VICTIM);
    expect(opened.response.headers.get("location")).toBe("/sign-in?error=INVALID_TOKEN");
    expect(opened.response.headers.getSetCookie()).toEqual([]);
  });

  it("does nothing for an address that is already verified", async () => {
    await createVerifiedUser({ email: VICTIM });
    const opened = await openVerificationLink(VICTIM);
    expect(opened.response.status).toBe(302);
    expect(opened.response.headers.getSetCookie()).toEqual([]);
  });

  it("cannot be used to verify through the library's own endpoint logic", async () => {
    // The gate answers the link itself. If it were ever bypassed, Better Auth's handler must still refuse to verify.
    await signUp({ email: VICTIM });
    const { getAuth } = await import("@/server/auth/auth");
    const hook = getAuth().options.emailVerification?.beforeEmailVerification;
    expect(hook).toBeTypeOf("function");
    await expect(hook!()).rejects.toBeInstanceOf(Error);
    expect(getAuth().options.emailVerification?.autoSignInAfterVerification).toBe(false);
  });
});

describe("guards after the change", () => {
  it("still refuse a first comer who was never verified", async () => {
    await signUp({ email: OWNER, password: FIRST_PW });
    const denied = await requireAdmin(new Headers()).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(AppError);
  });
});
