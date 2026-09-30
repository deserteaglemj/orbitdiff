import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { isValidTimezone } from "@/domain/schedule";
import { isAdminEmail } from "@/server/auth/guards";
import { getDb, type Executor } from "@/server/db/client";
import {
  activityEntry,
  changeEvent,
  consentRecord,
  exportSnapshot,
  job,
  profile,
  session,
  usageDaily,
  user,
} from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import {
  appendConsent,
  consentSatisfied,
  getConsentState,
  hasCurrentConsent,
  missingConsent,
  REQUIRED_CONSENT,
} from "./consent";
import type { ConsentStateDto, MeDto, OnboardingRequestDto } from "./contracts";
import { reviewTimeFor } from "./profiles";
import { isoOrNull, notFound } from "./shared";
import { captureTimeOf } from "./snapshot-rows";
import { getUserUsage, profileScope, userScope } from "./usage";

export { consentSatisfied, getConsentState, hasCurrentConsent, missingConsent };

/** The same bound the sign-up gate applies to a name. */
const NAME_MAX = 100;
const DEFAULT_REVIEW_HOUR = 9;

type UserRow = typeof user.$inferSelect;

async function requireUserRow(userId: string, executor: Executor): Promise<UserRow> {
  const [row] = await executor.select().from(user).where(eq(user.id, userId));
  if (!row) throw notFound();
  return row;
}

function invalid(field: string, message: string): AppError {
  return new AppError("invalid_input", message, { fields: [field] });
}

/**
 * The signed-in user's own account. `isAdmin` is derived from the ADMIN_EMAILS
 * allowlist for a verified, active address. It is never stored and cannot be
 * set by any request.
 */
export async function getMe(userId: string, now: Date = new Date()): Promise<MeDto> {
  const db = getDb();
  const row = await requireUserRow(userId, db);
  const consent = await getConsentState(userId, db);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    timezone: row.timezone ?? "UTC",
    reviewHour: row.reviewHour ?? DEFAULT_REVIEW_HOUR,
    onboarded: row.onboardedAt !== null && consentSatisfied(consent),
    isAdmin: row.emailVerified === true && row.status === "active" && isAdminEmail(row.email),
    consent,
    usage: await getUserUsage(userId, now, db),
  };
}

export interface UpdateMeInput {
  name?: string;
  timezone?: string;
  reviewHour?: number;
}

const UPDATABLE = new Set(["name", "timezone", "reviewHour"]);

/**
 * Change the name, timezone, or daily review hour. Nothing else about an
 * account can be changed here: a field outside those three is refused, never
 * ignored. A new timezone or hour reschedules the next review of the user's
 * active profiles.
 */
export async function updateMe(userId: string, input: UpdateMeInput, now: Date = new Date()): Promise<MeDto> {
  const unknown = Object.keys(input).filter((key) => !UPDATABLE.has(key));
  if (unknown.length > 0) {
    throw new AppError("invalid_input", "Only the name, timezone, and review hour can be changed.", {
      fields: unknown.sort(),
    });
  }
  const changes: Partial<Pick<UserRow, "name" | "timezone" | "reviewHour">> = {};
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length === 0 || name.length > NAME_MAX) {
      throw invalid("name", `The name must be 1 to ${NAME_MAX} characters.`);
    }
    changes.name = name;
  }
  if (input.timezone !== undefined) {
    if (!isValidTimezone(input.timezone)) {
      throw invalid("timezone", "Choose a timezone by its IANA name, for example Europe/Berlin.");
    }
    changes.timezone = input.timezone;
  }
  if (input.reviewHour !== undefined) {
    const hour = input.reviewHour;
    if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw invalid("reviewHour", "The review hour must be a whole number from 0 to 23.");
    }
    changes.reviewHour = hour;
  }
  if (Object.keys(changes).length === 0) {
    throw new AppError("invalid_input", "Send at least one of name, timezone, or reviewHour.");
  }

  await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select({ timezone: user.timezone, reviewHour: user.reviewHour })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    if (!before) throw notFound();
    await tx.update(user).set(changes).where(eq(user.id, userId));
    const timezone = changes.timezone ?? before.timezone;
    const reviewHour = changes.reviewHour ?? before.reviewHour;
    if (timezone !== before.timezone || reviewHour !== before.reviewHour) {
      await tx
        .update(profile)
        .set({ nextReviewAt: reviewTimeFor(now, timezone, reviewHour), updatedAt: now })
        .where(and(eq(profile.userId, userId), eq(profile.status, "active")));
    }
  });
  return getMe(userId, now);
}

/**
 * Record a marketing consent choice. Appends to the log and mirrors the
 * choice on the account. Marketing consent is optional and separate: it is
 * never recorded as a side effect of accepting the terms, and changing it
 * never touches terms or privacy consent.
 */
export async function recordMarketingConsent(
  userId: string,
  granted: boolean,
  now: Date = new Date(),
): Promise<ConsentStateDto> {
  if (typeof granted !== "boolean") throw invalid("granted", "Send granted as true or false.");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("no key update");
    if (!owner) throw notFound();
    await appendConsent(tx, userId, "marketing", CONSENT_VERSIONS.marketing, granted, "settings", now);
    await tx.update(user).set({ marketingOptIn: granted }).where(eq(user.id, userId));
  });
  return getConsentState(userId, db);
}

/** The versions of the two documents the person read and accepts. Naming a version is the acceptance. */
export type OnboardingInput = OnboardingRequestDto;

/** The request field that names the accepted version of each required document. */
const ACCEPTED_VERSION = {
  terms: { field: "termsVersion", document: "Terms" },
  privacy: { field: "privacyVersion", document: "Privacy notice" },
} as const;

/** Why a named version does not accept the current document, or null when it does. Never repeats the value. */
function versionProblem(kind: "terms" | "privacy", value: unknown): string | null {
  const { field, document } = ACCEPTED_VERSION[kind];
  if (value === undefined) return `${field} is missing.`;
  if (typeof value !== "string") return `${field} must be text.`;
  if (value.length === 0) return `${field} is empty.`;
  if (value !== CONSENT_VERSIONS[kind]) return `${field} is not the current version of the ${document}.`;
  return null;
}

/**
 * Finish onboarding. The request names the version of the Terms and of the
 * Privacy notice that the person read. Each one must be the current version
 * of its own document, as a string, compared in full. Every other state is
 * refused and nothing is written: a missing or empty value, a value that is
 * not text, an older version, a version that was never published, the version
 * of the other document. Nothing is filled in for the caller, so a page that
 * was opened before a document changed cannot accept the new text unread.
 * Anything else in the input, marketing included, is refused as well, so
 * optional consent can never ride along.
 *
 * On acceptance, terms and privacy rows at the versions the request named are
 * appended for the kinds that are not already current, and `onboarded_at` is set.
 */
export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
  now: Date = new Date(),
): Promise<MeDto> {
  const given: Record<string, unknown> =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as unknown as Record<string, unknown>)
      : {};
  const allowed: string[] = REQUIRED_CONSENT.map((kind) => ACCEPTED_VERSION[kind].field);
  const extra = Object.keys(given).filter((key) => !allowed.includes(key));
  const named = (kind: "terms" | "privacy"): unknown => {
    const { field } = ACCEPTED_VERSION[kind];
    return Object.hasOwn(given, field) ? given[field] : undefined;
  };
  const problems = REQUIRED_CONSENT.flatMap((kind) => {
    const problem = versionProblem(kind, named(kind));
    return problem === null ? [] : [{ field: ACCEPTED_VERSION[kind].field, problem }];
  });
  if (extra.length > 0 || problems.length > 0) {
    const message =
      extra.length > 0
        ? "Only termsVersion and privacyVersion can be sent here."
        : `${problems.map((entry) => entry.problem).join(" ")} ` +
          "Reload this page, read the current Terms and Privacy notice, and accept them to continue.";
    throw new AppError("invalid_input", message, {
      fields: [...extra, ...problems.map((entry) => entry.field)].sort(),
    });
  }
  // Past this point both values are strings equal to the current versions. They are what gets recorded.
  const accepted = { terms: named("terms") as string, privacy: named("privacy") as string };

  await getDb().transaction(async (tx) => {
    const [owner] = await tx
      .select({ onboardedAt: user.onboardedAt })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    if (!owner) throw notFound();
    const missing = missingConsent(await getConsentState(userId, tx));
    // A first onboarding records the acceptance itself, even when sign-up consent is still current.
    const kinds = owner.onboardedAt === null ? REQUIRED_CONSENT : missing;
    for (const kind of kinds) await appendConsent(tx, userId, kind, accepted[kind], true, "onboarding", now);
    await tx
      .update(user)
      .set({ onboardedAt: owner.onboardedAt ?? now, acceptedTermsVersion: accepted.terms })
      .where(eq(user.id, userId));
  });
  return getMe(userId, now);
}

/** Everything the service stores about one user. See exportAccount. */
export interface AccountExport {
  format: "orbitdiff.account-export";
  version: 1;
  exportedAt: string;
  account: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    status: string | null;
    timezone: string | null;
    reviewHour: number | null;
    marketingOptIn: boolean | null;
    acceptedTermsVersion: string | null;
    onboardedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  /** Sign-ins on record. The credential of a sign-in is never exported. */
  signIns: Array<{ createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null }>;
  consent: Array<{ kind: string; version: string; granted: boolean; source: string; recordedAt: string }>;
  profiles: Array<{
    id: string;
    handle: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    pausedAt: string | null;
    nextReviewAt: string | null;
    lastReviewAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureCode: string | null;
    contentRevision: number;
    derivedRevision: number;
    summary: unknown;
  }>;
  snapshots: Array<{
    id: string;
    profileId: string;
    capturedAt: string | null;
    importedAt: string;
    isCurrent: boolean;
    snapshotDigest: string;
    contentDigest: string;
    followers: string[] | null;
    following: string[] | null;
    shards: { followers: number[]; following: number[] };
    declaredComplete: { followers: boolean; following: boolean };
    effectiveComplete: { followers: boolean; following: boolean };
    rosterBytes: number;
    source: "instagram_export";
  }>;
  /** Differences between two dated exports. Observations of those files, not live follows or unfollows. */
  events: Array<{
    id: string;
    profileId: string;
    type: string;
    direction: string;
    username: string;
    intervalStart: string | null;
    intervalEnd: string | null;
    evidence: "export_observation";
  }>;
  activity: Array<{
    id: string;
    profileId: string | null;
    kind: string;
    status: string;
    occurredAt: string;
    summary: unknown;
  }>;
  jobs: Array<{
    id: string;
    profileId: string;
    kind: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    runAfter: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    lastErrorCode: string | null;
    cancelReason: string | null;
  }>;
  usage: Array<{
    day: string;
    scope: "account" | "profile";
    profileId: string | null;
    imports: number;
    manualReviews: number;
    jobs: number;
  }>;
}

/**
 * Everything stored for one user, and nothing about anyone else: every query
 * below is filtered by this user id (usage counters by this user's scope
 * keys). Columns are listed one by one, so a column added later is not
 * exported by accident. Never included: password hashes, the credential of a
 * sign-in, verification values, captured mail, and internal job locks.
 */
export async function exportAccount(userId: string, now: Date = new Date()): Promise<AccountExport> {
  const db = getDb();
  const owner = await requireUserRow(userId, db);

  const signIns = await db
    .select({
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(asc(session.createdAt));
  const consent = await db
    .select()
    .from(consentRecord)
    .where(eq(consentRecord.userId, userId))
    .orderBy(asc(consentRecord.recordedAt), asc(consentRecord.id));
  const profiles = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .orderBy(asc(profile.createdAt), asc(profile.id));
  const snapshots = await db
    .select()
    .from(exportSnapshot)
    .where(eq(exportSnapshot.userId, userId))
    .orderBy(asc(exportSnapshot.profileId), asc(exportSnapshot.importedAt), asc(exportSnapshot.id));
  const events = await db
    .select()
    .from(changeEvent)
    .where(eq(changeEvent.userId, userId))
    .orderBy(asc(changeEvent.profileId), asc(changeEvent.position), asc(changeEvent.id));
  const activity = await db
    .select()
    .from(activityEntry)
    .where(eq(activityEntry.userId, userId))
    .orderBy(asc(activityEntry.occurredAt), asc(activityEntry.id));
  const jobs = await db
    .select()
    .from(job)
    .where(eq(job.userId, userId))
    .orderBy(asc(job.createdAt), asc(job.id));
  const scopes = new Map<string, string | null>([[userScope(userId), null]]);
  for (const row of profiles) scopes.set(profileScope(row.id), row.id);
  const usage = await db
    .select()
    .from(usageDaily)
    .where(inArray(usageDaily.scopeKey, [...scopes.keys()]))
    .orderBy(asc(usageDaily.day), asc(usageDaily.scopeKey));

  return {
    format: "orbitdiff.account-export",
    version: 1,
    exportedAt: now.toISOString(),
    account: {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      emailVerified: owner.emailVerified,
      status: owner.status,
      timezone: owner.timezone,
      reviewHour: owner.reviewHour,
      marketingOptIn: owner.marketingOptIn,
      acceptedTermsVersion: owner.acceptedTermsVersion,
      onboardedAt: isoOrNull(owner.onboardedAt),
      createdAt: owner.createdAt.toISOString(),
      updatedAt: owner.updatedAt.toISOString(),
    },
    signIns: signIns.map((row) => ({
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    })),
    consent: consent.map((row) => ({
      kind: row.kind,
      version: row.version,
      granted: row.granted,
      source: row.source,
      recordedAt: row.recordedAt.toISOString(),
    })),
    profiles: profiles.map((row) => ({
      id: row.id,
      handle: row.handle,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      pausedAt: isoOrNull(row.pausedAt),
      nextReviewAt: isoOrNull(row.nextReviewAt),
      lastReviewAt: isoOrNull(row.lastReviewAt),
      lastSuccessAt: isoOrNull(row.lastSuccessAt),
      lastFailureAt: isoOrNull(row.lastFailureAt),
      lastFailureCode: row.lastFailureCode,
      contentRevision: row.contentRevision,
      derivedRevision: row.derivedRevision,
      summary: row.summary ?? null,
    })),
    snapshots: snapshots.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      capturedAt: captureTimeOf(row.capturedAt),
      importedAt: row.importedAt.toISOString(),
      isCurrent: row.isCurrent,
      snapshotDigest: row.snapshotDigest,
      contentDigest: row.contentDigest,
      followers: row.followers,
      following: row.following,
      shards: { followers: row.followersShards, following: row.followingShards },
      declaredComplete: { followers: row.declaredCompleteFollowers, following: row.declaredCompleteFollowing },
      effectiveComplete: { followers: row.followersComplete, following: row.followingComplete },
      rosterBytes: row.rosterBytes,
      source: "instagram_export",
    })),
    events: events.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      type: row.eventType,
      direction: row.direction,
      username: row.username,
      intervalStart: captureTimeOf(row.intervalStart),
      intervalEnd: captureTimeOf(row.intervalEnd),
      evidence: "export_observation",
    })),
    activity: activity.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      kind: row.kind,
      status: row.status,
      occurredAt: row.occurredAt.toISOString(),
      summary: row.summary,
    })),
    jobs: jobs.map((row) => ({
      id: row.id,
      profileId: row.profileId,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      runAfter: row.runAfter.toISOString(),
      createdAt: row.createdAt.toISOString(),
      startedAt: isoOrNull(row.startedAt),
      finishedAt: isoOrNull(row.finishedAt),
      lastErrorCode: row.lastErrorCode,
      cancelReason: row.cancelReason,
    })),
    usage: usage.map((row) => ({
      day: row.day,
      scope: row.scopeKey === userScope(userId) ? "account" : "profile",
      profileId: scopes.get(row.scopeKey) ?? null,
      imports: row.imports,
      manualReviews: row.manualReviews,
      jobs: row.jobs,
    })),
  };
}
