import "server-only";

import { and, asc, desc, eq, like, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { changeEvent, profile } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import type { Direction, ExportEventDto, ExportEventType, Page } from "./contracts";
import { requireOwnedProfile } from "./profiles";
import { containsPattern, type PageRequest, pageWindow, searchText, toPage } from "./shared";
import { captureTimeOf } from "./snapshot-rows";

export const EXPORT_EVENT_TYPES: readonly ExportEventType[] = [
  "follower_observed_added",
  "follower_observed_removed",
  "following_observed_added",
  "following_observed_removed",
];

export interface EventFilters extends PageRequest {
  profileId?: string | null;
  type?: ExportEventType | null;
  /** Username substring, case-insensitive. */
  q?: string | null;
}

/**
 * Export observations of the user: differences between two consecutive dated
 * owner exports, read from the rows the derive job stored. Newest interval
 * first, then the stored position. Each one is a difference between two
 * files, never a live follow or unfollow, and is labelled that way.
 */
export async function listEvents(userId: string, filters: EventFilters = {}): Promise<Page<ExportEventDto>> {
  const db = getDb();
  const window = pageWindow(filters);
  const q = searchText(filters.q);
  const type = filters.type ?? null;
  if (type !== null && !EXPORT_EVENT_TYPES.includes(type)) {
    throw new AppError("invalid_input", "type is not a known value.", { fields: ["type"] });
  }
  const conditions = [eq(changeEvent.userId, userId), eq(profile.userId, userId)];
  if (filters.profileId !== undefined && filters.profileId !== null) {
    const owned = await requireOwnedProfile(userId, filters.profileId, db);
    conditions.push(eq(changeEvent.profileId, owned.id));
  }
  if (type !== null) conditions.push(eq(changeEvent.eventType, type));
  if (q !== null) conditions.push(like(changeEvent.username, containsPattern(q)));
  const where = and(...conditions);

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(changeEvent)
    .innerJoin(profile, eq(profile.id, changeEvent.profileId))
    .where(where);
  const rows = await db
    .select({
      id: changeEvent.id,
      profileId: changeEvent.profileId,
      profileHandle: profile.handle,
      eventType: changeEvent.eventType,
      direction: changeEvent.direction,
      username: changeEvent.username,
      intervalStart: changeEvent.intervalStart,
      intervalEnd: changeEvent.intervalEnd,
    })
    .from(changeEvent)
    .innerJoin(profile, eq(profile.id, changeEvent.profileId))
    .where(where)
    .orderBy(
      desc(changeEvent.intervalEnd),
      desc(changeEvent.intervalStart),
      asc(changeEvent.position),
      asc(changeEvent.id),
    )
    .limit(window.pageSize)
    .offset(window.offset);
  const data = rows.map(
    (row): ExportEventDto => ({
      id: row.id,
      profileId: row.profileId,
      profileHandle: row.profileHandle,
      type: row.eventType as ExportEventType,
      direction: row.direction as Direction,
      username: row.username,
      intervalStart: captureTimeOf(row.intervalStart) as string,
      intervalEnd: captureTimeOf(row.intervalEnd) as string,
      evidence: "export_observation",
    }),
  );
  return toPage(data, window, total?.n ?? 0);
}
