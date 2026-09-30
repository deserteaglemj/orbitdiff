import "server-only";

import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { profile, user, verification } from "@/server/db/schema";

import { purgeUserLeftovers } from "./deletion";

/**
 * Remove the account that is waiting for verification at this address, if
 * there is one, so the registration that follows creates a fresh account with
 * the new password and a new mail.
 *
 * Until an address is verified nobody has shown they can read its mailbox, so
 * the latest registration wins: a stranger who registered someone else's
 * address first cannot keep its owner out. A verified account is never touched,
 * and neither is one that is not active, so a suspension cannot be shed this way.
 *
 * An unverified account owns no application data: every application route
 * requires a verified user. Its credential and consent rows go with the
 * foreign-key cascade, and a pending password reset for it is removed here.
 */
export async function discardPendingAccount(email: string): Promise<boolean> {
  const address = email.toLowerCase();
  return getDb().transaction(async (tx) => {
    // The row lock makes this wait for a verification that is completing right now.
    const [pending] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, address), eq(user.emailVerified, false), eq(user.status, "active")))
      .for("update");
    if (!pending) return false;
    await tx.delete(verification).where(eq(verification.value, pending.id));
    await tx.delete(user).where(and(eq(user.id, pending.id), eq(user.emailVerified, false)));
    return true;
  });
}

/**
 * Keep the number of accounts that wait for verification below `limit`, so one
 * more can be created: when `limit` or more exist, the oldest are removed until
 * `limit - 1` remain. Waiting accounts take no place under CAPACITY_MAX_USERS
 * (see countUsers), so this is what bounds them. Removing the oldest, instead
 * of refusing the new registration, means a flood of made-up addresses can
 * never close registration; at worst an old, still unverified sign-up has to
 * register again. Its verification link lasts one hour.
 *
 * Only an account that never got past sign-up is removed: unverified, active,
 * and holding no profile. Verified accounts are never touched. The condition is
 * repeated on the delete itself, so an account verified a moment ago stays.
 * Returns how many accounts were removed.
 */
export async function makeRoomForPendingAccount(limit: number): Promise<number> {
  const db = getDb();
  const waiting = and(
    eq(user.emailVerified, false),
    eq(user.status, "active"),
    notExists(db.select({ one: sql`1` }).from(profile).where(eq(profile.userId, user.id))),
  );
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(user).where(waiting);
  const excess = (counted?.n ?? 0) - Math.max(0, Math.floor(limit) - 1);
  if (excess <= 0) return 0;
  const oldest = db.select({ id: user.id }).from(user).where(waiting).orderBy(asc(user.createdAt), asc(user.id)).limit(excess);
  const removed = await db
    .delete(user)
    .where(and(inArray(user.id, oldest), waiting))
    .returning({ id: user.id, email: user.email });
  for (const account of removed) await purgeUserLeftovers(account.id, account.email);
  return removed.length;
}
