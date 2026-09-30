import "server-only";

import { and, asc, eq, inArray, isNotNull, lt, lte, notExists, sql } from "drizzle-orm";

import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import { localDateKey } from "@/domain/schedule";
import { getDb } from "@/server/db/client";
import { consentRecord, job, profile, user } from "@/server/db/schema";
import { LAST_TICK_STATE_KEY } from "@/server/http/health";
import { logError } from "@/server/http/log";
import type { TickSummaryDto } from "@/server/services/contracts";
import { reviewTimeFor } from "@/server/services/profiles";
import { utcDay } from "@/server/services/usage";

import { measureDatabase, readJobCapacity, recordJobCapacity, saveState } from "./capacity";
import { JOB_HANDLERS } from "./handlers";
import { dedupeKey, enqueueJob } from "./queue";
import { runRetention, RETENTION_BATCH } from "./retention";
import { claimJobs, executeJob, type JobHandlers, recoverExpiredLeases } from "./worker";

export interface TickLimits {
  /** Jobs drained by one tick. */
  tickMaxJobs: number;
  /** Workers draining side by side. */
  tickConcurrency: number;
  /** Wall-clock budget of the drain. */
  tickBudgetMs: number;
  /** Profiles looked at for a due review, and for drift, in one tick. */
  dueBatch: number;
  /** Rows of each kind removed by retention in one tick. */
  retentionBatch: number;
}

export const TICK_LIMITS: TickLimits = {
  tickMaxJobs: LIMITS.tickMaxJobs,
  tickConcurrency: LIMITS.tickConcurrency,
  tickBudgetMs: LIMITS.tickBudgetMs,
  dueBatch: 200,
  retentionBatch: RETENTION_BATCH,
};

export interface TickOptions {
  /** The instant the tick works at: what is due, what a review sees, what a lease is measured from. */
  now: Date;
  /** Replace the handler of a job kind. For tests. */
  handlers?: Partial<JobHandlers>;
  limits?: Partial<TickLimits>;
}

export interface DrainOptions {
  now: Date;
  /** The most jobs to run. */
  limit: number;
  /** Only run jobs of this profile: the opportunistic drain right after an import. */
  profileId?: string;
  handlers?: Partial<JobHandlers>;
  concurrency?: number;
  budgetMs?: number;
}

export interface DrainSummary {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  cancelled: number;
}

/**
 * Run due jobs until the limit, the time budget, or the queue is exhausted. Each worker
 * claims one job at a time, so a job is never held while another is being worked on and an
 * overlapping drain can take what is left. It never throws for a job: a failing job is
 * retried or failed by the worker, and a job whose owner is gone is simply dropped.
 *
 * Call it only after the transaction that queued the job has committed.
 */
export async function drainJobs(options: DrainOptions): Promise<DrainSummary> {
  const handlers: JobHandlers = { ...JOB_HANDLERS, ...options.handlers };
  const budgetMs = options.budgetMs ?? LIMITS.tickBudgetMs;
  const workers = Math.max(1, Math.min(options.concurrency ?? LIMITS.tickConcurrency, options.limit));
  const started = performance.now();
  const summary: DrainSummary = { claimed: 0, succeeded: 0, failed: 0, retried: 0, cancelled: 0 };
  let reserved = 0;

  const work = async (): Promise<void> => {
    while (reserved < options.limit && performance.now() - started < budgetMs) {
      reserved += 1;
      try {
        const [claim] = await claimJobs({ now: options.now, limit: 1, profileId: options.profileId });
        if (!claim) return;
        summary.claimed += 1;
        const outcome = await executeJob(claim, { now: options.now, handlers });
        if (outcome !== "lost") summary[outcome] += 1;
      } catch (error) {
        logError("jobs", error);
        return;
      }
    }
  };
  if (options.limit > 0) await Promise.all(Array.from({ length: workers }, work));
  return summary;
}

/** True when the user's newest record of this kind is a grant of the current version. */
function consentCurrent(kind: "terms" | "privacy") {
  return sql`(
    select c.granted and c.version = ${CONSENT_VERSIONS[kind]}
    from ${consentRecord} c
    where c.user_id = ${user.id} and c.kind = ${kind}
    order by c.recorded_at desc, c.id desc
    limit 1
  ) is true`;
}

function localDate(now: Date, timezone: string | null): string {
  try {
    return localDateKey(now, timezone ?? "UTC");
  } catch {
    return localDateKey(now, "UTC");
  }
}

/**
 * Queue the daily review of every active profile whose review time has passed, for users
 * who are verified, active, and onboarded with current terms and privacy consent. The job
 * key carries the local date in the user's timezone, so a profile gets one scheduled review
 * per local date. Queueing the job and moving the next review time happen in one
 * transaction, under the profile's row lock: a crash, or a second tick, cannot queue twice.
 */
async function enqueueDueReviews(now: Date, limit: number): Promise<number> {
  if (limit < 1) return 0;
  const db = getDb();
  const candidates = await db
    .select({ profileId: profile.id, userId: profile.userId })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(
      and(
        eq(profile.status, "active"),
        lte(profile.nextReviewAt, now),
        eq(user.emailVerified, true),
        eq(user.status, "active"),
        isNotNull(user.onboardedAt),
        consentCurrent("terms"),
        consentCurrent("privacy"),
      ),
    )
    .orderBy(asc(profile.nextReviewAt))
    .limit(limit);

  let enqueued = 0;
  for (const candidate of candidates) {
    try {
      const created = await db.transaction(async (tx) => {
        // Same lock order as a deletion: the user, then the profile, then the job.
        const [owner] = await tx
          .select({
            emailVerified: user.emailVerified,
            status: user.status,
            onboardedAt: user.onboardedAt,
            timezone: user.timezone,
            reviewHour: user.reviewHour,
          })
          .from(user)
          .where(eq(user.id, candidate.userId))
          .for("key share");
        if (!owner || !owner.emailVerified || owner.status !== "active" || owner.onboardedAt === null) return false;
        const [due] = await tx
          .select({ id: profile.id })
          .from(profile)
          .where(
            and(
              eq(profile.id, candidate.profileId),
              eq(profile.userId, candidate.userId),
              eq(profile.status, "active"),
              lte(profile.nextReviewAt, now),
            ),
          )
          .for("no key update", { skipLocked: true });
        if (!due) return false;
        const queued = await enqueueJob(tx, {
          userId: candidate.userId,
          profileId: candidate.profileId,
          kind: "daily_review",
          dedupeKey: dedupeKey.daily(candidate.profileId, localDate(now, owner.timezone)),
          runAfter: now,
        });
        await tx
          .update(profile)
          .set({ nextReviewAt: reviewTimeFor(now, owner.timezone, owner.reviewHour) })
          .where(and(eq(profile.id, candidate.profileId), eq(profile.userId, candidate.userId)));
        return queued.created;
      });
      if (created) enqueued += 1;
    } catch (error) {
      logError("jobs", error);
    }
  }
  return enqueued;
}

const ACTIVE = ["queued", "running"];

/**
 * Give a derive job to every profile whose derived data is behind its export history and
 * that has no derive job queued or running. This is the net under the queue: whatever race
 * or failure left a profile behind, the next tick picks it up. A revision whose job already
 * finished without catching up gets one further attempt per UTC day.
 */
async function repairDrift(now: Date, limit: number): Promise<number> {
  if (limit < 1) return 0;
  const db = getDb();
  const inFlight = db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.profileId, profile.id), eq(job.kind, "derive_profile"), inArray(job.status, ACTIVE)));
  const drifted = await db
    .select({ profileId: profile.id, userId: profile.userId, revision: profile.contentRevision })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(
      and(
        lt(profile.derivedRevision, profile.contentRevision),
        eq(user.emailVerified, true),
        eq(user.status, "active"),
        notExists(inFlight),
      ),
    )
    .limit(limit);

  let enqueued = 0;
  for (const target of drifted) {
    try {
      const base = { userId: target.userId, profileId: target.profileId, kind: "derive_profile" as const, runAfter: now };
      const key = dedupeKey.derive(target.profileId, target.revision);
      let queued = await enqueueJob(db, { ...base, dedupeKey: key });
      if (!queued.created && !ACTIVE.includes(queued.job.status)) {
        queued = await enqueueJob(db, { ...base, dedupeKey: `${key}:repair:${utcDay(now)}` });
      }
      if (queued.created) enqueued += 1;
    } catch (error) {
      logError("jobs", error);
    }
  }
  return enqueued;
}

async function countReady(now: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(job)
    .where(and(eq(job.status, "queued"), lte(job.runAfter, now)));
  return row?.n ?? 0;
}

/**
 * One run of the batch endpoint. In order: recover expired leases; stop scheduled work when
 * the day's job count has reached the daily capacity; queue due daily reviews and repair
 * drift; drain a bounded batch; clean up what is past its retention window; measure the
 * database; store and return a summary of counts.
 *
 * It processes stored imports and reviews stored evidence. It contacts nothing outside the
 * database. Two ticks may overlap: every step either takes row locks that the other skips
 * or is an idempotent statement.
 */
export async function runTick(options: TickOptions): Promise<TickSummaryDto> {
  const started = performance.now();
  const { now } = options;
  const limits: TickLimits = { ...TICK_LIMITS, ...options.limits };

  const recovered = await recoverExpiredLeases(now);

  const capacity = await readJobCapacity(now);
  let enqueued = 0;
  let drained: DrainSummary = { claimed: 0, succeeded: 0, failed: 0, retried: 0, cancelled: 0 };
  if (!capacity.paused) {
    const room = capacity.limit - capacity.used;
    enqueued += await enqueueDueReviews(now, Math.min(limits.dueBatch, room));
    enqueued += await repairDrift(now, limits.dueBatch);
    drained = await drainJobs({
      now,
      limit: Math.min(limits.tickMaxJobs, room),
      handlers: options.handlers,
      concurrency: limits.tickConcurrency,
      budgetMs: limits.tickBudgetMs,
    });
  }

  // Bookkeeping runs even while scheduled work is paused: it is not a job and it is bounded.
  const cleaned = (await runRetention({ now, batch: limits.retentionBatch })).total;
  try {
    await measureDatabase(now);
    await recordJobCapacity(now);
  } catch (error) {
    logError("jobs", error);
  }

  const summary: TickSummaryDto = {
    at: now.toISOString(),
    recovered: recovered.requeued + recovered.failed,
    enqueued,
    claimed: drained.claimed,
    succeeded: drained.succeeded,
    failed: drained.failed,
    retried: drained.retried,
    cancelled: drained.cancelled,
    remaining: await countReady(now),
    cleaned,
    durationMs: Math.round(performance.now() - started),
    pausedForCapacity: capacity.paused,
  };
  await saveState(LAST_TICK_STATE_KEY, summary, now);
  return summary;
}
