import "server-only";

import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";

import { isAdminEmail } from "@/server/auth/guards";
import { countUsers, getRegistrationState } from "@/server/auth/registration";
import { getDb } from "@/server/db/client";
import { activityEntry, exportSnapshot, job, profile, systemState, usageDaily, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { LAST_TICK_STATE_KEY } from "@/server/http/health";
import { mailDelivery } from "@/server/mail/transport";

import { consentSatisfied, getConsentState } from "./consent";
import type { AdminUserDto, CapacityDto, Page, TickSummaryDto } from "./contracts";
import { containsPattern, notFound, type PageRequest, pageWindow, searchText, toPage } from "./shared";
import { databasePaused, GLOBAL_SCOPE, readDatabaseSize, userScope, utcDay } from "./usage";

/**
 * The operator's view: accounts with their usage, and global capacity. It
 * shows that an account exists and how much it stores, never what it stores:
 * no handle, no roster, no export observation, and no credential of any kind
 * is selected here.
 *
 * Both functions take the caller's user id first and check it themselves, on
 * top of requireAdmin in the route, so reaching them by another path still
 * answers `not_found` to anyone who is not a verified, active address in
 * ADMIN_EMAILS.
 */
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

async function assertAdmin(adminUserId: string): Promise<void> {
  const [row] = await getDb()
    .select({ email: user.email, emailVerified: user.emailVerified, status: user.status })
    .from(user)
    .where(eq(user.id, adminUserId));
  if (!row || row.emailVerified !== true || row.status !== "active" || !isAdminEmail(row.email)) throw notFound();
}

export interface UserFilters extends PageRequest {
  /** Email or name substring, case-insensitive. */
  q?: string | null;
}

export async function listUsers(
  adminUserId: string,
  filters: UserFilters = {},
  now: Date = new Date(),
): Promise<Page<AdminUserDto>> {
  await assertAdmin(adminUserId);
  const db = getDb();
  const window = pageWindow(filters);
  const q = searchText(filters.q);
  const where =
    q === null
      ? undefined
      : or(like(sql`lower(${user.email})`, containsPattern(q)), like(sql`lower(${user.name})`, containsPattern(q)));

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(user)
    .where(where);
  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      emailVerified: user.emailVerified,
      status: user.status,
      onboardedAt: user.onboardedAt,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), desc(user.id))
    .limit(window.pageSize)
    .offset(window.offset);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return toPage([], window, total?.n ?? 0);

  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const profiles = await db
    .select({ userId: profile.userId, n: sql<number>`count(*)::int` })
    .from(profile)
    .where(inArray(profile.userId, ids))
    .groupBy(profile.userId);
  const snapshots = await db
    .select({
      userId: exportSnapshot.userId,
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${exportSnapshot.rosterBytes}), 0)::int`,
    })
    .from(exportSnapshot)
    .where(inArray(exportSnapshot.userId, ids))
    .groupBy(exportSnapshot.userId);
  const imports = await db
    .select({ scopeKey: usageDaily.scopeKey, n: sql<number>`coalesce(sum(${usageDaily.imports}), 0)::int` })
    .from(usageDaily)
    .where(
      and(
        inArray(
          usageDaily.scopeKey,
          ids.map((id) => userScope(id)),
        ),
        gte(usageDaily.day, utcDay(since)),
      ),
    )
    .groupBy(usageDaily.scopeKey);
  const jobs = await db
    .select({ userId: job.userId, n: sql<number>`count(*)::int` })
    .from(job)
    .where(and(inArray(job.userId, ids), gte(job.createdAt, since)))
    .groupBy(job.userId);
  const activity = await db
    .select({
      userId: activityEntry.userId,
      last: sql<Date | null>`max(${activityEntry.occurredAt})`.mapWith(activityEntry.occurredAt),
    })
    .from(activityEntry)
    .where(inArray(activityEntry.userId, ids))
    .groupBy(activityEntry.userId);

  const profilesBy = new Map(profiles.map((row) => [row.userId, row.n]));
  const snapshotsBy = new Map(snapshots.map((row) => [row.userId, row]));
  const importsBy = new Map(imports.map((row) => [row.scopeKey, row.n]));
  const jobsBy = new Map(jobs.map((row) => [row.userId, row.n]));
  const activityBy = new Map(activity.map((row) => [row.userId, row.last]));

  const data: AdminUserDto[] = [];
  for (const row of rows) {
    const consent = await getConsentState(row.id, db);
    data.push({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      emailVerified: row.emailVerified === true,
      status: row.status === "active" ? "active" : "suspended",
      onboarded: row.onboardedAt !== null && consentSatisfied(consent),
      consent,
      usage: {
        profiles: profilesBy.get(row.id) ?? 0,
        snapshots: snapshotsBy.get(row.id)?.n ?? 0,
        rosterBytes: snapshotsBy.get(row.id)?.bytes ?? 0,
        importsLast30Days: importsBy.get(userScope(row.id)) ?? 0,
        jobsLast30Days: jobsBy.get(row.id) ?? 0,
        lastActivityAt: activityBy.get(row.id)?.toISOString() ?? null,
      },
    });
  }
  return toPage(data, window, total?.n ?? 0);
}

const TICK_COUNTERS = [
  "recovered",
  "enqueued",
  "claimed",
  "succeeded",
  "failed",
  "retried",
  "cancelled",
  "remaining",
  "cleaned",
  "durationMs",
] as const;

/** The stored summary of the last tick, or null when there is none or it has no time. Counts only. */
function readTick(value: unknown): TickSummaryDto | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "string") return null;
  const counters = Object.fromEntries(
    TICK_COUNTERS.map((name) => [name, typeof record[name] === "number" ? record[name] : 0]),
  ) as Record<(typeof TICK_COUNTERS)[number], number>;
  return { at: record.at, ...counters, pausedForCapacity: record.pausedForCapacity === true };
}

/** Global capacity against the configured limits, and what each reached limit pauses. */
export async function getCapacity(adminUserId: string, now: Date = new Date()): Promise<CapacityDto> {
  await assertAdmin(adminUserId);
  const db = getDb();
  const env = getEnv();
  const users = await countUsers(db);
  const [jobsToday] = await db
    .select({ jobs: usageDaily.jobs })
    .from(usageDaily)
    .where(and(eq(usageDaily.day, utcDay(now)), eq(usageDaily.scopeKey, GLOBAL_SCOPE)));
  const size = await readDatabaseSize(db);
  const [tick] = await db.select({ value: systemState.value }).from(systemState).where(eq(systemState.key, LAST_TICK_STATE_KEY));
  const registration = await getRegistrationState(env, db);
  const mail = mailDelivery(env);
  const jobsUsed = jobsToday?.jobs ?? 0;
  return {
    users: { used: users, limit: env.capacity.maxUsers, paused: users >= env.capacity.maxUsers },
    jobsToday: { used: jobsUsed, limit: env.capacity.maxJobsPerDay, paused: jobsUsed >= env.capacity.maxJobsPerDay },
    database: {
      bytes: size.bytes,
      limit: env.capacity.maxDatabaseBytes,
      paused: databasePaused(size, env.capacity.maxDatabaseBytes),
      measuredAt: size.measuredAt,
    },
    lastTick: readTick(tick?.value),
    mail: { available: mail.available, mode: mail.mode },
    registration: { open: registration.open, reason: registration.reason },
  };
}
