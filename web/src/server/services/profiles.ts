import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { formatCaptureTime } from "@/domain/capture-time";
import { parseProfileInput } from "@/domain/handles";
import { LIMITS } from "@/domain/limits";
import { nextReviewAt } from "@/domain/schedule";
import { getDb, type Executor } from "@/server/db/client";
import { activityEntry, exportSnapshot, job, profile, usageDaily, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import { cancelQueuedJobs, type JobRow, REVIEW_KINDS, toJobDto } from "@/server/jobs/queue";

import type { EvidenceStatus, Page, ProfileDto, ProfileStatus, ProfileSummaryRecord } from "./contracts";
import {
  isoOrNull,
  notFound,
  type PageRequest,
  pageWindow,
  requireUuid,
  rethrowDomainError,
  toPage,
} from "./shared";
import { profileScope } from "./usage";

/**
 * Profiles of one user. Every function takes the user id first and puts it in
 * the WHERE clause of every statement, so an id that belongs to someone else
 * behaves exactly like an id that does not exist: `not_found`.
 */
export type ProfileRow = typeof profile.$inferSelect;

const DEFAULT_REVIEW_HOUR = 9;
const STATUSES: readonly ProfileStatus[] = ["active", "paused"];

/** The profile row, only when it belongs to the user. Otherwise `not_found`. */
export async function requireOwnedProfile(
  userId: string,
  profileId: unknown,
  executor: Executor = getDb(),
): Promise<ProfileRow> {
  const id = requireUuid(profileId);
  const [row] = await executor
    .select()
    .from(profile)
    .where(and(eq(profile.userId, userId), eq(profile.id, id)));
  if (!row) throw notFound();
  return row;
}

/** The next daily review instant for a stored schedule. A missing or unusable value falls back to 09:00 UTC. */
export function reviewTimeFor(now: Date, timezone: string | null, reviewHour: number | null): Date {
  const hour =
    typeof reviewHour === "number" && Number.isInteger(reviewHour) && reviewHour >= 0 && reviewHour <= 23
      ? reviewHour
      : DEFAULT_REVIEW_HOUR;
  try {
    return nextReviewAt(now, timezone ?? "UTC", hour);
  } catch {
    return nextReviewAt(now, "UTC", hour);
  }
}

interface CurrentSnapshot {
  id: string;
  capturedAt: Date | null;
  followersComplete: boolean;
  followingComplete: boolean;
}

interface ProfileContext {
  current: CurrentSnapshot | null;
  snapshotCount: number;
  lastImportAt: Date | null;
  activeJob: JobRow | null;
}

const EMPTY_CONTEXT: ProfileContext = { current: null, snapshotCount: 0, lastImportAt: null, activeJob: null };

/** Evidence state of the current export at `now`. Coverage comes from the stored snapshot, not the summary. */
export function evidenceOf(current: CurrentSnapshot | null, now: Date): EvidenceStatus {
  if (!current) return "missing";
  if (!current.followersComplete || !current.followingComplete) return "degraded";
  if (current.capturedAt === null || now.getTime() - current.capturedAt.getTime() > LIMITS.staleAfterMs) {
    return "stale";
  }
  return "ok";
}

/** The summary written by the derive job, or null when there is none or it is not the expected shape. */
function readSummary(value: unknown): ProfileSummaryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<ProfileSummaryRecord>;
  if (typeof record.snapshotId !== "string") return null;
  if (typeof record.coverage !== "object" || record.coverage === null) return null;
  if (typeof record.metrics !== "object" || record.metrics === null) return null;
  return record as ProfileSummaryRecord;
}

function toProfileDto(row: ProfileRow, context: ProfileContext, now: Date): ProfileDto {
  const summary = readSummary(row.summary);
  return {
    id: row.id,
    handle: row.handle,
    status: row.status === "paused" ? "paused" : "active",
    createdAt: row.createdAt.toISOString(),
    pausedAt: isoOrNull(row.pausedAt),
    evidence: evidenceOf(context.current, now),
    // The summary is trusted only at the revision it was derived for. Until the derive job
    // catches up, the last derived summary stays visible and the profile is marked processing.
    processing: row.derivedRevision !== row.contentRevision,
    currentSnapshotId: context.current?.id ?? null,
    capturedAt: context.current?.capturedAt ? formatCaptureTime(context.current.capturedAt) : null,
    lastImportAt: isoOrNull(context.lastImportAt),
    snapshotCount: context.snapshotCount,
    coverage: summary ? summary.coverage : null,
    coverageLabel: summary && typeof summary.coverageLabel === "string" ? summary.coverageLabel : null,
    metrics: summary ? summary.metrics : null,
    issues: summary && Array.isArray(summary.issues) ? summary.issues : [],
    lastSuccessAt: isoOrNull(row.lastSuccessAt),
    lastFailureAt: isoOrNull(row.lastFailureAt),
    lastFailureCode: row.lastFailureCode,
    lastReviewAt: isoOrNull(row.lastReviewAt),
    nextReviewAt: row.status === "paused" ? null : isoOrNull(row.nextReviewAt),
    activeJob: context.activeJob ? toJobDto(context.activeJob) : null,
  };
}

/** Snapshot counts, the current snapshot, and the active job for some profiles of one user. */
async function loadContexts(
  userId: string,
  profileIds: string[],
  executor: Executor,
): Promise<Map<string, ProfileContext>> {
  const contexts = new Map<string, ProfileContext>();
  if (profileIds.length === 0) return contexts;
  for (const id of profileIds) contexts.set(id, { ...EMPTY_CONTEXT });
  const owned = and(eq(exportSnapshot.userId, userId), inArray(exportSnapshot.profileId, profileIds));

  const totals = await executor
    .select({
      profileId: exportSnapshot.profileId,
      count: sql<number>`count(*)::int`,
      lastImportAt: sql<Date | null>`max(${exportSnapshot.importedAt})`.mapWith(exportSnapshot.importedAt),
    })
    .from(exportSnapshot)
    .where(owned)
    .groupBy(exportSnapshot.profileId);
  for (const total of totals) {
    const context = contexts.get(total.profileId);
    if (context) {
      context.snapshotCount = total.count;
      context.lastImportAt = total.lastImportAt;
    }
  }

  const currents = await executor
    .select({
      id: exportSnapshot.id,
      profileId: exportSnapshot.profileId,
      capturedAt: exportSnapshot.capturedAt,
      followersComplete: exportSnapshot.followersComplete,
      followingComplete: exportSnapshot.followingComplete,
    })
    .from(exportSnapshot)
    .where(and(owned, eq(exportSnapshot.isCurrent, true)));
  for (const current of currents) {
    const context = contexts.get(current.profileId);
    if (context) context.current = current;
  }

  const jobs = await executor
    .select()
    .from(job)
    .where(and(eq(job.userId, userId), inArray(job.profileId, profileIds), inArray(job.status, ["queued", "running"])))
    .orderBy(desc(job.createdAt), desc(job.id));
  for (const active of jobs) {
    const context = contexts.get(active.profileId);
    if (context && !context.activeJob) context.activeJob = active;
  }
  return contexts;
}

async function describe(userId: string, row: ProfileRow, now: Date, executor: Executor): Promise<ProfileDto> {
  const contexts = await loadContexts(userId, [row.id], executor);
  return toProfileDto(row, contexts.get(row.id) ?? EMPTY_CONTEXT, now);
}

/** The user's profiles, oldest first. */
export async function listProfiles(
  userId: string,
  request: PageRequest = {},
  now: Date = new Date(),
): Promise<Page<ProfileDto>> {
  const db = getDb();
  const window = pageWindow(request);
  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(profile)
    .where(eq(profile.userId, userId));
  const rows = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .orderBy(asc(profile.createdAt), asc(profile.id))
    .limit(window.pageSize)
    .offset(window.offset);
  const contexts = await loadContexts(
    userId,
    rows.map((row) => row.id),
    db,
  );
  return toPage(
    rows.map((row) => toProfileDto(row, contexts.get(row.id) ?? EMPTY_CONTEXT, now)),
    window,
    total?.n ?? 0,
  );
}

export async function getProfile(userId: string, profileId: string, now: Date = new Date()): Promise<ProfileDto> {
  const db = getDb();
  return describe(userId, await requireOwnedProfile(userId, profileId, db), now, db);
}

function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) => (value as { code?: unknown } | null | undefined)?.code;
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}

const DUPLICATE_MESSAGE = "You have already added that profile.";

/**
 * Add a profile for a handle or an Instagram profile link. Adding it contacts
 * nobody: the profile only names the account whose owner exports will be
 * imported. At most `LIMITS.profilesPerUser` per user; a handle the user
 * already has is a conflict.
 */
export async function createProfile(userId: string, input: unknown, now: Date = new Date()): Promise<ProfileDto> {
  let handle: string;
  try {
    handle = parseProfileInput(input);
  } catch (error) {
    rethrowDomainError(error);
  }
  const db = getDb();
  let row: ProfileRow;
  try {
    row = await db.transaction(async (tx) => {
      // Locking the user row makes the count below exact when two additions race.
      const [owner] = await tx
        .select({ timezone: user.timezone, reviewHour: user.reviewHour })
        .from(user)
        .where(eq(user.id, userId))
        .for("no key update");
      if (!owner) throw notFound();
      const existing = await tx.select({ handle: profile.handle }).from(profile).where(eq(profile.userId, userId));
      if (existing.some((item) => item.handle === handle)) throw new AppError("conflict", DUPLICATE_MESSAGE);
      if (existing.length >= LIMITS.profilesPerUser) {
        throw new AppError(
          "quota_exhausted",
          `You can add up to ${LIMITS.profilesPerUser} profiles. Remove one to add another.`,
          { quota: "profiles", limit: LIMITS.profilesPerUser },
        );
      }
      const [created] = await tx
        .insert(profile)
        .values({
          userId,
          handle,
          nextReviewAt: reviewTimeFor(now, owner.timezone, owner.reviewHour),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("the profile was not stored");
      await tx.insert(activityEntry).values({
        userId,
        profileId: created.id,
        kind: "profile_added",
        status: "info",
        summary: { handle },
        occurredAt: now,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("conflict", DUPLICATE_MESSAGE);
    throw error;
  }
  return describe(userId, row, now, db);
}

/**
 * Pause or resume a profile. Pausing stops scheduled reviews: it clears the
 * next review time and cancels queued review jobs in the same transaction.
 * Stored imports and their results are untouched. Resuming schedules the next
 * review from the user's timezone and review hour.
 */
export async function setProfileStatus(
  userId: string,
  profileId: string,
  status: ProfileStatus,
  now: Date = new Date(),
): Promise<ProfileDto> {
  if (!STATUSES.includes(status)) {
    throw new AppError("invalid_input", "The status must be active or paused.", { fields: ["status"] });
  }
  const id = requireUuid(profileId);
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(profile)
      .where(and(eq(profile.userId, userId), eq(profile.id, id)))
      .for("no key update");
    if (!current) throw notFound();
    if (current.status === status) return current;

    let nextReview: Date | null = null;
    if (status === "paused") {
      await cancelQueuedJobs(tx, { userId, profileId: id, kinds: REVIEW_KINDS }, "profile_paused");
    } else {
      const [owner] = await tx
        .select({ timezone: user.timezone, reviewHour: user.reviewHour })
        .from(user)
        .where(eq(user.id, userId));
      nextReview = reviewTimeFor(now, owner?.timezone ?? null, owner?.reviewHour ?? null);
    }
    const [updated] = await tx
      .update(profile)
      .set({ status, pausedAt: status === "paused" ? now : null, nextReviewAt: nextReview, updatedAt: now })
      .where(and(eq(profile.userId, userId), eq(profile.id, id)))
      .returning();
    if (!updated) throw notFound();
    await tx.insert(activityEntry).values({
      userId,
      profileId: id,
      kind: status === "paused" ? "profile_paused" : "profile_resumed",
      status: "info",
      summary: { handle: updated.handle },
      occurredAt: now,
    });
    return updated;
  });
  return describe(userId, row, now, db);
}

/**
 * Remove a profile. The cascade removes its snapshots, export observations,
 * jobs, and activity; its usage counters are keyed by scope and removed here.
 */
export async function deleteProfile(userId: string, profileId: string): Promise<void> {
  const id = requireUuid(profileId);
  await getDb().transaction(async (tx) => {
    const removed = await tx
      .delete(profile)
      .where(and(eq(profile.userId, userId), eq(profile.id, id)))
      .returning({ id: profile.id });
    if (removed.length === 0) throw notFound();
    await tx.delete(usageDaily).where(eq(usageDaily.scopeKey, profileScope(id)));
  });
}
