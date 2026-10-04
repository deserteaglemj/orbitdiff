import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { type Executor, getDb } from "@/server/db/client";
import { systemState, usageDaily } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";
import type { ScheduleStateDto } from "@/server/services/contracts";
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

export interface JobStartGrant {
  /** How many of the wanted first-time starts fit in what was left of the day. They are counted. */
  granted: number;
  /** True when the day's count had already reached the capacity: nothing may start. */
  exhausted: boolean;
}

/**
 * Count first-time job starts against CAPACITY_MAX_JOBS_PER_DAY, where the count is written.
 *
 * The day's row is locked before it is read (created at zero when the day has none), so two
 * claims can never both spend the same room: the second waits, then sees what the first
 * counted. Up to `wanted` starts are granted and added in the same transaction. Call it
 * inside the transaction that claims the jobs, so a claim that rolls back counts nothing.
 */
export async function reserveJobStarts(tx: Executor, now: Date, wanted: number): Promise<JobStartGrant> {
  const limit = getEnv().capacity.maxJobsPerDay;
  const day = utcDay(now);
  const [locked] = await tx
    .insert(usageDaily)
    .values({ day, scopeKey: GLOBAL_SCOPE, jobs: 0 })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.scopeKey],
      // Writes the value it already has: the point is the row lock, held until commit.
      set: { jobs: sql`${usageDaily.jobs}` },
    })
    .returning({ jobs: usageDaily.jobs });
  const used = locked?.jobs ?? 0;
  const room = limit - used;
  if (room <= 0) return { granted: 0, exhausted: true };
  const granted = Math.max(0, Math.min(Math.floor(wanted), room));
  if (granted > 0) {
    await tx
      .update(usageDaily)
      .set({ jobs: sql`${usageDaily.jobs} + ${granted}` })
      .where(and(eq(usageDaily.day, day), eq(usageDaily.scopeKey, GLOBAL_SCOPE)));
  }
  return { granted, exhausted: false };
}

const DAY_MS = 86_400_000;

/**
 * Whether scheduled work runs at `now`, for the signed-in pages: paused while
 * the day's job count has reached CAPACITY_MAX_JOBS_PER_DAY, until the next UTC
 * midnight, when the count starts again. Holds no account data.
 */
export async function readScheduleState(now: Date, executor: Executor = getDb()): Promise<ScheduleStateDto> {
  const capacity = await readJobCapacity(now, executor);
  if (!capacity.paused) return { paused: false, resumesAt: null };
  const nextDay = new Date((Math.floor(now.getTime() / DAY_MS) + 1) * DAY_MS);
  return { paused: true, resumesAt: nextDay.toISOString() };
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
