import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { countHistory } from "@/domain/counts";
import { getDb } from "@/server/db/client";
import { exportSnapshot } from "@/server/db/schema";

import type { CountHistoryDto } from "./contracts";
import { requireOwnedProfile } from "./profiles";
import { rosterOfSize, toDomainSnapshot } from "./snapshot-rows";

/**
 * Count history of a profile: one point per dated snapshot that has a
 * direction with effective complete coverage, oldest first, and the wording
 * of the latest change ("Net growth of 3").
 *
 * A count change is a count change. This function selects the stored list
 * lengths, never the lists, so it has no username to return: nothing here can
 * turn a difference of three into three accounts.
 */
export async function getCountHistory(userId: string, profileId: string): Promise<CountHistoryDto> {
  const db = getDb();
  const owned = await requireOwnedProfile(userId, profileId, db);
  const rows = await db
    .select({
      id: exportSnapshot.id,
      snapshotDigest: exportSnapshot.snapshotDigest,
      capturedAt: exportSnapshot.capturedAt,
      followersShards: exportSnapshot.followersShards,
      followingShards: exportSnapshot.followingShards,
      declaredCompleteFollowers: exportSnapshot.declaredCompleteFollowers,
      declaredCompleteFollowing: exportSnapshot.declaredCompleteFollowing,
      followersCount: sql<number | null>`cardinality(${exportSnapshot.followers})`,
      followingCount: sql<number | null>`cardinality(${exportSnapshot.following})`,
    })
    .from(exportSnapshot)
    .where(
      and(
        eq(exportSnapshot.userId, userId),
        eq(exportSnapshot.profileId, owned.id),
        isNotNull(exportSnapshot.capturedAt),
      ),
    );
  const idByDigest = new Map(rows.map((row) => [row.snapshotDigest, row.id]));
  const history = countHistory(
    rows.map((row) => ({
      ...toDomainSnapshot({
        ...row,
        followers: rosterOfSize(row.followersCount),
        following: rosterOfSize(row.followingCount),
      }),
      snapshotDigest: row.snapshotDigest,
    })),
  );
  return {
    points: history.points.map((point) => ({
      snapshotId: idByDigest.get(point.snapshotDigest) as string,
      capturedAt: point.capturedAt,
      followers: point.followers,
      following: point.following,
    })),
    followersChange: history.followersChange,
    followingChange: history.followingChange,
  };
}
