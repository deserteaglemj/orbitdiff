/**
 * Every quota and bound in one place. Hosted limits are deliberately lower than
 * the local Orbit OS limits because storage and compute are shared and free-tier.
 */
export const LIMITS = {
  /** Profiles a single user may add. */
  profilesPerUser: 3,
  /** Distinct usernames in one export snapshot, both directions together. */
  accountsPerSnapshot: 50_000,
  /** Stored export snapshots per profile. */
  snapshotsPerProfile: 30,
  /** Derived export observations kept per profile, newest pairs first. */
  eventsPerProfile: 10_000,
  /** Sum of stored roster bytes per user. */
  rosterBytesPerUser: 20 * 1024 * 1024,
  /** Imports per user per UTC day. */
  importsPerUserPerDay: 10,
  /** Accepted JSON body for an import request. */
  importBodyBytes: 3 * 1024 * 1024,
  /** Browser-side bounds on the raw export, mirroring the local importer. */
  exportFileBytes: 16 * 1024 * 1024,
  exportInputBytes: 32 * 1024 * 1024,
  exportFiles: 1024,
  /** Minimum gap between review jobs for one profile. */
  reviewCooldownMs: 30 * 60 * 1000,
  /** Manual reviews per profile per UTC day. */
  manualReviewsPerProfilePerDay: 3,
  /** Attempts before a job is marked failed. */
  jobMaxAttempts: 3,
  /** Backoff before attempt 2 and attempt 3. */
  jobBackoffMs: [5 * 60 * 1000, 30 * 60 * 1000],
  /** Lease held by a worker on a running job. */
  jobLeaseMs: 120 * 1000,
  /** Jobs drained by one tick, worker concurrency, and the time budget of one tick. */
  tickMaxJobs: 25,
  tickConcurrency: 3,
  tickBudgetMs: 45 * 1000,
  /** An export older than this, or undated, is stale. */
  staleAfterMs: 36 * 60 * 60 * 1000,
  /** Retention windows. */
  retainJobsDays: 90,
  retainActivityDays: 400,
  retainUnverifiedAccountDays: 7,
  retainCapturedMailDays: 7,
  /** Page size bounds for list endpoints. */
  pageSizeDefault: 25,
  pageSizeMax: 100,
} as const;

/** Defaults for operator-configurable global capacity. */
export const CAPACITY_DEFAULTS = {
  maxUsers: 250,
  maxJobsPerDay: 2_000,
  maxDatabaseBytes: 400 * 1024 * 1024,
} as const;

/** Versions of the documents a user consents to. Bump when the text changes. */
export const CONSENT_VERSIONS = {
  terms: "2026-09-30",
  privacy: "2026-09-30",
  marketing: "2026-09-30",
} as const;
