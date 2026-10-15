import "server-only";

import { configurationStatus, unconfiguredReason } from "@/server/configuration";
import { getHealth } from "@/server/http/health";

/** What an anonymous visitor may know about registration. No secret, no account data. */
export interface PublicRegistration {
  /** False when the deployment lacks its configuration. No account endpoint works in that state. */
  configured: boolean;
  open: boolean;
  /** Why registration is not open, worded for the interface. Null when open. */
  reason: string | null;
  /** True when sign-up must carry an access code. */
  accessCodeRequired: boolean;
  /** True when account mail is stored instead of sent, so the screens can say so plainly. */
  mailCaptured: boolean;
}

/**
 * The registration state the account screens render. It never throws:
 *
 * - not configured (for example no DATABASE_URL): closed, with the storage reason;
 * - configured: whatever the health endpoint reports, which comes from
 *   getRegistrationState(), the function the sign-up gate itself uses. The
 *   screen and the gate therefore cannot disagree;
 * - database unreachable: closed, with the reason the health endpoint gives.
 */
export async function readPublicRegistration(): Promise<PublicRegistration> {
  const status = configurationStatus();
  if (!status.configured) {
    return {
      configured: false,
      open: false,
      reason: unconfiguredReason(status.missing),
      accessCodeRequired: false,
      mailCaptured: false,
    };
  }
  const health = await getHealth();
  return {
    configured: true,
    open: health.registration.open,
    reason: health.registration.reason,
    accessCodeRequired: health.registration.accessCodeRequired,
    mailCaptured: health.mail.mode === "captured",
  };
}
