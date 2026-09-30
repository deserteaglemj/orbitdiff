import { and, eq, inArray } from "drizzle-orm";

import { formatCaptureTime } from "@/domain/capture-time";
import { buildView, type Snapshot } from "@/domain/export/snapshot";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { activityEntry, changeEvent, exportSnapshot, job, profile } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import type {
  CoverageDto,
  ExportEventType,
  ImportProcessedRecord,
  ProfileSummaryRecord,
} from "@/server/services/contracts";

/** The clock every service test injects. */
export const NOW = new Date("2026-09-30T12:00:00Z");

export const ATLAS = "atlas@orbitdiff.test";
export const NOVA = "nova@orbitdiff.test";
export const OWNER = "owner@orbitdiff.test";

/** A well-formed id that belongs to nothing. */
export const RANDOM_ID = "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b";

/** Run something that must fail with an AppError and return that error. */
export async function thrown(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

type DocumentVersions = Record<"terms" | "privacy" | "marketing", string>;

/**
 * Run something while the documents are at other versions, the way a deploy
 * that bumps CONSENT_VERSIONS leaves an already open page behind. The versions
 * are put back afterwards, whatever happens.
 */
export async function withDocumentVersions<T>(bump: Partial<DocumentVersions>, run: () => Promise<T>): Promise<T> {
  const versions = CONSENT_VERSIONS as unknown as DocumentVersions;
  const before = { ...versions };
  Object.assign(versions, bump);
  try {
    return await run();
  } finally {
    Object.assign(versions, before);
  }
}

/** Sorted, unique, synthetic usernames: pixel_forge_001, pixel_forge_002, ... */
export function roster(count: number, prefix = "pixel_forge"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}_${String(index + 1).padStart(5, "0")}`);
}

/** A normalized import body for atlas_studio, as the browser would send it. */
export function exportPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: "atlas_studio",
    capturedAt: "2026-09-01T12:00:00+00:00",
    completeFollowers: true,
    completeFollowing: true,
    followers: ["nova_labs"],
    following: ["nova_labs", "pixel_forge"],
    shards: { followers: [0], following: [0] },
    ...overrides,
  };
}

function toCoverageDto(value: CoverageDto & { basis?: string }): CoverageDto {
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

/**
 * Stand-in for the derive job, which another module owns: bring the derived
 * data of a profile up to its content revision. Writes the summary of the
 * current snapshot, finishes the queued derive job, and records the
 * `import_processed` activity entry. Export observations are inserted with
 * insertEvents().
 */
export async function markDerived(
  profileId: string,
  options: { at?: Date; processed?: Partial<ImportProcessedRecord> } = {},
): Promise<void> {
  const db = getDb();
  const at = options.at ?? NOW;
  const [row] = await db.select().from(profile).where(eq(profile.id, profileId));
  if (!row) throw new Error("profile not found");
  const snapshots = await db.select().from(exportSnapshot).where(eq(exportSnapshot.profileId, profileId));
  const current = snapshots.find((snapshot) => snapshot.isCurrent);
  const dated = snapshots.filter((snapshot) => snapshot.capturedAt !== null).length;
  const events = await db.select({ id: changeEvent.id }).from(changeEvent).where(eq(changeEvent.profileId, profileId));
  let summary: ProfileSummaryRecord | null = null;
  if (current) {
    const domain: Snapshot = {
      followers: current.followers,
      following: current.following,
      shards: { followers: current.followersShards, following: current.followingShards },
      capturedAt: current.capturedAt ? formatCaptureTime(current.capturedAt) : null,
      declarations: {
        followers: current.declaredCompleteFollowers,
        following: current.declaredCompleteFollowing,
      },
    };
    const view = buildView(domain, at);
    summary = {
      snapshotId: current.id,
      capturedAt: domain.capturedAt,
      coverage: {
        followers: toCoverageDto(view.coverage.followers),
        following: toCoverageDto(view.coverage.following),
      },
      coverageLabel: view.coverageLabel,
      metrics: view.metrics,
      issues: view.issues,
      eventCount: events.length,
      baselineOnly: dated === 1,
    };
  }
  await db
    .update(profile)
    .set({ summary, derivedRevision: row.contentRevision, lastSuccessAt: at })
    .where(eq(profile.id, profileId));
  const finished = await db
    .update(job)
    .set({ status: "succeeded", finishedAt: at })
    .where(and(eq(job.profileId, profileId), eq(job.kind, "derive_profile"), inArray(job.status, ["queued", "running"])))
    .returning({ id: job.id });
  const processed: ImportProcessedRecord = {
    snapshotCount: snapshots.length,
    datedSnapshotCount: dated,
    baselineOnly: dated === 1,
    eventCount: events.length,
    added: { followers: 0, following: 0 },
    removed: { followers: 0, following: 0 },
    ...options.processed,
  };
  await db.insert(activityEntry).values({
    userId: row.userId,
    profileId,
    jobId: finished[0]?.id ?? null,
    kind: "import_processed",
    status: "ok",
    summary: processed,
    occurredAt: at,
  });
}

export interface SeedEvent {
  type: ExportEventType;
  username: string;
  intervalStart?: string;
  intervalEnd?: string;
}

/** Insert export observations the way the derive job would store them. */
export async function insertEvents(userId: string, profileId: string, events: SeedEvent[]): Promise<void> {
  if (events.length === 0) return;
  await getDb()
    .insert(changeEvent)
    .values(
      events.map((event, position) => ({
        userId,
        profileId,
        eventType: event.type,
        direction: event.type.startsWith("follower_") ? "followers" : "following",
        username: event.username,
        intervalStart: new Date(event.intervalStart ?? "2026-09-01T12:00:00Z"),
        intervalEnd: new Date(event.intervalEnd ?? "2026-09-08T12:00:00Z"),
        eventDigest: `${position}`.padStart(8, "0") + event.username.padEnd(24, "0").slice(0, 24),
        position,
      })),
    );
}

let snapshotSerial = 0;

/** Insert one export snapshot row directly, for read tests that do not go through an import. */
export async function addSnapshot(
  userId: string,
  profileId: string,
  overrides: Partial<typeof exportSnapshot.$inferInsert> = {},
): Promise<string> {
  snapshotSerial += 1;
  const digest = String(snapshotSerial).padStart(64, "0");
  const [row] = await getDb()
    .insert(exportSnapshot)
    .values({
      userId,
      profileId,
      snapshotDigest: digest,
      contentDigest: digest,
      capturedAt: new Date("2026-09-30T11:00:00Z"),
      importedAt: NOW,
      followers: ["nova_labs"],
      following: ["nova_labs", "pixel_forge"],
      followersShards: [0],
      followingShards: [0],
      declaredCompleteFollowers: true,
      declaredCompleteFollowing: true,
      followersComplete: true,
      followingComplete: true,
      rosterBytes: 29,
      isCurrent: true,
      ...overrides,
    })
    .returning({ id: exportSnapshot.id });
  if (!row) throw new Error("snapshot was not inserted");
  return row.id;
}
