import "server-only";

import { eq } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";
import { logError } from "@/server/http/log";

/**
 * Write the consent log for a new account: terms and privacy granted at the
 * current versions (the sign-up gate has already required them), and marketing
 * granted or not as its own, optional choice.
 *
 * Better Auth creates the user outside our transaction, so if the log cannot be
 * written the new user is removed again: an account never exists without its
 * sign-up consent rows.
 */
export async function recordSignupConsent(userId: string, marketingOptIn: boolean): Promise<void> {
  const db = getDb();
  try {
    await db.insert(consentRecord).values([
      { userId, kind: "terms", version: CONSENT_VERSIONS.terms, granted: true, source: "signup" },
      { userId, kind: "privacy", version: CONSENT_VERSIONS.privacy, granted: true, source: "signup" },
      {
        userId,
        kind: "marketing",
        version: CONSENT_VERSIONS.marketing,
        granted: marketingOptIn,
        source: "signup",
      },
    ]);
  } catch (error) {
    logError("auth.consent", error);
    await db
      .delete(user)
      .where(eq(user.id, userId))
      .catch((cleanupError: unknown) => logError("auth.consent.cleanup", cleanupError));
    throw error;
  }
}
