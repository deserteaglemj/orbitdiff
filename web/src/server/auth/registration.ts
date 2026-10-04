import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb, type Executor } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getEnv, normalizeOperatorName, type Env } from "@/server/env";
import { mailDelivery } from "@/server/mail/transport";

export const REGISTRATION_NO_OPERATOR =
  "Registration is closed: the operator of this service has not been named yet.";
export const REGISTRATION_CLOSED = "Registration is closed: email delivery is not configured.";
export const REGISTRATION_PAUSED = "Registration is paused: capacity reached.";

export interface RegistrationState {
  open: boolean;
  /** Why registration is not open, worded for the interface. Null when open. */
  reason: string | null;
  /** `closed`: no operator named, or no mail transport. `paused`: user capacity reached. */
  code: "closed" | "paused" | null;
  /** True when sign-up must carry the access code in the x-signup-code header. */
  accessCodeRequired: boolean;
}

/**
 * The accounts that take a place under CAPACITY_MAX_USERS: verified ones. A
 * sign-up that was never verified takes no place, so nobody can close
 * registration by registering addresses they cannot read. Unverified accounts
 * are bounded separately (see makeRoomForPendingAccount).
 */
export async function countUsers(executor: Executor = getDb()): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(user)
    .where(eq(user.emailVerified, true));
  return row?.n ?? 0;
}

/**
 * The name of whoever runs this deployment, or null. The value is checked here
 * again, not trusted because the configuration parsed: only a string of 2 to 80
 * characters after trimming counts, so a missing, empty, blank, or malformed
 * value leaves the service without a named operator.
 */
export function namedOperator(env: Pick<Env, "operatorName">): string | null {
  return normalizeOperatorName(env.operatorName);
}

/**
 * Whether a new account can be created right now. One source of truth for the
 * sign-up gate, the health endpoint, and the interface.
 *
 * Order: the operator must be named (the owner's rule, in every stage), then
 * mail must be deliverable, then there must be capacity: fewer verified
 * accounts than CAPACITY_MAX_USERS. The access code and the consent checks
 * follow in the sign-up gate.
 */
export async function getRegistrationState(
  env: Env = getEnv(),
  executor: Executor = getDb(),
): Promise<RegistrationState> {
  const accessCodeRequired = env.signupAccessCode !== null;
  if (namedOperator(env) === null) {
    return { open: false, reason: REGISTRATION_NO_OPERATOR, code: "closed", accessCodeRequired };
  }
  if (!mailDelivery(env).available) {
    return { open: false, reason: REGISTRATION_CLOSED, code: "closed", accessCodeRequired };
  }
  if ((await countUsers(executor)) >= env.capacity.maxUsers) {
    return { open: false, reason: REGISTRATION_PAUSED, code: "paused", accessCodeRequired };
  }
  return { open: true, reason: null, code: null, accessCodeRequired };
}
