import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { LIMITS } from "@/domain/limits";
import type { Executor } from "@/server/db/client";
import { job } from "@/server/db/schema";
import type { JobDto, JobKind, JobStatus } from "@/server/services/contracts";

export type JobRow = typeof job.$inferSelect;

/** The job kinds that review stored evidence, as opposed to processing an import. */
export const REVIEW_KINDS: readonly JobKind[] = ["daily_review", "manual_review"];

const ACTIVE: readonly JobStatus[] = ["queued", "running"];

/** Stable keys: one per intent, never per attempt. */
export const dedupeKey = {
  derive: (profileId: string, contentRevision: number) => `derive:${profileId}:${contentRevision}`,
  daily: (profileId: string, localDate: string) => `daily:${profileId}:${localDate}`,
  manual: (profileId: string, requestId: string) => `manual:${profileId}:${requestId}`,
} as const;

export interface EnqueueInput {
  userId: string;
  profileId: string;
  kind: JobKind;
  dedupeKey: string;
  /** Earliest time a worker may claim the job. Defaults to now. */
  runAfter?: Date;
}

export interface EnqueueResult {
  job: JobRow;
  /** False when an existing job already covers this intent. */
  created: boolean;
}

/**
 * Queue a job, or return the job that already covers it. The unique dedupe key and the
 * "one active job per profile and kind" index pick the winner, so two callers racing on
 * the same intent end up with one row. Runs inside the caller's transaction when given one.
 */
export async function enqueueJob(executor: Executor, input: EnqueueInput): Promise<EnqueueResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [created] = await executor
      .insert(job)
      .values({
        userId: input.userId,
        profileId: input.profileId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        maxAttempts: LIMITS.jobMaxAttempts,
        ...(input.runAfter ? { runAfter: input.runAfter } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { job: created, created: true };

    const [sameIntent] = await executor.select().from(job).where(eq(job.dedupeKey, input.dedupeKey)).limit(1);
    if (sameIntent) return { job: sameIntent, created: false };

    const [active] = await executor
      .select()
      .from(job)
      .where(and(eq(job.profileId, input.profileId), eq(job.kind, input.kind), inArray(job.status, [...ACTIVE])))
      .limit(1);
    if (active) return { job: active, created: false };
    // The conflicting job finished between the insert and the lookups: try once more.
  }
  throw new Error("job could not be queued");
}

export interface CancelFilter {
  userId: string;
  profileId: string;
  /** Defaults to every kind. */
  kinds?: readonly JobKind[];
}

/**
 * Cancel queued jobs for one profile of one user. A running job is left alone: its worker
 * re-checks the profile before writing. Returns how many jobs were cancelled.
 */
export async function cancelQueuedJobs(executor: Executor, filter: CancelFilter, reason: string): Promise<number> {
  const conditions = [eq(job.userId, filter.userId), eq(job.profileId, filter.profileId), eq(job.status, "queued")];
  if (filter.kinds) conditions.push(inArray(job.kind, [...filter.kinds]));
  const cancelled = await executor
    .update(job)
    .set({ status: "cancelled", cancelReason: reason, finishedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: job.id });
  return cancelled.length;
}

/** The public shape of a job: status and timing, never lock tokens or results. */
export function toJobDto(row: JobRow): JobDto {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter.toISOString(),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    lastErrorCode: row.lastErrorCode,
  };
}
