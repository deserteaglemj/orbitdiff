import { eq } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import type { Auth } from "@/server/auth/auth";
import { handleAuthRequest } from "@/server/auth/handler";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";

import { cookieHeader } from "./http";
import { extractLink, latestMail } from "./mail";

/** Password used by createVerifiedUser() and by signUp() when none is given. */
export const TEST_PASSWORD = "orbit-test-pw-1";

export interface AuthCall {
  /** Defaults to POST when `json` is given, otherwise GET. */
  method?: string;
  json?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  /** Another Better Auth instance, for example one built with rate limiting on. */
  auth?: Auth;
}

/**
 * Send a request to a Better Auth endpoint through the same entry point as the
 * /api/auth route, so the endpoint allowlist, the body cap, hooks, cookies, and
 * (when enabled) rate limiting behave as in production.
 * `path` is relative to /api/auth, or an absolute URL taken from a captured mail.
 */
export async function authRequest(path: string, call: AuthCall = {}): Promise<Response> {
  const baseUrl = getEnv().baseUrl;
  const headers = new Headers({ origin: baseUrl, ...call.headers });
  if (call.cookie) headers.set("cookie", call.cookie);
  let body: string | undefined;
  if (call.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(call.json);
  }
  const url = /^https?:\/\//.test(path) ? path : `${baseUrl}/api/auth${path}`;
  const request = new Request(url, {
    method: call.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
  const response = await handleAuthRequest(request, call.auth);
  await settleBackground();
  return response;
}

export interface SignUpInput {
  email: string;
  name?: string;
  password?: string;
  /** Defaults to "UTC". Pass null to leave it out of the request. */
  timezone?: string | null;
  marketingOptIn?: boolean;
  /** Defaults to the current terms version. Pass null to leave it out of the request. */
  acceptedTermsVersion?: string | null;
  /**
   * Defaults to the current privacy version, as the sign-up screen sends it.
   * Pass null to leave it out of the request, so the one version named for the
   * Terms stands for both documents. A value in `extra` takes precedence.
   */
  acceptedPrivacyVersion?: string | null;
  /** Extra request headers, for example { "x-signup-code": "..." }. */
  headers?: Record<string, string>;
  /** Extra body fields, to prove that a client cannot set them. */
  extra?: Record<string, unknown>;
  auth?: Auth;
}

/** Call the real sign-up endpoint. Returns the raw Response. */
export async function signUp(input: SignUpInput): Promise<Response> {
  const body: Record<string, unknown> = {
    email: input.email,
    name: input.name ?? "Atlas Tester",
    password: input.password ?? TEST_PASSWORD,
    ...input.extra,
  };
  if (input.timezone !== null) body.timezone = input.timezone ?? "UTC";
  if (input.acceptedTermsVersion !== null) {
    body.acceptedTermsVersion = input.acceptedTermsVersion ?? CONSENT_VERSIONS.terms;
  }
  if (input.acceptedPrivacyVersion !== null && !Object.hasOwn(body, "acceptedPrivacyVersion")) {
    body.acceptedPrivacyVersion = input.acceptedPrivacyVersion ?? CONSENT_VERSIONS.privacy;
  }
  if (input.marketingOptIn !== undefined) body.marketingOptIn = input.marketingOptIn;
  return authRequest("/sign-up/email", { json: body, headers: input.headers, auth: input.auth });
}

/**
 * Call the real sign-in endpoint. Returns the raw Response; use cookieHeader() on success.
 * Pass `cookie` to sign in from a browser that already holds cookies, for
 * example the one that opened a verification link.
 */
export async function signIn(input: {
  email: string;
  password?: string;
  cookie?: string;
  headers?: Record<string, string>;
  auth?: Auth;
}): Promise<Response> {
  return authRequest("/sign-in/email", {
    json: { email: input.email, password: input.password ?? TEST_PASSWORD },
    cookie: input.cookie,
    headers: input.headers,
    auth: input.auth,
  });
}

/**
 * Open the newest verification link captured for an address, the way the
 * person who reads that mailbox would. Returns the response and the cookies the
 * link left in that browser (pass them to signIn to finish verification).
 */
export async function openVerificationLink(
  email: string,
  call: { cookie?: string; auth?: Auth } = {},
): Promise<{ response: Response; cookie: string }> {
  const mail = await latestMail(email, "verify_email");
  if (!mail) throw new Error("no verification mail was captured");
  const response = await authRequest(extractLink(mail), call);
  return { response, cookie: cookieHeader(response) };
}

export interface VerifiedUser {
  userId: string;
  email: string;
  /** Cookie header value for callRoute({ cookie }) and the guards. */
  cookie: string;
}

/**
 * Create a user the way a person would: sign up, open the verification link
 * from the captured mail, then sign in from the browser that opened it (the
 * link alone verifies nothing). The user is verified and active but NOT
 * onboarded unless `onboarded: true` is passed (sign-up already records terms
 * and privacy consent, so that only stamps onboarded_at).
 */
export async function createVerifiedUser(input: {
  email: string;
  name?: string;
  timezone?: string;
  onboarded?: boolean;
}): Promise<VerifiedUser> {
  const email = input.email.toLowerCase();
  const created = await signUp({ email, name: input.name, timezone: input.timezone });
  if (created.status !== 200) throw new Error(`sign-up failed with status ${created.status}`);
  const opened = await openVerificationLink(email);
  if (opened.response.status >= 400) {
    throw new Error(`verification failed with status ${opened.response.status}`);
  }
  const signedIn = await signIn({ email, cookie: opened.cookie });
  if (signedIn.status !== 200) throw new Error(`sign-in failed with status ${signedIn.status}`);
  const payload = (await signedIn.json()) as { user: { id: string } };
  if (input.onboarded) await markOnboarded(payload.user.id);
  return { userId: payload.user.id, email, cookie: cookieHeader(signedIn) };
}

/** Stamp onboarded_at directly, for tests that need a user past onboarding. */
export async function markOnboarded(userId: string): Promise<void> {
  await settleBackground();
  await getDb().update(user).set({ onboardedAt: new Date() }).where(eq(user.id, userId));
}
