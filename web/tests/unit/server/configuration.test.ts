import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configurationStatus,
  NOT_FULLY_CONFIGURED,
  STORAGE_NOT_CONFIGURED,
  unconfiguredReason,
} from "@/server/configuration";
import { resetEnvForTests } from "@/server/env";

const filler = (label: string) => `${"unit-only-".repeat(4)}${label}`;

const VALID: Record<string, string> = {
  APP_STAGE: "staging",
  APP_BASE_URL: "https://staging.orbitdiff.test",
  DATABASE_URL: "postgres://orbit:pw@db.orbitdiff.test:5432/app",
  BETTER_AUTH_SECRET: filler("auth"),
  JOBS_TICK_SECRET: filler("jobs"),
};

const TOUCHED = [...Object.keys(VALID), "EMAIL_TRANSPORT", "MAILBOX_SECRET", "OPERATOR_NAME", "CAPACITY_MAX_USERS"];
const saved = new Map<string, string | undefined>();

function configure(values: Record<string, string | undefined>): void {
  for (const name of TOUCHED) delete process.env[name];
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
  resetEnvForTests();
}

beforeEach(() => {
  for (const name of TOUCHED) saved.set(name, process.env[name]);
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
});

describe("configurationStatus", () => {
  it("reports a complete configuration as configured", () => {
    configure(VALID);
    expect(configurationStatus()).toEqual({ configured: true });
  });

  it("does not throw when nothing is configured and lists every required variable", () => {
    configure({});
    expect(configurationStatus()).toEqual({
      configured: false,
      missing: ["APP_STAGE", "APP_BASE_URL", "DATABASE_URL", "BETTER_AUTH_SECRET", "JOBS_TICK_SECRET"],
    });
  });

  it("lists only DATABASE_URL when only storage is missing", () => {
    configure({ ...VALID, DATABASE_URL: undefined });
    expect(configurationStatus()).toEqual({ configured: false, missing: ["DATABASE_URL"] });
  });

  it("lists a variable whose value is not valid by name, and never the value", () => {
    configure({
      ...VALID,
      DATABASE_URL: "mysql://orbit:hunter2@db/app",
      BETTER_AUTH_SECRET: "short-secret-value",
      CAPACITY_MAX_USERS: "many",
    });
    const status = configurationStatus();
    expect(status).toEqual({
      configured: false,
      missing: ["DATABASE_URL", "BETTER_AUTH_SECRET", "CAPACITY_MAX_USERS"],
    });
    const text = JSON.stringify(status);
    for (const value of ["hunter2", "mysql", "short-secret-value", "many"]) expect(text).not.toContain(value);
  });

  it("returns variable names only", () => {
    configure({ APP_BASE_URL: "not a url", EMAIL_TRANSPORT: "smtp" });
    const status = configurationStatus();
    expect(status.configured).toBe(false);
    if (status.configured) return;
    for (const name of status.missing) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("sees a configuration that is completed later", () => {
    configure({});
    expect(configurationStatus().configured).toBe(false);
    configure(VALID);
    expect(configurationStatus()).toEqual({ configured: true });
  });
});

describe("unconfiguredReason", () => {
  it("says that storage is not configured when the database URL is among the missing", () => {
    expect(STORAGE_NOT_CONFIGURED).toBe("Registration is closed: storage is not configured.");
    expect(unconfiguredReason(["DATABASE_URL"])).toBe(STORAGE_NOT_CONFIGURED);
    expect(unconfiguredReason(["APP_STAGE", "DATABASE_URL", "JOBS_TICK_SECRET"])).toBe(STORAGE_NOT_CONFIGURED);
  });

  it("says that the deployment is not fully configured otherwise", () => {
    expect(NOT_FULLY_CONFIGURED).toBe("Registration is closed: this deployment is not fully configured.");
    expect(unconfiguredReason(["BETTER_AUTH_SECRET"])).toBe(NOT_FULLY_CONFIGURED);
    expect(unconfiguredReason([])).toBe(NOT_FULLY_CONFIGURED);
  });

  it("never opens registration: every answer starts with the closed wording", () => {
    for (const missing of [[], ["DATABASE_URL"], ["APP_STAGE"]]) {
      expect(unconfiguredReason(missing)).toMatch(/^Registration is closed: /);
    }
  });
});
