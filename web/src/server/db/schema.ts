import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export * from "./auth-schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Append-only consent log. The latest row per (user, kind) is the current state.
 */
export const consentRecord = pgTable(
  "consent_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    source: text("source").notNull(),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("consent_user_kind_idx").on(t.userId, t.kind, t.recordedAt),
    check("consent_kind_check", sql`${t.kind} in ('terms', 'privacy', 'marketing')`),
    check("consent_source_check", sql`${t.source} in ('signup', 'onboarding', 'settings')`),
  ],
);

/**
 * An Instagram account whose owner-supplied exports a user imports.
 * Ownership of the handle is the user's declaration.
 */
export const profile = pgTable(
  "profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    status: text("status").notNull().default("active"),
    /** Incremented whenever stored export history changes. */
    contentRevision: integer("content_revision").notNull().default(0),
    /** The content revision that derived data (events, summary) reflects. */
    derivedRevision: integer("derived_revision").notNull().default(0),
    summary: jsonb("summary"),
    nextReviewAt: timestamptz("next_review_at"),
    lastReviewAt: timestamptz("last_review_at"),
    lastSuccessAt: timestamptz("last_success_at"),
    lastFailureAt: timestamptz("last_failure_at"),
    lastFailureCode: text("last_failure_code"),
    pausedAt: timestamptz("paused_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("profile_user_handle_unique").on(t.userId, t.handle),
    index("profile_review_due_idx").on(t.status, t.nextReviewAt),
    check("profile_status_check", sql`${t.status} in ('active', 'paused')`),
  ],
);

/**
 * One owner export observation. Rosters hold lowercased usernames only.
 * A null roster means the direction was not supplied, which differs from an empty list.
 */
export const exportSnapshot = pgTable(
  "export_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    snapshotDigest: text("snapshot_digest").notNull(),
    contentDigest: text("content_digest").notNull(),
    capturedAt: timestamptz("captured_at"),
    importedAt: timestamptz("imported_at").notNull(),
    followers: text("followers").array(),
    following: text("following").array(),
    followersShards: integer("followers_shards").array().notNull(),
    followingShards: integer("following_shards").array().notNull(),
    declaredCompleteFollowers: boolean("declared_complete_followers").notNull(),
    declaredCompleteFollowing: boolean("declared_complete_following").notNull(),
    /** Effective complete coverage: present, contiguous shards, known capture time, declared. */
    followersComplete: boolean("followers_complete").notNull(),
    followingComplete: boolean("following_complete").notNull(),
    rosterBytes: integer("roster_bytes").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    uniqueIndex("snapshot_profile_digest_unique").on(t.profileId, t.snapshotDigest),
    uniqueIndex("snapshot_profile_captured_unique")
      .on(t.profileId, t.capturedAt)
      .where(sql`${t.capturedAt} is not null`),
    uniqueIndex("snapshot_profile_current_unique")
      .on(t.profileId)
      .where(sql`${t.isCurrent}`),
    index("snapshot_user_idx").on(t.userId),
  ],
);

/**
 * Export observations derived from consecutive dated snapshots.
 * A derived view: replaced as a whole whenever the export history changes.
 */
export const changeEvent = pgTable(
  "change_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    direction: text("direction").notNull(),
    username: text("username").notNull(),
    /** Capture time of the earlier export. */
    intervalStart: timestamptz("interval_start").notNull(),
    /** Capture time of the later export. */
    intervalEnd: timestamptz("interval_end").notNull(),
    eventDigest: text("event_digest").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_profile_digest_unique").on(t.profileId, t.eventDigest),
    index("event_user_interval_idx").on(t.userId, t.intervalEnd),
    index("event_profile_position_idx").on(t.profileId, t.position),
    check(
      "event_type_check",
      sql`${t.eventType} in ('follower_observed_added', 'follower_observed_removed', 'following_observed_added', 'following_observed_removed')`,
    ),
    check("event_direction_check", sql`${t.direction} in ('followers', 'following')`),
  ],
);

/**
 * Durable background work. Drained by the protected batch endpoint.
 */
export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key").notNull(),
    runAfter: timestamptz("run_after").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockToken: uuid("lock_token"),
    lockedUntil: timestamptz("locked_until"),
    lastErrorCode: text("last_error_code"),
    cancelReason: text("cancel_reason"),
    result: jsonb("result"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    uniqueIndex("job_dedupe_unique").on(t.dedupeKey),
    uniqueIndex("job_one_active_per_profile_kind")
      .on(t.profileId, t.kind)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("job_claim_idx").on(t.status, t.runAfter),
    index("job_user_idx").on(t.userId, t.createdAt),
    check("job_kind_check", sql`${t.kind} in ('derive_profile', 'daily_review', 'manual_review')`),
    check(
      "job_status_check",
      sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

/**
 * User-visible feed of what happened: imports, processing results, reviews, failures.
 */
export const activityEntry = pgTable(
  "activity_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => profile.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    summary: jsonb("summary").notNull(),
    occurredAt: timestamptz("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("activity_user_time_idx").on(t.userId, t.occurredAt),
    index("activity_profile_time_idx").on(t.profileId, t.occurredAt),
    uniqueIndex("activity_job_kind_unique")
      .on(t.jobId, t.kind)
      .where(sql`${t.jobId} is not null`),
    check(
      "activity_kind_check",
      sql`${t.kind} in ('import_received', 'import_processed', 'review', 'job_failed', 'profile_added', 'profile_paused', 'profile_resumed')`,
    ),
    check("activity_status_check", sql`${t.status} in ('ok', 'failed', 'info')`),
  ],
);

/** Daily usage counters for quotas. scope_key is 'global', 'user:<id>' or 'profile:<id>'. */
export const usageDaily = pgTable(
  "usage_daily",
  {
    day: date("day").notNull(),
    scopeKey: text("scope_key").notNull(),
    imports: integer("imports").notNull().default(0),
    manualReviews: integer("manual_reviews").notNull().default(0),
    jobs: integer("jobs").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.scopeKey] })],
);

/** Small operational key/value store: last tick, measured database size, capacity flags. */
export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** Security-relevant events. Holds no personal data after an account is deleted. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamptz("at").notNull().defaultNow(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

/** Outbound mail captured instead of delivered. Used only by the capture transport (tests, staging). */
export const mailCapture = pgTable(
  "mail_capture",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toAddress: text("to_address").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("mail_capture_to_idx").on(t.toAddress, t.createdAt)],
);
