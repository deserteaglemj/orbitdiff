import "server-only";

import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { isDomainError } from "@/domain/errors";
import { LIMITS } from "@/domain/limits";
import { type Executor, getDb } from "@/server/db/client";
import { activityEntry, job, profile, usageDaily, user } from "@/server/db/schema";
import { logError } from "@/server/http/log";
import type { JobKind } from "@/server/services/contracts";
import { GLOBAL_SCOPE, utcDay } from "@/server/services/usage";

import { type JobRow, REVIEW_KINDS } from "./queue";

export type ProfileRow = typeof profile.$inferSelect;

/** What a worker may know about the owner of a job: standing and schedule, never a credential. */
export interface JobOwner {
  id: string;
  emailVerified: boolean;
  status: string | null;
  timezone: string | null;
  reviewHour: number | null;
}

export interface JobContext {
  job: JobRow;
  user: JobOwner;
  /** Read under a row lock, so it does not change while the handler runs. */
  profile: ProfileRow;
  now: Date;
}

/** What a handler returns is stored in job.result. Counts and flags only. */
export type JobResult = Record<string, unknown> | null | void;

/**
 * A handler does its reads and writes through the transaction it is given. The worker
 * commits them together with the job's completion, or not at all.
 */
export type JobHandler = (tx: Executor, context: JobContext) => Promise<JobResult>;

export type JobHandlers = Record<JobKind, JobHandler>;

export type JobOutcome = "succeeded" | "retried" | "failed" | "cancelled" | "lost";

/** Stored in activity_entry.summary for kind `job_failed`. */
export interface JobFailedRecord {
  jobKind: JobKind;
  errorCode: string;
  attempts: number;
}

/** The identity of one claim: the job and the token its claimer was given. */
export interface Lease {
  id: string;
  lockToken: string | null;
}

export interface ClaimInput {
  now: Date;
  /** The most jobs to claim. */
  limit: number;
  /** Only claim jobs of this profile. */
  profileId?: string;
}

/**
 * Take due queued jobs for this worker. Rows another worker is claiming are skipped, not
 * waited for, so two callers never receive the same job. Each claimed job gets a fresh lock
 * token and a lease; only the holder of that token may complete or fail it. A job counts
 * toward the day's total once, on its first claim.
 */
export async function claimJobs(input: ClaimInput): Promise<JobRow[]> {
  if (input.limit < 1) return [];
  return getDb().transaction(async (tx) => {
    const conditions = [eq(job.status, "queued"), lte(job.runAfter, input.now)];
    if (input.profileId) conditions.push(eq(job.profileId, input.profileId));
    const due = await tx
      .select({ id: job.id, attempts: job.attempts })
      .from(job)
      .where(and(...conditions))
      .orderBy(asc(job.runAfter), asc(job.createdAt), asc(job.id))
      .limit(input.limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    const claimed = await tx
      .update(job)
      .set({
        status: "running",
        lockToken: sql`gen_random_uuid()`,
        lockedUntil: new Date(input.now.getTime() + LIMITS.jobLeaseMs),
        attempts: sql`${job.attempts} + 1`,
        startedAt: input.now,
      })
      .where(
        inArray(
          job.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
    const firstClaims = due.filter((row) => row.attempts === 0).length;
    if (firstClaims > 0) {
      await tx
        .insert(usageDaily)
        .values({ day: utcDay(input.now), scopeKey: GLOBAL_SCOPE, jobs: firstClaims })
        .onConflictDoUpdate({
          target: [usageDaily.day, usageDaily.scopeKey],
          set: { jobs: sql`${usageDaily.jobs} + excluded.jobs` },
        });
    }
    const order = new Map(due.map((row, index) => [row.id, index]));
    return claimed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  });
}

/** The guard every write of a worker goes through: the job is running under this exact token. */
function heldBy(lease: Lease) {
  if (!lease.lockToken) return sql`false`;
  return and(eq(job.id, lease.id), eq(job.status, "running"), eq(job.lockToken, lease.lockToken));
}

/**
 * Mark a claimed job succeeded. Returns false, and changes nothing, unless the job is still
 * running under the caller's lock token: a worker whose lease was taken over, or a second
 * delivery of a finished job, cannot write. Call it inside the transaction that holds the
 * job's results so both commit together.
 */
export async function completeJob(
  executor: Executor,
  lease: Lease,
  options: { now: Date; result?: JobResult },
): Promise<boolean> {
  if (!lease.lockToken) return false;
  const done = await executor
    .update(job)
    .set({
      status: "succeeded",
      finishedAt: options.now,
      lockToken: null,
      lockedUntil: null,
      result: options.result ?? null,
    })
    .where(heldBy(lease))
    .returning({ id: job.id });
  return done.length === 1;
}

/**
 * Lock the owner of a job in the order an account or profile deletion takes its locks
 * (user, then profile, then job), so a worker and a deletion can never wait on each other.
 * A row that is being deleted is waited for and then reported missing.
 */
async function lockOwner(
  tx: Executor,
  userId: string,
  profileId: string,
): Promise<{ user: JobOwner | null; profile: ProfileRow | null }> {
  const [owner] = await tx
    .select({
      id: user.id,
      emailVerified: user.emailVerified,
      status: user.status,
      timezone: user.timezone,
      reviewHour: user.reviewHour,
    })
    .from(user)
    .where(eq(user.id, userId))
    .for("key share");
  if (!owner) return { user: null, profile: null };
  const [target] = await tx
    .select()
    .from(profile)
    .where(and(eq(profile.id, profileId), eq(profile.userId, userId)))
    .for("no key update");
  return { user: owner, profile: target ?? null };
}

/** Why a job may not run now, or null when it may. Checked at execution time, not at enqueue. */
function refusal(owner: { user: JobOwner | null; profile: ProfileRow | null }, kind: string): string | null {
  if (!owner.user) return "user_missing";
  if (!owner.user.emailVerified) return "user_unverified";
  if (owner.user.status !== "active") return "user_suspended";
  if (!owner.profile) return "profile_missing";
  if (REVIEW_KINDS.includes(kind as JobKind) && owner.profile.status !== "active") return "profile_paused";
  return null;
}

async function recordFailure(tx: Executor, row: JobRow, errorCode: string, now: Date): Promise<void> {
  const record: JobFailedRecord = { jobKind: row.kind as JobKind, errorCode, attempts: row.attempts };
  await tx
    .insert(activityEntry)
    .values({
      userId: row.userId,
      profileId: row.profileId,
      jobId: row.id,
      kind: "job_failed",
      status: "failed",
      summary: record,
      occurredAt: now,
    })
    .onConflictDoNothing();
  await tx
    .update(profile)
    .set({ lastFailureAt: now, lastFailureCode: errorCode, updatedAt: now })
    .where(and(eq(profile.id, row.profileId), eq(profile.userId, row.userId)));
}

/**
 * Record a failed attempt. Before the attempt limit the job goes back to the queue with a
 * backoff; at the limit it is marked failed, one `job_failed` activity entry is written and
 * the profile's last failure is set. The last success, the summary, the events and the
 * snapshots are never touched. Guarded like completeJob: a stale token writes nothing.
 */
export async function failJob(
  claim: JobRow,
  options: { now: Date; errorCode: string },
): Promise<"retried" | "failed" | "lost"> {
  if (!claim.lockToken) return "lost";
  const final = claim.attempts >= claim.maxAttempts;
  return getDb().transaction(async (tx) => {
    if (final) await lockOwner(tx, claim.userId, claim.profileId);
    const backoff = LIMITS.jobBackoffMs[Math.min(Math.max(claim.attempts, 1), LIMITS.jobBackoffMs.length) - 1];
    const [row] = await tx
      .update(job)
      .set(
        final
          ? { status: "failed", finishedAt: options.now, lockToken: null, lockedUntil: null, lastErrorCode: options.errorCode }
          : {
              status: "queued",
              runAfter: new Date(options.now.getTime() + backoff),
              lockToken: null,
              lockedUntil: null,
              lastErrorCode: options.errorCode,
            },
      )
      .where(heldBy(claim))
      .returning();
    if (!row) return "lost";
    if (!final) return "retried";
    await recordFailure(tx, row, options.errorCode, options.now);
    return "failed";
  });
}

const RECOVERY_BATCH = 100;
const LEASE_EXPIRED = "lease_expired";

/**
 * Deal with running jobs whose worker went away and whose lease ran out:
 * back to the queue while attempts remain, failed (with the usual failure record) at the
 * attempt limit. A worker that is merely slow loses its token here and can no longer write.
 */
export async function recoverExpiredLeases(now: Date): Promise<{ requeued: number; failed: number }> {
  const db = getDb();
  // A running job with no lease at all is treated as expired: nothing else would ever free it.
  const expired = and(eq(job.status, "running"), or(isNull(job.lockedUntil), lt(job.lockedUntil, now)));
  const requeued = await db
    .update(job)
    .set({ status: "queued", lockToken: null, lockedUntil: null, lastErrorCode: LEASE_EXPIRED })
    .where(and(expired, lt(job.attempts, job.maxAttempts)))
    .returning({ id: job.id });
  const spent = await db
    .select()
    .from(job)
    .where(and(expired, gte(job.attempts, job.maxAttempts)))
    .limit(RECOVERY_BATCH);
  let failed = 0;
  for (const candidate of spent) {
    try {
      const done = await db.transaction(async (tx) => {
        await lockOwner(tx, candidate.userId, candidate.profileId);
        const [row] = await tx
          .update(job)
          .set({ status: "failed", finishedAt: now, lockToken: null, lockedUntil: null, lastErrorCode: LEASE_EXPIRED })
          .where(
            and(eq(job.id, candidate.id), expired, sql`${job.lockToken} is not distinct from ${candidate.lockToken}`),
          )
          .returning();
        if (!row) return false;
        await recordFailure(tx, row, LEASE_EXPIRED, now);
        return true;
      });
      if (done) failed += 1;
    } catch (error) {
      logError("jobs", error);
    }
  }
  return { requeued: requeued.length, failed };
}

/** A failed database statement carries the statement and its values; only that fact is kept. */
function isQueryFailure(error: unknown): boolean {
  return error instanceof Error && ("query" in error || "params" in error);
}

/** A fixed, data-free code for a failure. Messages are never stored: they can hold user data. */
export function errorCodeOf(error: unknown): string {
  if (isDomainError(error)) return error.code;
  if (isQueryFailure(error)) return "database_error";
  return "handler_error";
}

/**
 * Run one claimed job. Authorization happens here, at execution time: the owner must exist,
 * be verified and be active, the profile must exist, and a review needs an active profile;
 * otherwise the job is cancelled with the reason. The handler's writes and the completion
 * guard share one transaction, so a late or repeated delivery writes nothing at all.
 */
export async function executeJob(
  claim: JobRow,
  options: { now: Date; handlers: JobHandlers },
): Promise<JobOutcome> {
  const { now } = options;
  const handler = options.handlers[claim.kind as JobKind];
  try {
    return await getDb().transaction(async (tx): Promise<JobOutcome> => {
      const owner = await lockOwner(tx, claim.userId, claim.profileId);
      const [held] = await tx.select({ id: job.id }).from(job).where(heldBy(claim)).for("update");
      // Removing a profile or an account removes its jobs, so a vanished owner means a vanished job.
      if (!held) return owner.user && owner.profile ? "lost" : "cancelled";
      const reason = refusal(owner, claim.kind);
      if (reason !== null || !owner.user || !owner.profile) {
        await tx
          .update(job)
          .set({ status: "cancelled", cancelReason: reason, finishedAt: now, lockToken: null, lockedUntil: null })
          .where(heldBy(claim));
        return "cancelled";
      }
      // Completed first, inside the same transaction, so the handler may queue a follow-up of
      // its own kind (one active job per profile and kind). Nothing is visible until commit,
      // and a handler that throws rolls the completion back with everything else.
      if (!(await completeJob(tx, claim, { now }))) throw new Error("the job lease was lost");
      const result = await handler(tx, { job: claim, user: owner.user, profile: owner.profile, now });
      if (result) await tx.update(job).set({ result }).where(eq(job.id, claim.id));
      return "succeeded";
    });
  } catch (error) {
    logError("jobs", error);
    try {
      return await failJob(claim, { now, errorCode: errorCodeOf(error) });
    } catch (failure) {
      // The lease will run out and the next tick recovers the job.
      logError("jobs", failure);
      return "lost";
    }
  }
}
