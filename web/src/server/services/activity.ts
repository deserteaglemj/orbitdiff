import "server-only";

import { and, desc, eq, like, sql } from "drizzle-orm";

import {
  comparisonExtent,
  NOTHING_COMPARED,
  NOTHING_COMPARED_REASON,
  partlyCompared,
} from "@/components/comparison-copy";
import { formatDate, observedBetween } from "@/components/ui/format";
import { getDb } from "@/server/db/client";
import { activityEntry, profile, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import type { ActivityDto, ActivityKind, ActivityStatus, ComparisonRecord, Page } from "./contracts";
import { requireOwnedProfile } from "./profiles";
import { containsPattern, type PageRequest, pageWindow, searchText, toPage } from "./shared";

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "import_received",
  "import_processed",
  "review",
  "job_failed",
  "profile_added",
  "profile_paused",
  "profile_resumed",
];

export const ACTIVITY_STATUSES: readonly ActivityStatus[] = ["ok", "failed", "info"];

export interface ActivityFilters extends PageRequest {
  profileId?: string | null;
  kind?: ActivityKind | null;
  status?: ActivityStatus | null;
  /** Profile handle substring, case-insensitive. */
  q?: string | null;
}

interface Wording {
  title: string;
  detail: string | null;
}

/** What the wording of one entry may draw on besides its stored summary. */
interface EntryContext {
  handle: string | null;
  timeZone: string;
  /** Earliest and latest capture time among the dated imports stored when the entry was written. */
  firstCapture: Date | null;
  lastCapture: Date | null;
  /** The latest successful result of the profile at or before the entry. */
  lastSuccess: Date | null;
}

type Summary = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** The stored comparison record, or null when the entry has none or it is not the expected shape. */
function comparisonOf(value: unknown): ComparisonRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const sides = (entry: unknown): { added: number; removed: number } | null => {
    if (typeof entry !== "object" || entry === null) return null;
    const added = count((entry as Record<string, unknown>).added);
    const removed = count((entry as Record<string, unknown>).removed);
    return added === null || removed === null ? null : { added, removed };
  };
  const pairs = count(record.pairs);
  const followers = sides(record.followers);
  const following = sides(record.following);
  if (pairs === null || followers === null || following === null) return null;
  return { pairs, followers, following };
}

function day(value: string | Date | null, timeZone: string): string | null {
  if (value === null) return null;
  return formatDate(typeof value === "string" ? value : value.toISOString(), timeZone);
}

function age(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours === 1) return "1 hour ago";
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function importReceived(summary: Summary, context: EntryContext): Wording {
  const captured = day(text(summary.capturedAt), context.timeZone);
  let detail: string;
  if (summary.outcome === "enriched") {
    detail = `A stored export now has the capture time ${captured ?? "you declared"} and is being processed again.`;
  } else if (summary.outcome === "declarations_updated") {
    detail = "The completeness declaration of a stored export was updated and is being processed again.";
  } else if (summary.first === true) {
    detail = "Your first import was stored as the baseline and is being processed.";
  } else if (captured) {
    detail = `An export captured on ${captured} was stored and is being processed.`;
  } else {
    detail = "An export with no capture time was stored and is being processed.";
  }
  return { title: "Import received", detail };
}

/**
 * The first import is a baseline: it has nothing to be compared with, so it
 * never reads as changes. Later differences are differences between two
 * export files and are called export observations.
 */
function importProcessed(summary: Summary, context: EntryContext): Wording {
  const dated = count(summary.datedSnapshotCount);
  if (dated === 0) {
    return {
      title: "Import processed",
      detail: "No import has a capture time yet, so nothing can be compared. Import an export with its capture time.",
    };
  }
  if (summary.baselineOnly === true || dated === 1) {
    return {
      title: "Baseline stored",
      detail: "A baseline was stored. Nothing can be compared yet: differences appear after a second dated import.",
    };
  }
  const events = count(summary.eventCount) ?? 0;
  const dates =
    context.firstCapture && context.lastCapture
      ? { first: context.firstCapture.toISOString(), last: context.lastCapture.toISOString() }
      : null;
  const between = dates
    ? observedBetween(dates.first, dates.last, context.timeZone)
    : "observed in your export between your dated imports";
  if (events === 0) {
    const span = dates
      ? `between ${day(dates.first, context.timeZone)} and ${day(dates.last, context.timeZone)}`
      : "between your dated imports";
    // No observation is "no difference" only where a comparison could run.
    const comparison = comparisonOf(summary.comparison);
    if (comparison === null) {
      return { title: "No export observations", detail: `No export observation was recorded ${span}.` };
    }
    const extent = comparisonExtent(comparison);
    if (extent === "none") {
      return { title: NOTHING_COMPARED, detail: `${NOTHING_COMPARED} ${span}. ${NOTHING_COMPARED_REASON}` };
    }
    return {
      title: "No differences observed",
      detail: `No differences were ${between}${extent === "partial" ? partlyCompared(comparison) : "."}`,
    };
  }
  const noun = events === 1 ? "difference was" : "differences were";
  return {
    title: `${events} export ${events === 1 ? "observation" : "observations"}`,
    detail: `${events} ${noun} ${between}. These are export observations, not live follows or unfollows.`,
  };
}

function review(summary: Summary, context: EntryContext): Wording {
  const title = summary.trigger === "manual" ? "Manual review" : "Daily review";
  if (summary.evidence === "missing") {
    return { title, detail: "No export has been imported yet, so there is nothing to review." };
  }
  const hours = count(summary.ageHours);
  const captured = day(text(summary.capturedAt), context.timeZone);
  if (hours === null || captured === null) {
    return { title, detail: "The current export has no capture time, so its age is unknown." };
  }
  const parts = [`The current export was captured ${age(hours)}, on ${captured}.`];
  if (summary.evidence === "stale") parts.push("It is stale: import a newer export to refresh it.");
  else if (summary.evidence === "degraded") parts.push("Its coverage is incomplete, so some relationships stay unknown.");
  else parts.push("It is current.");
  const followers = count(summary.followers);
  const following = count(summary.following);
  if (followers !== null) parts.push(`Followers: ${followers}.`);
  if (following !== null) parts.push(`Following: ${following}.`);
  return { title, detail: parts.join(" ") };
}

/** A failure is its own entry. It never replaces, hides, or rewords the last successful result. */
function jobFailed(summary: Summary, context: EntryContext): Wording {
  const wasReview = summary.jobKind === "daily_review" || summary.jobKind === "manual_review";
  const what = wasReview ? "The review failed." : "Processing failed.";
  const last = day(context.lastSuccess, context.timeZone);
  return {
    title: wasReview ? "Review failed" : "Processing failed",
    detail: last
      ? `${what} The last successful result is unchanged; it is from ${last}.`
      : `${what} Nothing was changed, and there is no earlier successful result.`,
  };
}

function wordingOf(kind: ActivityKind, summary: Summary, context: EntryContext): Wording {
  const handle = context.handle ?? text(summary.handle) ?? "The profile";
  switch (kind) {
    case "import_received":
      return importReceived(summary, context);
    case "import_processed":
      return importProcessed(summary, context);
    case "review":
      return review(summary, context);
    case "job_failed":
      return jobFailed(summary, context);
    case "profile_added":
      return { title: "Profile added", detail: `${handle} was added. Import an export to store a baseline.` };
    case "profile_paused":
      return {
        title: "Profile paused",
        detail: `Scheduled reviews are paused for ${handle}. Stored imports are unchanged.`,
      };
    case "profile_resumed":
      return { title: "Profile resumed", detail: `Scheduled reviews run again for ${handle}.` };
  }
}

/**
 * The activity feed of the user, newest first, already worded for the
 * interface. Wording follows docs/web/capability-matrix.md: a baseline is a
 * baseline, a difference is an export observation between two capture dates,
 * and a failure stands next to the last success.
 */
export async function listActivity(userId: string, filters: ActivityFilters = {}): Promise<Page<ActivityDto>> {
  const db = getDb();
  const window = pageWindow(filters);
  const q = searchText(filters.q);
  const kind = filters.kind ?? null;
  if (kind !== null && !ACTIVITY_KINDS.includes(kind)) {
    throw new AppError("invalid_input", "kind is not a known value.", { fields: ["kind"] });
  }
  const status = filters.status ?? null;
  if (status !== null && !ACTIVITY_STATUSES.includes(status)) {
    throw new AppError("invalid_input", "status is not a known value.", { fields: ["status"] });
  }
  const conditions = [eq(activityEntry.userId, userId)];
  if (filters.profileId !== undefined && filters.profileId !== null) {
    const owned = await requireOwnedProfile(userId, filters.profileId, db);
    conditions.push(eq(activityEntry.profileId, owned.id));
  }
  if (kind !== null) conditions.push(eq(activityEntry.kind, kind));
  if (status !== null) conditions.push(eq(activityEntry.status, status));
  if (q !== null) conditions.push(like(profile.handle, containsPattern(q)));
  const where = and(...conditions);
  const ownedProfile = and(eq(profile.id, activityEntry.profileId), eq(profile.userId, userId));

  const [owner] = await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId));
  const timeZone = owner?.timezone ?? "UTC";

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityEntry)
    .leftJoin(profile, ownedProfile)
    .where(where);

  // Correlated lookups, each bounded to the entry's own user and profile.
  const captureBound = (edge: "min" | "max") =>
    sql<Date | null>`case when ${activityEntry.kind} = 'import_processed' then (
      select ${sql.raw(edge)}(s.captured_at) from export_snapshot s
      where s.user_id = ${activityEntry.userId} and s.profile_id = ${activityEntry.profileId}
        and s.captured_at is not null and s.imported_at <= ${activityEntry.occurredAt}) end`.mapWith(
      activityEntry.occurredAt,
    );
  const lastSuccess = sql<Date | null>`case when ${activityEntry.kind} = 'job_failed' then (
      select max(a.occurred_at) from activity_entry a
      where a.user_id = ${activityEntry.userId} and a.profile_id = ${activityEntry.profileId}
        and a.status = 'ok' and a.kind in ('import_processed', 'review')
        and a.occurred_at <= ${activityEntry.occurredAt}) end`.mapWith(activityEntry.occurredAt);

  const rows = await db
    .select({
      id: activityEntry.id,
      profileId: activityEntry.profileId,
      handle: profile.handle,
      kind: activityEntry.kind,
      status: activityEntry.status,
      summary: activityEntry.summary,
      occurredAt: activityEntry.occurredAt,
      firstCapture: captureBound("min"),
      lastCapture: captureBound("max"),
      lastSuccess,
    })
    .from(activityEntry)
    .leftJoin(profile, ownedProfile)
    .where(where)
    .orderBy(desc(activityEntry.occurredAt), desc(activityEntry.id))
    .limit(window.pageSize)
    .offset(window.offset);

  const data = rows.map((row): ActivityDto => {
    const summary = (typeof row.summary === "object" && row.summary !== null ? row.summary : {}) as Summary;
    const wording = wordingOf(row.kind as ActivityKind, summary, {
      handle: row.handle,
      timeZone,
      firstCapture: row.firstCapture,
      lastCapture: row.lastCapture,
      lastSuccess: row.lastSuccess,
    });
    return {
      id: row.id,
      profileId: row.profileId,
      profileHandle: row.handle,
      kind: row.kind as ActivityKind,
      status: row.status as ActivityStatus,
      occurredAt: row.occurredAt.toISOString(),
      title: wording.title,
      detail: wording.detail,
    };
  });
  return toPage(data, window, total?.n ?? 0);
}
