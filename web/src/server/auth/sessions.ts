import "server-only";

import { and, desc, eq, ne, notInArray } from "drizzle-orm";

import { LIMITS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { session } from "@/server/db/schema";

/**
 * Bounds on what one account can store through signing in. Every sign-in
 * creates a session row, and Better Auth stores the browser's User-Agent header
 * as sent and removes an expired session only when its token is presented
 * again. Without these bounds one account could add rows of any size for ever
 * and fill the shared database, which pauses imports for everyone.
 */

/** The User-Agent header as it is stored with a session: at most LIMITS.sessionUserAgentChars characters. */
export function boundedUserAgent(value: unknown): string {
  if (typeof value !== "string") return "";
  let kept = value.slice(0, LIMITS.sessionUserAgentChars);
  // Never keep half of a character that needs two UTF-16 units.
  const last = kept.charCodeAt(kept.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) kept = kept.slice(0, -1);
  return kept;
}

/**
 * End the oldest sessions of an account beyond LIMITS.sessionsPerUser, never
 * the one just created (`keepId`). Returns how many were ended.
 */
export async function endSessionsBeyondLimit(
  userId: string,
  keepId: string,
  limit: number = LIMITS.sessionsPerUser,
): Promise<number> {
  const db = getDb();
  const newest = db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
    .orderBy(desc(session.createdAt), desc(session.id))
    .limit(Math.max(1, limit));
  const ended = await db
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, keepId), notInArray(session.id, newest)))
    .returning({ id: session.id });
  return ended.length;
}
