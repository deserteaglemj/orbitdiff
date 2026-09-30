import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { LIMITS } from "@/domain/limits";
import { getDb, type Executor } from "@/server/db/client";
import { exportSnapshot, profile, systemState, usageDaily } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/http/errors";

import type { MeDto } from "./contracts";

/**
 * Quota counters and checks. Every limit is in `LIMITS`; nothing here falls
 * through to a paid tier: a reached limit is `quota_exhausted` or
 * `capacity_paused` and the caller shows why.
 *
 * Scope keys are exactly `global`, `user:<id>`, and `profile:<id>`. Account
 * deletion removes the last two by those shapes.
 */
export const GLOBAL_SCOPE = "global";
export const userScope = (userId: string): string => `user:${userId}`;
export const profileScope = (profileId: string): string => `profile:${profileId}`;

export type UsageCounter = "imports" | "manualReviews" | "jobs";

/** The UTC calendar date of an instant, the key of a usage day. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** First instant of the next UTC day, when the daily counters start again. */
function nextUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/**
 * Add one to a daily counter in a single statement and return the new value.
 * With `limit`, the statement itself refuses to pass it and `null` is
 * returned, so two callers racing at the limit cannot both get through.
 */
export async function bumpUsage(
  executor: Executor,
  scopeKey: string,
  day: string,
  counter: UsageCounter,
  limit?: number,
): Promise<number | null> {
  if (limit !== undefined && limit < 1) return null;
  const column = usageDaily[counter];
  const [row] = await executor
    .insert(usageDaily)
    .values({ day, scopeKey, [counter]: 1 })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.scopeKey],
      set: { [counter]: sql`${column} + 1` },
      ...(limit === undefined ? {} : { setWhere: sql`${column} < ${limit}` }),
    })
    .returning({ value: column });
  return row ? row.value : null;
}

/** Imports the user has used on the UTC day of `now`. */
export async function importsToday(userId: string, now: Date, executor: Executor = getDb()): Promise<number> {
  const [row] = await executor
    .select({ imports: usageDaily.imports })
    .from(usageDaily)
    .where(and(eq(usageDaily.day, utcDay(now)), eq(usageDaily.scopeKey, userScope(userId))));
  return row?.imports ?? 0;
}

function importQuotaError(now: Date): AppError {
  return new AppError(
    "quota_exhausted",
    `You have used all ${LIMITS.importsPerUserPerDay} imports for today. Imports are paused until the next UTC day.`,
    { quota: "imports_per_day", limit: LIMITS.importsPerUserPerDay, resetsAt: nextUtcDay(now) },
  );
}

/** Throws `quota_exhausted` when the user has no import left today. Reads only. */
export async function assertImportQuota(userId: string, now: Date, executor: Executor = getDb()): Promise<void> {
  if ((await importsToday(userId, now, executor)) >= LIMITS.importsPerUserPerDay) throw importQuotaError(now);
}

/** Count one import against today's quota, or throw `quota_exhausted` when none is left. */
export async function countImport(userId: string, now: Date, executor: Executor = getDb()): Promise<number> {
  const value = await bumpUsage(executor, userScope(userId), utcDay(now), "imports", LIMITS.importsPerUserPerDay);
  if (value === null) throw importQuotaError(now);
  return value;
}

/** Sum of the stored roster bytes of one user. */
export async function storedRosterBytes(userId: string, executor: Executor = getDb()): Promise<number> {
  const [row] = await executor
    .select({ bytes: sql<number>`coalesce(sum(${exportSnapshot.rosterBytes}), 0)::int` })
    .from(exportSnapshot)
    .where(eq(exportSnapshot.userId, userId));
  return row?.bytes ?? 0;
}

/** Throws `quota_exhausted` when `incomingBytes` more roster bytes would pass the per-user limit. */
export async function assertRosterRoom(
  userId: string,
  incomingBytes: number,
  executor: Executor = getDb(),
): Promise<void> {
  const stored = await storedRosterBytes(userId, executor);
  if (stored + incomingBytes > LIMITS.rosterBytesPerUser) {
    throw new AppError(
      "quota_exhausted",
      "Your stored imports have reached the storage limit. Remove a profile to make room.",
      { quota: "roster_bytes", limit: LIMITS.rosterBytesPerUser, used: stored },
    );
  }
}

/** system_state key under which the batch endpoint stores the measured database size. */
export const DATABASE_SIZE_STATE_KEY = "database_size";

/** The value stored under DATABASE_SIZE_STATE_KEY. */
export interface DatabaseSizeState {
  bytes: number;
  /** ISO 8601 time of the measurement. */
  measuredAt: string;
}

export interface DatabaseSize {
  bytes: number | null;
  measuredAt: string | null;
}

/** The last measured database size. A missing or malformed measurement is reported as unknown. */
export async function readDatabaseSize(executor: Executor = getDb()): Promise<DatabaseSize> {
  const [row] = await executor
    .select({ value: systemState.value, updatedAt: systemState.updatedAt })
    .from(systemState)
    .where(eq(systemState.key, DATABASE_SIZE_STATE_KEY));
  const value = row?.value as Partial<DatabaseSizeState> | null | undefined;
  if (!row || !value || typeof value.bytes !== "number" || !Number.isFinite(value.bytes) || value.bytes < 0) {
    return { bytes: null, measuredAt: null };
  }
  return {
    bytes: value.bytes,
    measuredAt: typeof value.measuredAt === "string" ? value.measuredAt : row.updatedAt.toISOString(),
  };
}

/** True when the measured database size has reached CAPACITY_MAX_DB_BYTES. Unknown size is not paused. */
export function databasePaused(size: DatabaseSize, limit: number = getEnv().capacity.maxDatabaseBytes): boolean {
  return size.bytes !== null && size.bytes >= limit;
}

/** Throws `capacity_paused` while the shared database is at its configured size limit. */
export async function assertDatabaseCapacity(executor: Executor = getDb()): Promise<void> {
  if (databasePaused(await readDatabaseSize(executor))) {
    throw new AppError(
      "capacity_paused",
      "Imports are paused: the service has reached its storage capacity. Existing data is unchanged.",
      { capacity: "database" },
    );
  }
}

/** The usage block of the signed-in user's own profile. */
export async function getUserUsage(userId: string, now: Date, executor: Executor = getDb()): Promise<MeDto["usage"]> {
  const [profiles] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(profile)
    .where(eq(profile.userId, userId));
  return {
    profiles: profiles?.n ?? 0,
    profilesLimit: LIMITS.profilesPerUser,
    importsToday: await importsToday(userId, now, executor),
    importsPerDayLimit: LIMITS.importsPerUserPerDay,
    rosterBytes: await storedRosterBytes(userId, executor),
    rosterBytesLimit: LIMITS.rosterBytesPerUser,
  };
}
