import "server-only";

import { EnvError, getEnv } from "./env";

/**
 * Whether the deployment has the configuration it needs. `missing` lists the
 * NAMES of the variables that are absent or not valid, in the order the
 * configuration is read. It never contains a value.
 */
export type ConfigurationStatus = { configured: true } | { configured: false; missing: string[] };

export const STORAGE_NOT_CONFIGURED = "Registration is closed: storage is not configured.";
export const NOT_FULLY_CONFIGURED = "Registration is closed: this deployment is not fully configured.";

/**
 * Ask whether the configuration is complete, without throwing. A deployment
 * that has no database yet serves its public pages, answers `unconfigured` on
 * the health endpoint, and keeps registration closed; callers use this to take
 * that path instead of failing on the first read of the configuration.
 *
 * Nothing is cached here: a failed read is not remembered by getEnv(), so the
 * answer changes as soon as the configuration does.
 */
export function configurationStatus(): ConfigurationStatus {
  try {
    getEnv();
    return { configured: true };
  } catch (error) {
    if (error instanceof EnvError) return { configured: false, missing: [...error.variables] };
    throw error;
  }
}

/** Why registration is closed on a deployment that is not configured, worded for the interface. */
export function unconfiguredReason(missing: readonly string[]): string {
  return missing.includes("DATABASE_URL") ? STORAGE_NOT_CONFIGURED : NOT_FULLY_CONFIGURED;
}
