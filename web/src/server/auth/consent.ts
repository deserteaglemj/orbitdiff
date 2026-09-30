import "server-only";

import { eq } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";
import { logError } from "@/server/http/log";

/** The fields of a newly created user row that decide what is logged. */
export interface NewAccount {
  id: string;
  /** The version of the Terms stored on the row. Anything but the current version logs nothing. */
  acceptedTermsVersion?: unknown;
  /**
   * The version of the Privacy notice the registration named. Leave it out
   * (undefined) when the registration named one version for both documents:
   * the Terms version then stands for it. Anything but the current version of
   * the Privacy notice logs nothing.
   */
  acceptedPrivacyVersion?: unknown;
  /** Marketing consent is granted by the boolean `true` and by nothing else. */
  marketingOptIn?: unknown;
}

/**
 * The versions a new account accepted, or an error that says which document it
 * did not accept. Each returned version is a value the registration named and
 * is exactly the current version of its document. Nothing is filled in from
 * the server's own list: a version the registration never named is never
 * recorded as accepted.
 */
function namedVersions(account: NewAccount): { terms: string; privacy: string } {
  const terms = account.acceptedTermsVersion;
  if (typeof terms !== "string" || terms !== CONSENT_VERSIONS.terms) {
    throw new Error("The new account did not accept the current Terms, so no consent was logged.");
  }
  const privacy = account.acceptedPrivacyVersion === undefined ? terms : account.acceptedPrivacyVersion;
  if (typeof privacy !== "string" || privacy !== CONSENT_VERSIONS.privacy) {
    throw new Error("The new account did not accept the current Privacy notice, so no consent was logged.");
  }
  return { terms, privacy };
}

/**
 * Write the consent log for a new account: terms and privacy granted at the
 * versions the registration named, and marketing granted or not as its own,
 * optional choice.
 *
 * The write checks its own conditions instead of trusting the sign-up gate:
 * - terms are logged only when the row holds exactly the current version of
 *   the Terms. A row that holds no version, or another one, has not accepted
 *   them, whatever created it;
 * - privacy is logged only when the version named for it (its own field, or
 *   the one version named for both documents) is exactly the current version
 *   of the Privacy notice. After a change to the Privacy notice alone, a
 *   registration that names only the earlier version has not accepted it;
 * - if either document was not accepted, nothing is logged for the other;
 * - marketing is granted only for the boolean `true`. The strings "true", "on",
 *   and "yes" and the number 1 are all values Postgres would read as true, so
 *   the comparison happens here, before the value reaches the database.
 *
 * Better Auth creates the user outside our transaction, so if the log cannot be
 * written the new user is removed again: an account never exists without its
 * sign-up consent rows.
 */
export async function recordSignupConsent(account: NewAccount): Promise<void> {
  const db = getDb();
  try {
    const accepted = namedVersions(account);
    await db.insert(consentRecord).values([
      { userId: account.id, kind: "terms", version: accepted.terms, granted: true, source: "signup" },
      { userId: account.id, kind: "privacy", version: accepted.privacy, granted: true, source: "signup" },
      {
        userId: account.id,
        kind: "marketing",
        version: CONSENT_VERSIONS.marketing,
        granted: account.marketingOptIn === true,
        source: "signup",
      },
    ]);
  } catch (error) {
    logError("auth.consent", error);
    await db
      .delete(user)
      .where(eq(user.id, account.id))
      .catch((cleanupError: unknown) => logError("auth.consent.cleanup", cleanupError));
    throw error;
  }
}
