import type { CoverageDto, ProfileDto } from "@/server/services/contracts";

/** The clock of the request in these tests. The profile below was captured 19 hours before it. */
export const NOW = new Date("2026-09-30T12:00:00Z");

/** A capture time four months before NOW. */
export const OLD_CAPTURE = "2026-06-01T12:00:00+00:00";

export function coverage(overrides: Partial<CoverageDto> = {}): CoverageDto {
  return {
    present: true,
    complete: true,
    declaredComplete: true,
    shards: [0],
    shardsContiguous: true,
    capturedAtKnown: true,
    independentlyVerified: false,
    ...overrides,
  };
}

/** A profile of atlas_studio with one processed, complete, recent import. */
export function profile(overrides: Partial<ProfileDto> = {}): ProfileDto {
  return {
    id: "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b",
    handle: "atlas_studio",
    status: "active",
    createdAt: "2026-09-19T10:00:00.000Z",
    pausedAt: null,
    evidence: "ok",
    processing: false,
    currentSnapshotId: "9d1f6a52-0c3b-4f7e-8a21-5b6c7d8e9f01",
    capturedAt: "2026-09-29T17:00:00+00:00",
    lastImportAt: "2026-09-29T18:00:00.000Z",
    snapshotCount: 1,
    coverage: { followers: coverage({ shards: [1] }), following: coverage() },
    coverageLabel: "followers user-declared complete; following user-declared complete",
    metrics: {
      followers: 2,
      following: 3,
      mutuals: 1,
      notFollowingBack: 2,
      followersObserved: 2,
      followingObserved: 3,
      reciprocalUnknown: 0,
    },
    issues: [],
    lastSuccessAt: "2026-09-29T18:00:05.000Z",
    lastFailureAt: null,
    lastFailureCode: null,
    lastReviewAt: null,
    nextReviewAt: "2026-10-01T14:00:00.000Z",
    activeJob: null,
    ...overrides,
  };
}

/**
 * Followers declared complete, following not: what an import leaves behind
 * when one of the two declaration boxes stays unticked. The follower count is
 * known and shown; the evidence status is "degraded" whatever the age.
 */
export const ONLY_FOLLOWERS_COMPLETE: Partial<ProfileDto> = {
  evidence: "degraded",
  coverage: { followers: coverage(), following: coverage({ complete: false, declaredComplete: false }) },
  coverageLabel: "followers user-declared complete; following partial",
  metrics: {
    followers: 1234,
    following: null,
    mutuals: 1,
    notFollowingBack: 0,
    followersObserved: 1234,
    followingObserved: 3,
    reciprocalUnknown: 0,
  },
};
