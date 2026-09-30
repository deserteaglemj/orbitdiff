import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, max } from "drizzle-orm";

import { LIMITS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { job, profile, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import type { JobDto } from "@/server/services/contracts";
import { notFound, requireUuid } from "@/server/services/shared";
import { bumpUsage, profileScope, utcDay } from "@/server/services/usage";

import { assertJobCapacity } from "./capacity";
import { dedupeKey, enqueueJob, REVIEW_KINDS, toJobDto } from "./queue";

/** First instant of the next UTC day, when the daily counters start again. */
function nextUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/**
 * Queue a manual review of one of the user's own profiles. The review itself runs later,
 * in the tick: nothing is executed here.
 *
 * A profile id that does not exist, belongs to someone else, or is malformed is
 * `not_found`. A paused profile is `conflict`. The cooldown since the last review job of
 * the profile and the per-day limit are enforced under the profile's row lock, so two
 * requests at once cannot both get through. A repeat inside the cooldown queues nothing,
 * so the request is safe to retry.
 */
export async function requestManualReview(userId: string, profileId: string, now: Date = new Date()): Promise<JobDto> {
  const id = requireUuid(profileId);
  return getDb().transaction(async (tx) => {
    // Same lock order as the worker and as a deletion: the user, then the profile, then the job.
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("key share");
    if (!owner) throw notFound();
    const [target] = await tx
      .select()
      .from(profile)
      .where(and(eq(profile.userId, userId), eq(profile.id, id)))
      .for("no key update");
    if (!target) throw notFound();
    if (target.status !== "active") {
      throw new AppError("conflict", "This profile is paused. Resume it to run a review.", { paused: true });
    }
    await assertJobCapacity(now, tx);

    const [last] = await tx
      .select({ at: max(job.createdAt) })
      .from(job)
      .where(and(eq(job.userId, userId), eq(job.profileId, id), inArray(job.kind, [...REVIEW_KINDS])));
    const lastReview = Math.max(last?.at?.getTime() ?? 0, target.lastReviewAt?.getTime() ?? 0);
    const wait = lastReview + LIMITS.reviewCooldownMs - now.getTime();
    if (lastReview > 0 && wait > 0) {
      throw new AppError("cooldown", "This profile was reviewed a moment ago. Try again after the cooldown.", {
        retryAfterSeconds: Math.ceil(wait / 1000),
      });
    }

    const queued = await enqueueJob(tx, {
      userId,
      profileId: id,
      kind: "manual_review",
      dedupeKey: dedupeKey.manual(id, randomUUID()),
      runAfter: now,
    });
    // A review that was already waiting is handed back as is and costs nothing.
    if (queued.created) {
      const limit = LIMITS.manualReviewsPerProfilePerDay;
      const used = await bumpUsage(tx, profileScope(id), utcDay(now), "manualReviews", limit);
      if (used === null) {
        throw new AppError(
          "quota_exhausted",
          `This profile has used all ${limit} manual reviews for today. Manual reviews are paused until the next UTC day.`,
          { quota: "manual_reviews_per_day", limit, resetsAt: nextUtcDay(now) },
        );
      }
    }
    return toJobDto(queued.job);
  });
}
