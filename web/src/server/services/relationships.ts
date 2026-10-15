import "server-only";

import { and, eq } from "drizzle-orm";

import { buildView } from "@/domain/export/snapshot";
import { getDb } from "@/server/db/client";
import { exportSnapshot } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import type { Page, Relationship, RelationshipDto } from "./contracts";
import { requireOwnedProfile } from "./profiles";
import { type PageRequest, pageWindow, searchText, toPage } from "./shared";
import { toDomainSnapshot } from "./snapshot-rows";

export const RELATIONSHIPS: readonly Relationship[] = ["mutual", "not_following_back", "follows_you", "unknown"];

export interface RelationshipFilters extends PageRequest {
  /** Username substring, case-insensitive. */
  q?: string | null;
  relationship?: Relationship | null;
}

/**
 * Accounts of the profile's current export, in code point order. These are
 * usernames from the owner's own export. Absence in a direction is stated
 * only when that direction has effective complete coverage; otherwise the
 * relationship stays `unknown`.
 */
export async function listRelationships(
  userId: string,
  profileId: string,
  filters: RelationshipFilters = {},
  now: Date = new Date(),
): Promise<Page<RelationshipDto>> {
  const db = getDb();
  const owned = await requireOwnedProfile(userId, profileId, db);
  const window = pageWindow(filters);
  const q = searchText(filters.q);
  const relationship = filters.relationship ?? null;
  if (relationship !== null && !RELATIONSHIPS.includes(relationship)) {
    throw new AppError("invalid_input", "relationship is not a known value.", { fields: ["relationship"] });
  }
  const [current] = await db
    .select()
    .from(exportSnapshot)
    .where(
      and(
        eq(exportSnapshot.userId, userId),
        eq(exportSnapshot.profileId, owned.id),
        eq(exportSnapshot.isCurrent, true),
      ),
    );
  if (!current) return toPage([], window, 0);

  // buildView already returns the accounts sorted by code point.
  const matches = buildView(toDomainSnapshot(current), now).accounts.filter(
    (account) =>
      (q === null || account.username.includes(q)) &&
      (relationship === null || account.relationship === relationship),
  );
  const data = matches.slice(window.offset, window.offset + window.pageSize).map(
    (account): RelationshipDto => ({
      username: account.username,
      following: account.following,
      followedBy: account.followedBy,
      relationship: account.relationship,
    }),
  );
  return toPage(data, window, matches.length);
}
