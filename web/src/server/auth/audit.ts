import "server-only";

import { getDb } from "@/server/db/client";
import { auditEvent } from "@/server/db/schema";
import { logError } from "@/server/http/log";

export type AuthAuditAction = "account_deleted" | "password_reset_completed" | "registration_refused";

/** A refusal code is a short constant such as TERMS_NOT_ACCEPTED. Anything else is stored as UNKNOWN. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,39}$/;

export interface AuthAuditEntry {
  /**
   * The account the event belongs to, or null. It is the only thing in a row
   * that refers to a person: no address, name, network address, or request
   * value is ever stored. It is cleared when that account is deleted (see
   * purgeUserLeftovers), and a deletion is recorded without it.
   */
  actorUserId?: string | null;
  /** For a refusal, the code that was answered. */
  code?: string;
}

/**
 * Append one security-relevant event to audit_event.
 *
 * It never throws. An event that cannot be written is logged as one redacted
 * line and the caller carries on: a refusal is still refused, a finished
 * deletion or reset is not undone by its own bookkeeping.
 */
export async function recordAuthEvent(action: AuthAuditAction, entry: AuthAuditEntry = {}): Promise<void> {
  try {
    await getDb()
      .insert(auditEvent)
      .values({
        action,
        actorUserId: entry.actorUserId ?? null,
        detail:
          entry.code === undefined ? null : { code: CODE_SHAPE.test(entry.code) ? entry.code : "UNKNOWN" },
      });
  } catch (error) {
    logError("auth.audit", error);
  }
}
