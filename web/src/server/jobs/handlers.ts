import "server-only";

import { and, eq } from "drizzle-orm";

import { captureTimeMillis, formatCaptureTime } from "@/domain/capture-time";
import {
  buildView,
  type Coverage,
  deriveEvents,
  type ExportEvent,
  type IdentifiedSnapshot,
} from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";
import type { Executor } from "@/server/db/client";
import { activityEntry, changeEvent, exportSnapshot, profile } from "@/server/db/schema";
import type {
  CoverageDto,
  ImportProcessedRecord,
  ProfileSummaryRecord,
  ReviewRecord,
} from "@/server/services/contracts";

import { dedupeKey, enqueueJob } from "./queue";
import type { JobContext, JobHandlers, JobResult } from "./worker";

type SnapshotRow = typeof exportSnapshot.$inferSelect;

/** Rows per insert statement when the derived observations are written. */
const EVENT_CHUNK = 1_000;

/** A stored snapshot as the domain rules see it. */
function toSnapshot(row: SnapshotRow): IdentifiedSnapshot {
  return {
    followers: row.followers,
    following: row.following,
    shards: { followers: row.followersShards, following: row.followingShards },
    capturedAt: row.capturedAt === null ? null : formatCaptureTime(row.capturedAt),
    declarations: { followers: row.declaredCompleteFollowers, following: row.declaredCompleteFollowing },
    contentDigest: row.contentDigest,
    snapshotDigest: row.snapshotDigest,
  };
}

function toCoverageDto(value: Coverage): CoverageDto {
  return {
    present: value.present,
    complete: value.complete,
    declaredComplete: value.declaredComplete,
    shards: value.shards,
    shardsContiguous: value.shardsContiguous,
    capturedAtKnown: value.capturedAtKnown,
    independentlyVerified: false,
  };
}

function summarize(current: SnapshotRow, events: number, baselineOnly: boolean, now: Date): ProfileSummaryRecord {
  const view = buildView(toSnapshot(current), now);
  return {
    snapshotId: current.id,
    capturedAt: current.capturedAt === null ? null : current.capturedAt.toISOString(),
    coverage: { followers: toCoverageDto(view.coverage.followers), following: toCoverageDto(view.coverage.following) },
    coverageLabel: view.coverageLabel,
    metrics: view.metrics,
    issues: view.issues,
    eventCount: events,
    baselineOnly,
  };
}

function processedRecord(rows: readonly SnapshotRow[], dated: number, events: readonly ExportEvent[]): ImportProcessedRecord {
  const record: ImportProcessedRecord = {
    snapshotCount: rows.length,
    datedSnapshotCount: dated,
    baselineOnly: dated < 2,
    eventCount: events.length,
    added: { followers: 0, following: 0 },
    removed: { followers: 0, following: 0 },
  };
  for (const event of events) {
    const bucket = event.type.endsWith("_added") ? record.added : record.removed;
    bucket[event.direction] += 1;
  }
  return record;
}

/**
 * Re-derive a profile from its whole dated history: the export observations between
 * consecutive dated snapshots and the summary of the current snapshot. Both replace what
 * was stored. The differences are observations of two export files over the interval
 * between their capture times; nothing here is a live follow or unfollow, and a removal
 * appears only when the later export's direction is complete (the domain rule decides).
 *
 * The profile row is locked by the worker, so the revision read from it matches the
 * snapshots read here. Deriving a revision that is already derived writes nothing.
 */
export async function deriveProfile(tx: Executor, context: JobContext): Promise<JobResult> {
  const { job: claim, now } = context;
  const revision = context.profile.contentRevision;
  if (context.profile.derivedRevision === revision) return { skipped: "already_derived" };
  const owned = and(eq(exportSnapshot.profileId, claim.profileId), eq(exportSnapshot.userId, claim.userId));
  const rows = await tx.select().from(exportSnapshot).where(owned);
  const dated = rows.filter((row) => row.capturedAt !== null).length;
  const events = await deriveEvents(rows.map(toSnapshot), LIMITS.eventsPerProfile);

  await tx
    .delete(changeEvent)
    .where(and(eq(changeEvent.profileId, claim.profileId), eq(changeEvent.userId, claim.userId)));
  for (let start = 0; start < events.length; start += EVENT_CHUNK) {
    await tx.insert(changeEvent).values(
      events.slice(start, start + EVENT_CHUNK).map((event, offset) => ({
        userId: claim.userId,
        profileId: claim.profileId,
        eventType: event.type,
        direction: event.direction,
        username: event.username,
        intervalStart: new Date(captureTimeMillis(event.intervalStart)),
        intervalEnd: new Date(captureTimeMillis(event.intervalEnd)),
        eventDigest: event.digest,
        position: start + offset,
        createdAt: now,
      })),
    );
  }

  const current = rows.find((row) => row.isCurrent);
  const [updated] = await tx
    .update(profile)
    .set({
      summary: current ? summarize(current, events.length, dated < 2, now) : null,
      derivedRevision: revision,
      lastSuccessAt: now,
      updatedAt: now,
    })
    .where(and(eq(profile.id, claim.profileId), eq(profile.userId, claim.userId)))
    .returning({ contentRevision: profile.contentRevision });
  if (updated && updated.contentRevision > revision) {
    // An import moved the history while this job held the queue slot and was handed this
    // job instead of a new one. Derived data stays behind on purpose; the follow-up catches up.
    await enqueueJob(tx, {
      userId: claim.userId,
      profileId: claim.profileId,
      kind: "derive_profile",
      dedupeKey: dedupeKey.derive(claim.profileId, updated.contentRevision),
      runAfter: now,
    });
  }

  const record = processedRecord(rows, dated, events);
  await tx
    .insert(activityEntry)
    .values({
      userId: claim.userId,
      profileId: claim.profileId,
      jobId: claim.id,
      kind: "import_processed",
      status: "ok",
      summary: record,
      occurredAt: now,
    })
    .onConflictDoNothing();
  return { ...record };
}

const HOUR_MS = 3_600_000;

/** What the stored evidence of a profile looks like at one moment. Reads only; contacts nothing. */
export async function reviewEvidence(
  tx: Executor,
  userId: string,
  profileId: string,
  now: Date,
): Promise<Omit<ReviewRecord, "trigger">> {
  const [current] = await tx
    .select()
    .from(exportSnapshot)
    .where(and(eq(exportSnapshot.profileId, profileId), eq(exportSnapshot.userId, userId), eq(exportSnapshot.isCurrent, true)))
    .limit(1);
  if (!current) {
    return { evidence: "missing", capturedAt: null, ageHours: null, followers: null, following: null };
  }
  const view = buildView(toSnapshot(current), now);
  const captured = current.capturedAt;
  return {
    evidence: view.status,
    capturedAt: captured === null ? null : captured.toISOString(),
    ageHours: captured === null ? null : Math.max(0, Math.floor((now.getTime() - captured.getTime()) / HOUR_MS)),
    // Counts exist only for a direction whose coverage is complete; otherwise they stay unknown.
    followers: view.metrics.followers,
    following: view.metrics.following,
  };
}

/**
 * A daily or manual review: look at the current stored export at the job's time and record
 * how fresh and how complete it is. It changes no derived data. For a daily review the tick
 * already moved the next review time when it queued the job.
 */
export async function reviewProfile(tx: Executor, context: JobContext): Promise<JobResult> {
  const { job: claim, now } = context;
  const record: ReviewRecord = {
    trigger: claim.kind === "manual_review" ? "manual" : "daily",
    ...(await reviewEvidence(tx, claim.userId, claim.profileId, now)),
  };
  await tx
    .insert(activityEntry)
    .values({
      userId: claim.userId,
      profileId: claim.profileId,
      jobId: claim.id,
      kind: "review",
      status: "ok",
      summary: record,
      occurredAt: now,
    })
    .onConflictDoNothing();
  await tx
    .update(profile)
    .set({ lastReviewAt: now, lastSuccessAt: now, updatedAt: now })
    .where(and(eq(profile.id, claim.profileId), eq(profile.userId, claim.userId)));
  return { ...record };
}

/** The handler for each job kind. */
export const JOB_HANDLERS: JobHandlers = {
  derive_profile: deriveProfile,
  daily_review: reviewProfile,
  manual_review: reviewProfile,
};
