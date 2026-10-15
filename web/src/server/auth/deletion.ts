import "server-only";

import { eq, inArray, or, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { auditEvent, mailCapture, profile, usageDaily, verification } from "@/server/db/schema";

/**
 * Remove the rows of a user that the foreign-key cascade cannot reach, because
 * they are keyed by something other than user_id: usage counters (scope keys
 * `user:<id>` and `profile:<id>`), pending verification values that hold the
 * user id, and captured mail addressed to the user. Audit rows stay, but the
 * actor is cleared, so the audit log holds nothing that points at a deleted
 * account.
 *
 * Runs just before Better Auth deletes the user row, while the profile ids can
 * still be read. Everything else (sessions, credentials, consent, profiles,
 * snapshots, events, jobs, activity) goes with the cascade.
 */
export async function purgeUserLeftovers(userId: string, email: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const profileScopes = tx
      .select({ key: sql<string>`'profile:' || ${profile.id}::text` })
      .from(profile)
      .where(eq(profile.userId, userId));
    await tx
      .delete(usageDaily)
      .where(or(eq(usageDaily.scopeKey, `user:${userId}`), inArray(usageDaily.scopeKey, profileScopes)));
    await tx.delete(verification).where(eq(verification.value, userId));
    await tx.delete(mailCapture).where(eq(mailCapture.toAddress, email.trim().toLowerCase()));
    await tx.update(auditEvent).set({ actorUserId: null }).where(eq(auditEvent.actorUserId, userId));
  });
}
