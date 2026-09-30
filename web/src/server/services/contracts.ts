/**
 * Data transfer types shared by services, API routes, and the interface.
 * Dates are ISO 8601 strings in UTC. `null` always means "unknown or not applicable",
 * never zero and never an empty list.
 */

export type Direction = "followers" | "following";

export type ProfileStatus = "active" | "paused";

/** Freshness and completeness of the current export, as in the local Orbit OS view. */
export type EvidenceStatus = "missing" | "degraded" | "stale" | "ok";

export type Relationship = "mutual" | "not_following_back" | "follows_you" | "unknown";

export type ExportEventType =
  | "follower_observed_added"
  | "follower_observed_removed"
  | "following_observed_added"
  | "following_observed_removed";

export type JobKind = "derive_profile" | "daily_review" | "manual_review";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ActivityKind =
  | "import_received"
  | "import_processed"
  | "review"
  | "job_failed"
  | "profile_added"
  | "profile_paused"
  | "profile_resumed";

export type ActivityStatus = "ok" | "failed" | "info";

export interface Page<T> {
  data: T[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface CoverageDto {
  present: boolean;
  /** Effective complete coverage: present, contiguous shards, known capture time, declared. */
  complete: boolean;
  declaredComplete: boolean;
  shards: number[];
  shardsContiguous: boolean;
  capturedAtKnown: boolean;
  /** Always false: completeness is a user assertion. */
  independentlyVerified: false;
}

export interface MetricsDto {
  followers: number | null;
  following: number | null;
  mutuals: number | null;
  notFollowingBack: number | null;
  followersObserved: number | null;
  followingObserved: number | null;
  reciprocalUnknown: number | null;
}

export interface IssueDto {
  code: string;
  message: string;
}

/**
 * Stored in `profile.summary` by the derive job. It describes the current snapshot at the
 * content revision recorded in `profile.derived_revision`. Freshness is not stored: it
 * depends on the clock and is computed when the profile is read.
 */
export interface ProfileSummaryRecord {
  snapshotId: string;
  capturedAt: string | null;
  coverage: { followers: CoverageDto; following: CoverageDto };
  coverageLabel: string;
  metrics: MetricsDto;
  issues: IssueDto[];
  /** Export observations derived from the whole dated history at this revision. */
  eventCount: number;
  /** True when the dated history holds a single snapshot, so nothing can be compared yet. */
  baselineOnly: boolean;
}

/** Stored in `activity_entry.summary` for kind `review`. */
export interface ReviewRecord {
  trigger: "daily" | "manual";
  evidence: EvidenceStatus;
  capturedAt: string | null;
  /** Whole hours since the capture time, or null when there is no dated import. */
  ageHours: number | null;
  followers: number | null;
  following: number | null;
}

/** Stored in `activity_entry.summary` for kind `import_processed`. */
export interface ImportProcessedRecord {
  snapshotCount: number;
  datedSnapshotCount: number;
  baselineOnly: boolean;
  eventCount: number;
  added: { followers: number; following: number };
  removed: { followers: number; following: number };
}

export interface JobDto {
  id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  createdAt: string;
  finishedAt: string | null;
  lastErrorCode: string | null;
}

export interface ProfileDto {
  id: string;
  handle: string;
  status: ProfileStatus;
  createdAt: string;
  pausedAt: string | null;
  /** Evidence state of the current snapshot. */
  evidence: EvidenceStatus;
  /** True while an import has been stored but its derived data is not ready yet. */
  processing: boolean;
  currentSnapshotId: string | null;
  capturedAt: string | null;
  lastImportAt: string | null;
  snapshotCount: number;
  coverage: { followers: CoverageDto; following: CoverageDto } | null;
  coverageLabel: string | null;
  metrics: MetricsDto | null;
  issues: IssueDto[];
  /** Last successful background job for this profile. Never changed by a failure. */
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  lastReviewAt: string | null;
  /** Null when the profile is paused. */
  nextReviewAt: string | null;
  activeJob: JobDto | null;
}

export interface SnapshotDto {
  id: string;
  capturedAt: string | null;
  importedAt: string;
  isCurrent: boolean;
  coverage: { followers: CoverageDto; following: CoverageDto };
  /** Counts are present only for a direction with complete coverage. */
  followers: number | null;
  following: number | null;
  followersObserved: number | null;
  followingObserved: number | null;
  source: "instagram_export";
}

export interface ImportReceiptDto {
  snapshotId: string;
  duplicate: boolean;
  provenanceEnriched: boolean;
  current: boolean;
  capturedAt: string | null;
  importedAt: string;
  /** Null when nothing changed and no processing was needed. */
  job: JobDto | null;
}

export interface RelationshipDto {
  username: string;
  /** You follow them. Null when unknown. */
  following: boolean | null;
  /** They follow you. Null when unknown. */
  followedBy: boolean | null;
  relationship: Relationship;
}

export interface ExportEventDto {
  id: string;
  profileId: string;
  profileHandle: string;
  type: ExportEventType;
  direction: Direction;
  username: string;
  /** Capture time of the earlier export. */
  intervalStart: string;
  /** Capture time of the later export. */
  intervalEnd: string;
  evidence: "export_observation";
}

export interface CountPointDto {
  snapshotId: string;
  capturedAt: string;
  followers: number | null;
  following: number | null;
}

export interface CountHistoryDto {
  points: CountPointDto[];
  /** Net change between the two most recent points with a known count, as wording. */
  followersChange: string | null;
  followingChange: string | null;
}

export interface ActivityDto {
  id: string;
  profileId: string | null;
  profileHandle: string | null;
  kind: ActivityKind;
  status: ActivityStatus;
  occurredAt: string;
  /** Human-readable, already worded per the interface rules. */
  title: string;
  detail: string | null;
}

export interface ConsentStateDto {
  terms: { granted: boolean; version: string; recordedAt: string } | null;
  privacy: { granted: boolean; version: string; recordedAt: string } | null;
  marketing: { granted: boolean; version: string; recordedAt: string } | null;
}

export interface MeDto {
  id: string;
  email: string;
  name: string;
  timezone: string;
  reviewHour: number;
  onboarded: boolean;
  isAdmin: boolean;
  consent: ConsentStateDto;
  usage: {
    profiles: number;
    profilesLimit: number;
    importsToday: number;
    importsPerDayLimit: number;
    rosterBytes: number;
    rosterBytesLimit: number;
  };
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  status: "active" | "suspended";
  onboarded: boolean;
  consent: ConsentStateDto;
  usage: {
    profiles: number;
    snapshots: number;
    rosterBytes: number;
    importsLast30Days: number;
    jobsLast30Days: number;
    lastActivityAt: string | null;
  };
}

export interface CapacityDto {
  users: { used: number; limit: number; paused: boolean };
  jobsToday: { used: number; limit: number; paused: boolean };
  database: { bytes: number | null; limit: number; paused: boolean; measuredAt: string | null };
  lastTick: TickSummaryDto | null;
  mail: { available: boolean; mode: "captured" | "none" };
  registration: { open: boolean; reason: string | null };
}

/** Returned by the protected batch endpoint. Counts only, never account data. */
export interface TickSummaryDto {
  at: string;
  recovered: number;
  enqueued: number;
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  cancelled: number;
  remaining: number;
  cleaned: number;
  durationMs: number;
  pausedForCapacity: boolean;
}
