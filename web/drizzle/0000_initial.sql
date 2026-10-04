CREATE TABLE "activity_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid,
	"job_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_kind_check" CHECK ("activity_entry"."kind" in ('import_received', 'import_processed', 'review', 'job_failed', 'profile_added', 'profile_paused', 'profile_resumed')),
	CONSTRAINT "activity_status_check" CHECK ("activity_entry"."status" in ('ok', 'failed', 'info'))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "change_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"direction" text NOT NULL,
	"username" text NOT NULL,
	"interval_start" timestamp with time zone NOT NULL,
	"interval_end" timestamp with time zone NOT NULL,
	"event_digest" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_check" CHECK ("change_event"."event_type" in ('follower_observed_added', 'follower_observed_removed', 'following_observed_added', 'following_observed_removed')),
	CONSTRAINT "event_direction_check" CHECK ("change_event"."direction" in ('followers', 'following'))
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_kind_check" CHECK ("consent_record"."kind" in ('terms', 'privacy', 'marketing')),
	CONSTRAINT "consent_source_check" CHECK ("consent_record"."source" in ('signup', 'onboarding', 'settings'))
);
--> statement-breakpoint
CREATE TABLE "export_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"snapshot_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"captured_at" timestamp with time zone,
	"imported_at" timestamp with time zone NOT NULL,
	"followers" text[],
	"following" text[],
	"followers_shards" integer[] NOT NULL,
	"following_shards" integer[] NOT NULL,
	"declared_complete_followers" boolean NOT NULL,
	"declared_complete_following" boolean NOT NULL,
	"followers_complete" boolean NOT NULL,
	"following_complete" boolean NOT NULL,
	"roster_bytes" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lock_token" uuid,
	"locked_until" timestamp with time zone,
	"last_error_code" text,
	"cancel_reason" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_kind_check" CHECK ("job"."kind" in ('derive_profile', 'daily_review', 'manual_review')),
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "mail_capture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"content_revision" integer DEFAULT 0 NOT NULL,
	"derived_revision" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"next_review_at" timestamp with time zone,
	"last_review_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" text,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_status_check" CHECK ("profile"."status" in ('active', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"day" date NOT NULL,
	"scope_key" text NOT NULL,
	"imports" integer DEFAULT 0 NOT NULL,
	"manual_reviews" integer DEFAULT 0 NOT NULL,
	"jobs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_day_scope_key_pk" PRIMARY KEY("day","scope_key")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"accepted_terms_version" text,
	"marketing_opt_in" boolean DEFAULT false,
	"review_hour" integer DEFAULT 9,
	"status" text DEFAULT 'active',
	"onboarded_at" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_entry" ADD CONSTRAINT "activity_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entry" ADD CONSTRAINT "activity_entry_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_event" ADD CONSTRAINT "change_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_event" ADD CONSTRAINT "change_event_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_snapshot" ADD CONSTRAINT "export_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_snapshot" ADD CONSTRAINT "export_snapshot_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_time_idx" ON "activity_entry" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_profile_time_idx" ON "activity_entry" USING btree ("profile_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_job_kind_unique" ON "activity_entry" USING btree ("job_id","kind") WHERE "activity_entry"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_profile_digest_unique" ON "change_event" USING btree ("profile_id","event_digest");--> statement-breakpoint
CREATE INDEX "event_user_interval_idx" ON "change_event" USING btree ("user_id","interval_end");--> statement-breakpoint
CREATE INDEX "event_profile_position_idx" ON "change_event" USING btree ("profile_id","position");--> statement-breakpoint
CREATE INDEX "consent_user_kind_idx" ON "consent_record" USING btree ("user_id","kind","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_profile_digest_unique" ON "export_snapshot" USING btree ("profile_id","snapshot_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_profile_captured_unique" ON "export_snapshot" USING btree ("profile_id","captured_at") WHERE "export_snapshot"."captured_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_profile_current_unique" ON "export_snapshot" USING btree ("profile_id") WHERE "export_snapshot"."is_current";--> statement-breakpoint
CREATE INDEX "snapshot_user_idx" ON "export_snapshot" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_unique" ON "job" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_one_active_per_profile_kind" ON "job" USING btree ("profile_id","kind") WHERE "job"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "job_user_idx" ON "job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_capture_to_idx" ON "mail_capture" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_user_handle_unique" ON "profile" USING btree ("user_id","handle");--> statement-breakpoint
CREATE INDEX "profile_review_due_idx" ON "profile" USING btree ("status","next_review_at");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");