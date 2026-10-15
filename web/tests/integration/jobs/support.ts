import { and, eq, sql } from "drizzle-orm";

import { formatCaptureTime } from "@/domain/capture-time";
import { coverage, identifySnapshot, type Snapshot } from "@/domain/export/snapshot";
import { getDb } from "@/server/db/client";
import { activityEntry, changeEvent, exportSnapshot, job, profile } from "@/server/db/schema";
import { JOB_HANDLERS } from "@/server/jobs/handlers";
import { dedupeKey, enqueueJob } from "@/server/jobs/queue";
import { claimJobs, executeJob, type JobHandlers, type JobOutcome } from "@/server/jobs/worker";

import { createVerifiedUser } from "../../helpers";

export interface Owner {
  userId: string;
  profileId: string;
  handle: string;
  cookie: string;
}

export async function addProfile(
  userId: string,
  handle: string,
  values: Partial<typeof profile.$inferInsert> = {},
): Promise<string> {
  const [row] = await getDb()
    .insert(profile)
    .values({ userId, handle, ...values })
    .returning({ id: profile.id });
  if (!row) throw new Error("profile was not created");
  return row.id;
}

/** A verified, onboarded user with one active profile. */
export async function ownerWithProfile(
  email: string,
  handle: string,
  options: { timezone?: string; profile?: Partial<typeof profile.$inferInsert> } = {},
): Promise<Owner> {
  const owner = await createVerifiedUser({ email, onboarded: true, timezone: options.timezone });
  const profileId = await addProfile(owner.userId, handle, options.profile);
  return { userId: owner.userId, profileId, handle, cookie: owner.cookie };
}

export interface SnapshotInput {
  /** ISO timestamp, or null for an undated export. */
  capturedAt: string | null;
  followers?: string[] | null;
  following?: string[] | null;
  completeFollowers?: boolean;
  completeFollowing?: boolean;
  importedAt?: Date;
}

/**
 * Store one export snapshot the way an import would: digests and effective coverage
 * from the domain rules, the content revision raised, and the current flag moved to
 * the newest dated snapshot (or kept on the first undated one).
 */
export async function addSnapshot(owner: Owner, input: SnapshotInput): Promise<string> {
  const followers = input.followers === undefined ? null : input.followers;
  const following = input.following === undefined ? null : input.following;
  const captured = input.capturedAt === null ? null : new Date(input.capturedAt);
  const snapshot: Snapshot = {
    followers: followers === null ? null : [...followers].sort(),
    following: following === null ? null : [...following].sort(),
    shards: { followers: followers === null ? [] : [0], following: following === null ? [] : [0] },
    capturedAt: captured === null ? null : formatCaptureTime(captured),
    declarations: {
      followers: input.completeFollowers ?? false,
      following: input.completeFollowing ?? false,
    },
  };
  const identified = await identifySnapshot(owner.handle, snapshot);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exportSnapshot)
      .values({
        userId: owner.userId,
        profileId: owner.profileId,
        snapshotDigest: identified.snapshotDigest,
        contentDigest: identified.contentDigest,
        capturedAt: captured,
        importedAt: input.importedAt ?? new Date(),
        followers: snapshot.followers,
        following: snapshot.following,
        followersShards: snapshot.shards.followers,
        followingShards: snapshot.shards.following,
        declaredCompleteFollowers: snapshot.declarations.followers,
        declaredCompleteFollowing: snapshot.declarations.following,
        followersComplete: coverage(snapshot, "followers").complete,
        followingComplete: coverage(snapshot, "following").complete,
        rosterBytes: JSON.stringify([snapshot.followers, snapshot.following]).length,
      })
      .returning({ id: exportSnapshot.id });
    if (!row) throw new Error("snapshot was not stored");
    const all = await tx
      .select({ id: exportSnapshot.id, capturedAt: exportSnapshot.capturedAt, importedAt: exportSnapshot.importedAt })
      .from(exportSnapshot)
      .where(eq(exportSnapshot.profileId, owner.profileId));
    const dated = all
      .filter((entry) => entry.capturedAt !== null)
      .sort((a, b) => (b.capturedAt as Date).getTime() - (a.capturedAt as Date).getTime());
    const undated = all
      .filter((entry) => entry.capturedAt === null)
      .sort((a, b) => a.importedAt.getTime() - b.importedAt.getTime());
    const current = dated[0] ?? undated[0];
    await tx.update(exportSnapshot).set({ isCurrent: false }).where(eq(exportSnapshot.profileId, owner.profileId));
    if (current) await tx.update(exportSnapshot).set({ isCurrent: true }).where(eq(exportSnapshot.id, current.id));
    await tx
      .update(profile)
      .set({ contentRevision: sql`${profile.contentRevision} + 1` })
      .where(eq(profile.id, owner.profileId));
    return row.id;
  });
}

export async function profileRow(profileId: string) {
  const [row] = await getDb().select().from(profile).where(eq(profile.id, profileId));
  if (!row) throw new Error("profile not found");
  return row;
}

export async function jobRow(jobId: string) {
  const [row] = await getDb().select().from(job).where(eq(job.id, jobId));
  return row;
}

export async function jobsOf(profileId: string, kind?: string) {
  const rows = await getDb().select().from(job).where(eq(job.profileId, profileId));
  return rows
    .filter((row) => kind === undefined || row.kind === kind)
    .sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
}

export async function eventsOf(profileId: string) {
  return getDb().select().from(changeEvent).where(eq(changeEvent.profileId, profileId)).orderBy(changeEvent.position);
}

export async function activityOf(profileId: string, kind?: string) {
  const conditions = [eq(activityEntry.profileId, profileId)];
  if (kind) conditions.push(eq(activityEntry.kind, kind));
  return getDb()
    .select()
    .from(activityEntry)
    .where(and(...conditions))
    .orderBy(activityEntry.occurredAt);
}

/** Queue the derive job an import would queue: keyed by the profile's current content revision. */
export async function queueDerive(owner: Owner, now: Date, suffix = "") {
  const current = await profileRow(owner.profileId);
  const { job: row } = await enqueueJob(getDb(), {
    userId: owner.userId,
    profileId: owner.profileId,
    kind: "derive_profile",
    dedupeKey: `${dedupeKey.derive(owner.profileId, current.contentRevision)}${suffix}`,
    runAfter: now,
  });
  return row;
}

/** Claim every due job and run it with the real handlers, one after another. */
export async function runQueued(now: Date, handlers: JobHandlers = JOB_HANDLERS): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (const claim of await claimJobs({ now, limit: 50 })) {
    outcomes.push(await executeJob(claim, { now, handlers }));
  }
  return outcomes;
}
