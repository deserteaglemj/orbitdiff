import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type Executor } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { getEnv, type Env } from "@/server/env";
import { mailDelivery } from "@/server/mail/transport";

export const REGISTRATION_CLOSED = "Registration is closed: email delivery is not configured.";
export const REGISTRATION_PAUSED = "Registration is paused: capacity reached.";

export interface RegistrationState {
  open: boolean;
  /** Why registration is not open, worded for the interface. Null when open. */
  reason: string | null;
  /** `closed`: no mail transport. `paused`: user capacity reached. */
  code: "closed" | "paused" | null;
  /** True when sign-up must carry the access code in the x-signup-code header. */
  accessCodeRequired: boolean;
}

export async function countUsers(executor: Executor = getDb()): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(user);
  return row?.n ?? 0;
}

/**
 * Whether a new account can be created right now. One source of truth for the
 * sign-up gate, the health endpoint, and the interface.
 */
export async function getRegistrationState(
  env: Env = getEnv(),
  executor: Executor = getDb(),
): Promise<RegistrationState> {
  const accessCodeRequired = env.signupAccessCode !== null;
  if (!mailDelivery(env).available) {
    return { open: false, reason: REGISTRATION_CLOSED, code: "closed", accessCodeRequired };
  }
  if ((await countUsers(executor)) >= env.capacity.maxUsers) {
    return { open: false, reason: REGISTRATION_PAUSED, code: "paused", accessCodeRequired };
  }
  return { open: true, reason: null, code: null, accessCodeRequired };
}
