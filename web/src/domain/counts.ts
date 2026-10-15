import { DomainError } from "./errors";
import { coverage, type Snapshot } from "./export/snapshot";

/**
 * Count history and net change wording.
 *
 * A count change is a count change. Nothing in this module returns, stores,
 * or accepts a username as output: a count that moves from 100 to 103 reads
 * "Net growth of 3" and names nobody. Which accounts differ between two
 * exports is a separate, labelled export observation (`deriveEvents`).
 */
export interface CountPoint {
  snapshotDigest: string;
  capturedAt: string;
  /** Followers in the export, only when that direction's coverage is complete. */
  followers: number | null;
  /** Following in the export, only when that direction's coverage is complete. */
  following: number | null;
}

export interface CountHistory {
  /** Dated snapshots with at least one complete direction, oldest first. */
  points: CountPoint[];
  /** Wording for the two most recent known follower counts, or `null`. */
  followersChange: string | null;
  followingChange: string | null;
}

function requireCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError("invalid_input", "A count must be a whole number that is not negative.");
  }
  return value;
}

/** "Net growth of N", "Net decline of N", or "No net change". */
export function describeNetChange(previous: number, next: number): string {
  const difference = requireCount(next) - requireCount(previous);
  if (difference > 0) {
    return `Net growth of ${difference}`;
  }
  if (difference < 0) {
    return `Net decline of ${-difference}`;
  }
  return "No net change";
}

function latestChange(points: readonly CountPoint[], direction: "followers" | "following"): string | null {
  const known: number[] = [];
  for (const point of points) {
    const value = point[direction];
    if (value !== null) {
      known.push(value);
    }
  }
  if (known.length < 2) {
    return null;
  }
  return describeNetChange(known[known.length - 2], known[known.length - 1]);
}

/**
 * The count series of a profile. Undated snapshots and directions without
 * effective complete coverage contribute nothing, so a partial export never
 * shows up as a drop.
 */
export function countHistory(
  snapshots: ReadonlyArray<Snapshot & { snapshotDigest: string }>,
): CountHistory {
  const points: CountPoint[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.capturedAt === null) {
      continue;
    }
    const followers = coverage(snapshot, "followers").complete ? (snapshot.followers ?? []).length : null;
    const following = coverage(snapshot, "following").complete ? (snapshot.following ?? []).length : null;
    if (followers === null && following === null) {
      continue;
    }
    points.push({
      snapshotDigest: snapshot.snapshotDigest,
      capturedAt: snapshot.capturedAt,
      followers,
      following,
    });
  }
  points.sort((left, right) =>
    left.capturedAt < right.capturedAt ? -1 : left.capturedAt > right.capturedAt ? 1 : 0,
  );
  return {
    points,
    followersChange: latestChange(points, "followers"),
    followingChange: latestChange(points, "following"),
  };
}
