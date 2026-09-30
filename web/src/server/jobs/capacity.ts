import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { type Executor, getDb } from "@/server/db/client";
import { systemState, usageDaily } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";
import {
  DATABASE_SIZE_STATE_KEY,
  type DatabaseSizeState,
  GLOBAL_SCOPE,
  utcDay,
} from "@/server/services/usage";

/** system_state key under which the tick stores the day's job count and whether it paused scheduled work. */
export const JOB_CAPACITY_STATE_KEY = "job_capacity";

/** The value stored under JOB_CAPACITY_STATE_KEY. Counts and a flag only. */
export interface JobCapacityState {
  /** ISO 8601 time of the tick that wrote it. */
  at: string;
  /** The UTC day the count belongs to. */
  day: string;
  used: number;
  limit: number;
  paused: boolean;
}

export interface JobCapacity {
  used: number;
  limit: number;
  paused: boolean;
}

/**
 * Jobs started on the UTC day of `now`. The worker counts a job once, on its first claim,
 * in usage_daily under the global scope.
 */
export async function jobsStartedOn(now: Date, executor: Executor = getDb()): Promise<number> {
  const [row] = await executor
    .select({ jobs: usageDaily.jobs })
    .from(usageDaily)
    .where(and(eq(usageDaily.day, utcDay(now)), eq(usageDaily.scopeKey, GLOBAL_SCOPE)));
  return row?.jobs ?? 0;
}

/** The day's job count against CAPACITY_MAX_JOBS_PER_DAY, read live. */
export async function readJobCapacity(now: Date, executor: Executor = getDb()): Promise<JobCapacity> {
  const limit = getEnv().capacity.maxJobsPerDay;
  const used = await jobsStartedOn(now, executor);
  return { used, limit, paused: used >= limit };
}

/** Throws `capacity_paused` while the day's job capacity is used up. Nothing falls through to a paid tier. */
export async function assertJobCapacity(now: Date, executor: Executor = getDb()): Promise<void> {
  if ((await readJobCapacity(now, executor)).paused) {
    throw new AppError(
      "capacity_paused",
      "Reviews are paused: the service has reached its daily job capacity. They resume on the next UTC day.",
      { capacity: "jobs" },
    );
  }
}

/** Store one operational value. The last writer wins, which is fine for a status record. */
export async function saveState(key: string, value: unknown, now: Date, executor: Executor = getDb()): Promise<void> {
  await executor
    .insert(systemState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

/** Measure the size of the database and store it where the import quota check reads it. */
export async function measureDatabase(now: Date, executor: Executor = getDb()): Promise<DatabaseSizeState> {
  const result = await executor.execute<{ bytes: string }>(
    sql`select pg_database_size(current_database())::text as bytes`,
  );
  const state: DatabaseSizeState = { bytes: Number(result.rows[0]?.bytes ?? 0), measuredAt: now.toISOString() };
  await saveState(DATABASE_SIZE_STATE_KEY, state, now, executor);
  return state;
}

/** Store the day's job count and the pause flag, and return them. */
export async function recordJobCapacity(now: Date, executor: Executor = getDb()): Promise<JobCapacityState> {
  const capacity = await readJobCapacity(now, executor);
  const state: JobCapacityState = { at: now.toISOString(), day: utcDay(now), ...capacity };
  await saveState(JOB_CAPACITY_STATE_KEY, state, now, executor);
  return state;
}
