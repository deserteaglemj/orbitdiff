import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { user, verification } from "@/server/db/schema";

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
