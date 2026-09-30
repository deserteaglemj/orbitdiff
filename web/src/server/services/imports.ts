import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import { captureTimeMillis } from "@/domain/capture-time";
import {
  coverage,
  decideImport,
  type HistoryEntry,
  identifySnapshot,
  type IdentifiedSnapshot,
  type ImportDecision,
  validateImportPayload,
} from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { activityEntry, exportSnapshot, profile, user } from "@/server/db/schema";
import { dedupeKey, enqueueJob, type JobRow, toJobDto } from "@/server/jobs/queue";

import type { ImportReceiptDto, Page, SnapshotDto } from "./contracts";
import { requireOwnedProfile } from "./profiles";
import { notFound, type PageRequest, pageWindow, rethrowDomainError, toPage } from "./shared";
import { captureTimeOf, coverageDtos, rosterOfSize, toDomainSnapshot } from "./snapshot-rows";
import { assertDatabaseCapacity, assertImportQuota, assertRosterRoom, countImport } from "./usage";

/** Stored in `activity_entry.summary` for kind `import_received`. Counts only, never usernames. */
export interface ImportReceivedRecord {
  snapshotId: string;
  capturedAt: string | null;
  /** What the import did to the stored history. */
  outcome: "stored" | "enriched" | "declarations_updated";
  /** True when this is the only snapshot of the profile. */
  first: boolean;
  current: boolean;
  followersObserved: number | null;
  followingObserved: number | null;
}

/** Bytes the rosters of one snapshot occupy: the UTF-8 length of every username. */
export function rosterByteSize(followers: readonly string[] | null, following: readonly string[] | null): number {
  let bytes = 0;
  for (const list of [followers, following]) {
    for (const username of list ?? []) bytes += Buffer.byteLength(username, "utf8");
  }
  return bytes;
}

function effectiveCoverage(incoming: IdentifiedSnapshot, decision: ImportDecision) {
  const resolved = { ...incoming, declarations: decision.declarations };
  return {
    declaredCompleteFollowers: decision.declarations.followers,
    declaredCompleteFollowing: decision.declarations.following,
    followersComplete: coverage(resolved, "followers").complete,
    followingComplete: coverage(resolved, "following").complete,
  };
}

/**
 * Store one normalized owner export for a profile of the user.
 *
 * The payload is untrusted: every invariant is validated again and the
 * digests are computed here. The store decision (append, enrich in place, or
 * duplicate) is the domain rule `decideImport`, applied in one transaction
 * that holds the profile row, so two imports of one profile cannot interleave.
 *
 * Only when the stored history changed does the content revision rise, a
 * derive job get queued, an `import_received` entry get written, and the
 * import count against today's quota. The first import is a baseline: nothing
 * here or later turns it into change entries, and this function never writes
 * `change_event` or the profile summary. Those belong to the derive job.
 */
export async function importExport(
  userId: string,
  profileId: string,
  rawPayload: unknown,
  now: Date = new Date(),
): Promise<ImportReceiptDto> {
  const db = getDb();
  const owned = await requireOwnedProfile(userId, profileId, db);
  let incoming: IdentifiedSnapshot;
  try {
    const normalized = validateImportPayload(rawPayload, { account: owned.handle, now, limits: LIMITS });
    incoming = await identifySnapshot(normalized.account, normalized);
  } catch (error) {
    rethrowDomainError(error);
  }
  const bytes = rosterByteSize(incoming.followers, incoming.following);
  const capturedAt = incoming.capturedAt === null ? null : new Date(captureTimeMillis(incoming.capturedAt));

  return db.transaction(async (tx) => {
    // The user row serializes this user's imports, so the quota checks below are exact.
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("no key update");
    if (!owner) throw notFound();
    const [locked] = await tx
      .select({ id: profile.id, contentRevision: profile.contentRevision })
      .from(profile)
      .where(and(eq(profile.userId, userId), eq(profile.id, owned.id)))
      .for("no key update");
    if (!locked) throw notFound();

    await assertDatabaseCapacity(tx);
    await assertImportQuota(userId, now, tx);

    const owns = and(eq(exportSnapshot.userId, userId), eq(exportSnapshot.profileId, locked.id));
    const stored = await tx
      .select({
        id: exportSnapshot.id,
        snapshotDigest: exportSnapshot.snapshotDigest,
        contentDigest: exportSnapshot.contentDigest,
        capturedAt: exportSnapshot.capturedAt,
        importedAt: exportSnapshot.importedAt,
        declaredCompleteFollowers: exportSnapshot.declaredCompleteFollowers,
        declaredCompleteFollowing: exportSnapshot.declaredCompleteFollowing,
        isCurrent: exportSnapshot.isCurrent,
      })
      .from(exportSnapshot)
      .where(owns);
    const history: HistoryEntry[] = stored.map((row) => ({
      snapshotDigest: row.snapshotDigest,
      contentDigest: row.contentDigest,
      capturedAt: captureTimeOf(row.capturedAt),
      declarations: { followers: row.declaredCompleteFollowers, following: row.declaredCompleteFollowing },
      isCurrent: row.isCurrent,
    }));

    let decision: ImportDecision;
    try {
      decision = decideImport(history, incoming, LIMITS.snapshotsPerProfile);
    } catch (error) {
      rethrowDomainError(error);
    }

    const flags = effectiveCoverage(incoming, decision);
    const existing =
      decision.kind === "append"
        ? undefined
        : stored.find((row) => row.snapshotDigest === (decision.replaces ?? decision.snapshotDigest));
    if (decision.kind !== "append" && !existing) throw new Error("the stored snapshot of the import was not found");

    // Only one snapshot per profile may be current, so the old one steps down first.
    if (decision.isCurrent) {
      const others = existing ? and(owns, eq(exportSnapshot.isCurrent, true), ne(exportSnapshot.id, existing.id)) : and(owns, eq(exportSnapshot.isCurrent, true));
      await tx.update(exportSnapshot).set({ isCurrent: false }).where(others);
    }

    let snapshotId: string;
    let importedAt: Date;
    let outcome: ImportReceivedRecord["outcome"] | null;
    if (decision.kind === "append") {
      await assertRosterRoom(userId, bytes, tx);
      const [inserted] = await tx
        .insert(exportSnapshot)
        .values({
          userId,
          profileId: locked.id,
          snapshotDigest: incoming.snapshotDigest,
          contentDigest: incoming.contentDigest,
          capturedAt,
          importedAt: now,
          followers: incoming.followers,
          following: incoming.following,
          followersShards: incoming.shards.followers,
          followingShards: incoming.shards.following,
          ...flags,
          rosterBytes: bytes,
          isCurrent: decision.isCurrent,
        })
        .returning({ id: exportSnapshot.id });
      if (!inserted) throw new Error("the snapshot was not stored");
      snapshotId = inserted.id;
      importedAt = now;
      outcome = "stored";
    } else if (decision.kind === "enrich") {
      // Same content, now with a capture time: the undated snapshot is replaced in place.
      await tx
        .update(exportSnapshot)
        .set({
          snapshotDigest: incoming.snapshotDigest,
          capturedAt,
          importedAt: now,
          ...flags,
          ...(decision.isCurrent ? { isCurrent: true } : {}),
        })
        .where(and(owns, eq(exportSnapshot.id, existing!.id)));
      snapshotId = existing!.id;
      importedAt = now;
      outcome = "enriched";
    } else {
      snapshotId = existing!.id;
      importedAt = existing!.importedAt;
      outcome = decision.declarationsChanged ? "declarations_updated" : null;
      if (decision.declarationsChanged || (decision.isCurrent && !existing!.isCurrent)) {
        await tx
          .update(exportSnapshot)
          .set({ ...flags, ...(decision.isCurrent ? { isCurrent: true } : {}) })
          .where(and(owns, eq(exportSnapshot.id, existing!.id)));
      }
    }

    let queued: JobRow | null = null;
    if (outcome !== null) {
      const nextRevision = locked.contentRevision + 1;
      await tx
        .update(profile)
        .set({ contentRevision: nextRevision, updatedAt: now })
        .where(and(eq(profile.userId, userId), eq(profile.id, locked.id)));
      queued = (
        await enqueueJob(tx, {
          userId,
          profileId: locked.id,
          kind: "derive_profile",
          dedupeKey: dedupeKey.derive(locked.id, nextRevision),
        })
      ).job;
      const record: ImportReceivedRecord = {
        snapshotId,
        capturedAt: incoming.capturedAt,
        outcome,
        first: decision.kind === "append" && stored.length === 0,
        current: decision.isCurrent,
        followersObserved: incoming.followers === null ? null : incoming.followers.length,
        followingObserved: incoming.following === null ? null : incoming.following.length,
      };
      await tx.insert(activityEntry).values({
        userId,
        profileId: locked.id,
        kind: "import_received",
        status: "info",
        summary: record,
        occurredAt: now,
      });
      await countImport(userId, now, tx);
    }

    return {
      snapshotId,
      duplicate: decision.kind === "duplicate",
      provenanceEnriched: decision.kind === "enrich",
      current: decision.isCurrent,
      capturedAt: incoming.capturedAt,
      importedAt: importedAt.toISOString(),
      job: queued ? toJobDto(queued) : null,
    };
  });
}

/** Import history of a profile: newest capture first, undated imports last. Rosters are never returned. */
export async function listSnapshots(
  userId: string,
  profileId: string,
  request: PageRequest = {},
): Promise<Page<SnapshotDto>> {
  const db = getDb();
  const owned = await requireOwnedProfile(userId, profileId, db);
  const window = pageWindow(request);
  const owns = and(eq(exportSnapshot.userId, userId), eq(exportSnapshot.profileId, owned.id));
  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(exportSnapshot)
    .where(owns);
  const rows = await db
    .select({
      id: exportSnapshot.id,
      capturedAt: exportSnapshot.capturedAt,
      importedAt: exportSnapshot.importedAt,
      isCurrent: exportSnapshot.isCurrent,
      followersShards: exportSnapshot.followersShards,
      followingShards: exportSnapshot.followingShards,
      declaredCompleteFollowers: exportSnapshot.declaredCompleteFollowers,
      declaredCompleteFollowing: exportSnapshot.declaredCompleteFollowing,
      followersCount: sql<number | null>`cardinality(${exportSnapshot.followers})`,
      followingCount: sql<number | null>`cardinality(${exportSnapshot.following})`,
    })
    .from(exportSnapshot)
    .where(owns)
    .orderBy(sql`${exportSnapshot.capturedAt} desc nulls last`, desc(exportSnapshot.importedAt), desc(exportSnapshot.id))
    .limit(window.pageSize)
    .offset(window.offset);
  const data = rows.map((row): SnapshotDto => {
    const covered = coverageDtos(
      toDomainSnapshot({
        ...row,
        followers: rosterOfSize(row.followersCount),
        following: rosterOfSize(row.followingCount),
      }),
    );
    return {
      id: row.id,
      capturedAt: captureTimeOf(row.capturedAt),
      importedAt: row.importedAt.toISOString(),
      isCurrent: row.isCurrent,
      coverage: covered,
      followers: covered.followers.complete ? row.followersCount : null,
      following: covered.following.complete ? row.followingCount : null,
      followersObserved: row.followersCount,
      followingObserved: row.followingCount,
      source: "instagram_export",
    };
  });
  return toPage(data, window, total?.n ?? 0);
}
