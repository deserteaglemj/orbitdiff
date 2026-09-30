import "server-only";

import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";

import { LIMITS } from "@/domain/limits";
import { purgeUserLeftovers } from "@/server/auth/deletion";
import { getDb } from "@/server/db/client";
import { activityEntry, job, mailCapture, profile, rateLimit, user, verification } from "@/server/db/schema";
import { logError } from "@/server/http/log";

/** Rows removed per kind in one run. A backlog is worked off over several runs. */
export const RETENTION_BATCH = 500;

const DAY_MS = 86_400_000;
/** A rate limit counter is dead once its longest window (ten minutes) has passed. */
const RATE_LIMIT_IDLE_MS = 10 * 60 * 1000;
const FINISHED = ["succeeded", "failed", "cancelled"];

export interface RetentionSummary {
  jobs: number;
  activity: number;
  unverifiedAccounts: number;
  mail: number;
  verifications: number;
  rateLimits: number;
  total: number;
}

export interface RetentionOptions {
  now: Date;
  batch?: number;
}

/** One kind failing must not keep the others from being cleaned. */
async function step(work: () => Promise<number>): Promise<number> {
  try {
    return await work();
  } catch (error) {
    logError("jobs.retention", error);
    return 0;
  }
}

/**
 * Remove what has outlived its purpose: finished jobs and activity past their windows,
 * accounts that never got past sign-up (unverified and without a profile), captured mail,
 * expired verification rows, and idle rate limit counters. Every delete is bounded. Export
 * snapshots, change events, profiles, verified accounts, and any account that holds a
 * profile are never touched here: a user's stored evidence only goes when the user
 * removes it.
 */
export async function runRetention(options: RetentionOptions): Promise<RetentionSummary> {
  const db = getDb();
  const batch = options.batch ?? RETENTION_BATCH;
  const before = (days: number) => new Date(options.now.getTime() - days * DAY_MS);

  const jobs = await step(async () => {
    const doomed = db
      .select({ id: job.id })
      .from(job)
      .where(and(inArray(job.status, FINISHED), lt(job.finishedAt, before(LIMITS.retainJobsDays))))
      .limit(batch);
    return (await db.delete(job).where(inArray(job.id, doomed)).returning({ id: job.id })).length;
  });

  const activity = await step(async () => {
    const doomed = db
      .select({ id: activityEntry.id })
      .from(activityEntry)
      .where(lt(activityEntry.occurredAt, before(LIMITS.retainActivityDays)))
      .limit(batch);
    return (await db.delete(activityEntry).where(inArray(activityEntry.id, doomed)).returning({ id: activityEntry.id }))
      .length;
  });

  const unverifiedAccounts = await step(async () => {
    const cutoff = before(LIMITS.retainUnverifiedAccountDays);
    // Only an account that never got past sign-up: unverified, old, and without a profile. An
    // account that holds a profile holds evidence, whatever its verification flag says now.
    const stale = and(
      eq(user.emailVerified, false),
      lt(user.createdAt, cutoff),
      notExists(db.select({ one: sql`1` }).from(profile).where(eq(profile.userId, user.id))),
    );
    const doomed = db.select({ id: user.id }).from(user).where(stale).limit(batch);
    // The condition is repeated on the delete itself: an account verified a moment ago, or
    // one that has just added a profile, stays.
    const removed = await db
      .delete(user)
      .where(and(inArray(user.id, doomed), stale))
      .returning({ id: user.id, email: user.email });
    for (const account of removed) await purgeUserLeftovers(account.id, account.email);
    return removed.length;
  });

  const mail = await step(async () => {
    const doomed = db
      .select({ id: mailCapture.id })
      .from(mailCapture)
      .where(lt(mailCapture.createdAt, before(LIMITS.retainCapturedMailDays)))
      .limit(batch);
    return (await db.delete(mailCapture).where(inArray(mailCapture.id, doomed)).returning({ id: mailCapture.id })).length;
  });

  const verifications = await step(async () => {
    const doomed = db
      .select({ id: verification.id })
      .from(verification)
      .where(lt(verification.expiresAt, options.now))
      .limit(batch);
    return (await db.delete(verification).where(inArray(verification.id, doomed)).returning({ id: verification.id }))
      .length;
  });

  const rateLimits = await step(async () => {
    const doomed = db
      .select({ id: rateLimit.id })
      .from(rateLimit)
      .where(lt(rateLimit.lastRequest, options.now.getTime() - RATE_LIMIT_IDLE_MS))
      .limit(batch);
    return (await db.delete(rateLimit).where(inArray(rateLimit.id, doomed)).returning({ id: rateLimit.id })).length;
  });

  return {
    jobs,
    activity,
    unverifiedAccounts,
    mail,
    verifications,
    rateLimits,
    total: jobs + activity + unverifiedAccounts + mail + verifications + rateLimits,
  };
}
