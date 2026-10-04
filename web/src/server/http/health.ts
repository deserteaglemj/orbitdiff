import "server-only";

import { eq } from "drizzle-orm";

import { getRegistrationState } from "@/server/auth/registration";
import { getDb } from "@/server/db/client";
import { systemState } from "@/server/db/schema";
import { getEnv, type Stage } from "@/server/env";
import { mailDelivery, type MailDelivery } from "@/server/mail/transport";

import { logError } from "./log";

/** system_state key under which the batch endpoint stores its last summary (an object with an ISO `at`). */
export const LAST_TICK_STATE_KEY = "last_tick";

const DATABASE_TIMEOUT_MS = 2_000;

export interface Health {
  status: "ok" | "degraded";
  stage: Stage;
  commit: string | null;
  database: { ok: boolean };
  mail: MailDelivery;
  registration: { open: boolean; reason: string | null; accessCodeRequired: boolean };
  /** When the batch endpoint last ran. Counts from the run are not public. */
  lastTick: { at: string } | null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the database did not answer in time")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readLastTick(): Promise<{ at: string } | null> {
  const [row] = await getDb()
    .select({ value: systemState.value, updatedAt: systemState.updatedAt })
    .from(systemState)
    .where(eq(systemState.key, LAST_TICK_STATE_KEY));
  if (!row) return null;
  const at = (row.value as { at?: unknown } | null)?.at;
  return { at: typeof at === "string" ? at : row.updatedAt.toISOString() };
}

/**
 * Public status of the deployment. Contains no secret, no connection detail,
 * and no account data: only what an anonymous visitor may know.
 */
export async function getHealth(): Promise<Health> {
  const env = getEnv();
  const base = { stage: env.stage, commit: env.commitSha, mail: mailDelivery(env) };
  try {
    const [registration, lastTick] = await withTimeout(
      Promise.all([getRegistrationState(env), readLastTick()]),
      DATABASE_TIMEOUT_MS,
    );
    return {
      status: "ok",
      ...base,
      database: { ok: true },
      registration: {
        open: registration.open,
        reason: registration.reason,
        accessCodeRequired: registration.accessCodeRequired,
      },
      lastTick,
    };
  } catch (error) {
    logError("health", error);
    return {
      status: "degraded",
      ...base,
      database: { ok: false },
      registration: {
        open: false,
        reason: "Registration is unavailable: the service cannot reach its database.",
        accessCodeRequired: env.signupAccessCode !== null,
      },
      lastTick: null,
    };
  }
}
