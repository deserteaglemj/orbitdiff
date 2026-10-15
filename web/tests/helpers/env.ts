import { resetEnvForTests } from "@/server/env";

const original = new Map<string, string | undefined>();

/**
 * Override configuration variables for one test and re-read the configuration.
 * `undefined` removes a variable. Always pair with restoreTestEnv() in afterEach.
 *
 *   afterEach(restoreTestEnv);
 *   setTestEnv({ EMAIL_TRANSPORT: "none" });
 */
export function setTestEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(overrides)) {
    if (!original.has(name)) original.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

/** Undo every setTestEnv() since the last restore. */
export function restoreTestEnv(): void {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  original.clear();
  resetEnvForTests();
}
