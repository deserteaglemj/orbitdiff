import "server-only";

import { formatCaptureTime } from "@/domain/capture-time";
import { type Coverage, coverage, type Snapshot } from "@/domain/export/snapshot";

import type { CoverageDto } from "./contracts";

/**
 * Mapping between stored `export_snapshot` rows and the domain snapshot the
 * pure rules work on. Coverage is always recomputed by the domain rule; the
 * stored booleans are a cache of that result.
 */
export interface SnapshotShape {
  capturedAt: Date | null;
  followersShards: number[];
  followingShards: number[];
  declaredCompleteFollowers: boolean;
  declaredCompleteFollowing: boolean;
}

export interface SnapshotRosters {
  followers: string[] | null;
  following: string[] | null;
}

/** Canonical capture time string of a stored instant, or null when the owner declared none. */
export function captureTimeOf(value: Date | null): string | null {
  return value ? formatCaptureTime(value) : null;
}

/** The domain snapshot of a stored row, with its rosters. */
export function toDomainSnapshot(row: SnapshotShape & SnapshotRosters): Snapshot {
  return {
    followers: row.followers,
    following: row.following,
    shards: { followers: row.followersShards, following: row.followingShards },
    capturedAt: captureTimeOf(row.capturedAt),
    declarations: { followers: row.declaredCompleteFollowers, following: row.declaredCompleteFollowing },
  };
}

/**
 * A stand-in roster of a known size. The count and coverage rules read only
 * whether a direction is present and how long it is, so a list of that length
 * with no usernames in it lets them run without loading any username.
 */
export function rosterOfSize(size: number | null): string[] | null {
  return size === null ? null : new Array<string>(size);
}

export function toCoverageDto(value: Coverage): CoverageDto {
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

export function coverageDtos(snapshot: Snapshot): { followers: CoverageDto; following: CoverageDto } {
  return {
    followers: toCoverageDto(coverage(snapshot, "followers")),
    following: toCoverageDto(coverage(snapshot, "following")),
  };
}
