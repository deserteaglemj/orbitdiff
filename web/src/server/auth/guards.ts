import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { consentRecord } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";

import { getAuth } from "./auth";

/** The signed-in user as the application sees it. Never contains a credential. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** Anything other than `active` in the database is reported as `suspended`. */
  status: "active" | "suspended";
  timezone: string;
  reviewHour: number;
  onboardedAt: Date | null;
  acceptedTermsVersion: string | null;
  marketingOptIn: boolean;
  createdAt: Date;
}

/**
 * The guards take the request headers, so the same call works in a route
 * handler (`request.headers`), a server component (`await headers()`), and a test.
 *
 * The session is read from the database on every call (no cookie cache), so a
 * revoked session, a suspension, or a deleted account takes effect immediately.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers, query: { disableCookieCache: true } });
  if (!result) return null;
  const record = result.user;
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    emailVerified: record.emailVerified === true,
    status: record.status === "active" ? "active" : "suspended",
    timezone: record.timezone ?? "UTC",
    reviewHour: record.reviewHour ?? 9,
    onboardedAt: record.onboardedAt ?? null,
    acceptedTermsVersion: record.acceptedTermsVersion ?? null,
    marketingOptIn: record.marketingOptIn === true,
    createdAt: record.createdAt,
  };
}

/** Valid session, verified email, active status. Throws unauthenticated, unverified, or suspended. */
export async function requireUser(headers: Headers): Promise<SessionUser> {
  const user = await getSessionUser(headers);
  if (!user) throw new AppError("unauthenticated", "Sign in to continue.");
  if (!user.emailVerified) throw new AppError("unverified", "Verify your email address to continue.");
  if (user.status !== "active") throw new AppError("suspended", "This account is suspended.");
  return user;
}

/** True when the newest terms and privacy records are both granted at the current versions. */
async function hasCurrentConsent(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ kind: consentRecord.kind, version: consentRecord.version, granted: consentRecord.granted })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), inArray(consentRecord.kind, ["terms", "privacy"])))
    .orderBy(desc(consentRecord.recordedAt), desc(consentRecord.id));
  const latest = (kind: "terms" | "privacy") => rows.find((row) => row.kind === kind);
  return (["terms", "privacy"] as const).every((kind) => {
    const row = latest(kind);
    return row?.granted === true && row.version === CONSENT_VERSIONS[kind];
  });
}

/**
 * requireUser plus completed onboarding: onboarded_at is set and the newest
 * terms and privacy consent records are granted at the current versions.
 * Otherwise throws `conflict` with details `{ onboarding: true }`, which the
 * interface uses to send the user to the onboarding step.
 */
export async function requireOnboardedUser(headers: Headers): Promise<SessionUser> {
  const user = await requireUser(headers);
  if (!user.onboardedAt || !(await hasCurrentConsent(user.id))) {
    throw new AppError("conflict", "Finish onboarding to continue.", { onboarding: true });
  }
  return user;
}

/** Admin is an environment allowlist of addresses. No column, request field, or sign-up order grants it. */
export function isAdminEmail(email: string): boolean {
  return getEnv().adminEmails.has(email.trim().toLowerCase());
}

/**
 * Passes only for a verified, active user whose address is in ADMIN_EMAILS.
 * Everyone else, signed in or not, gets `not_found`, so the admin surface is
 * indistinguishable from a missing page.
 */
export async function requireAdmin(headers: Headers): Promise<SessionUser> {
  const user = await getSessionUser(headers);
  if (!user || !user.emailVerified || user.status !== "active" || !isAdminEmail(user.email)) {
    throw new AppError("not_found", "Not found.");
  }
  return user;
}
