import { afterEach, describe, expect, it } from "vitest";

import { CAPACITY_DEFAULTS } from "@/domain/limits";
import { EnvError, getEnv, parseEnv, resetEnvForTests } from "@/server/env";

const secret = (label: string) => `${"unit-only-".repeat(4)}${label}`;

function valid(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    APP_STAGE: "staging",
    APP_BASE_URL: "https://staging.orbitdiff.test",
    DATABASE_URL: "postgres://orbit:pw@db.orbitdiff.test:5432/app",
    BETTER_AUTH_SECRET: secret("auth"),
    JOBS_TICK_SECRET: secret("jobs"),
    ...overrides,
  };
}

function failure(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("parseEnv accepted the configuration");
}

describe("parseEnv", () => {
  it("applies defaults when only the required variables are set", () => {
    const env = parseEnv(valid());
    expect(env).toEqual({
      stage: "staging",
      baseUrl: "https://staging.orbitdiff.test",
      commitSha: null,
      databaseUrl: "postgres://orbit:pw@db.orbitdiff.test:5432/app",
      databaseUrlUnpooled: "postgres://orbit:pw@db.orbitdiff.test:5432/app",
      authSecret: secret("auth"),
      jobsTickSecret: secret("jobs"),
      adminEmails: new Set<string>(),
      emailTransport: "none",
      mailboxSecret: null,
      signupAccessCode: null,
      capacity: { ...CAPACITY_DEFAULTS },
      clientIpHeader: "x-forwarded-for",
      trustedProxies: [],
    });
  });

  it("reads the client address header and the trusted proxies", () => {
    const env = parseEnv(
      valid({ CLIENT_IP_HEADER: " X-Real-IP ", TRUSTED_PROXIES: "198.51.100.7, 10.0.0.0/8 ,, 2001:db8::/32" }),
    );
    expect(env.clientIpHeader).toBe("x-real-ip");
    expect(env.trustedProxies).toEqual(["198.51.100.7", "10.0.0.0/8", "2001:db8::/32"]);
  });

  it("rejects a client address header that is not a header name, without echoing it", () => {
    for (const value of ["x forwarded for", "x-real-ip: 1.2.3.4", "x".repeat(70), "cookie", "authorization"]) {
      const error = failure(valid({ CLIENT_IP_HEADER: value }));
      expect(error.variables).toEqual(["CLIENT_IP_HEADER"]);
      expect(error.message).not.toContain(value);
    }
  });

  it("rejects a trusted proxy that is not an address or a CIDR range, without echoing it", () => {
    for (const value of ["proxy.internal", "10.0.0.0/33", "198.51.100.7/", "2001:db8::/129", "10.0.0.1, nope"]) {
      const error = failure(valid({ TRUSTED_PROXIES: value }));
      expect(error.variables).toEqual(["TRUSTED_PROXIES"]);
      expect(error.message).not.toContain(value);
    }
  });

  it("reads every optional variable", () => {
    const env = parseEnv(
      valid({
        APP_COMMIT_SHA: "0a1b2c3",
        DATABASE_URL_UNPOOLED: "postgresql://orbit:pw@direct.orbitdiff.test/app",
        EMAIL_TRANSPORT: "capture",
        MAILBOX_SECRET: secret("mail"),
        SIGNUP_ACCESS_CODE: "orbit-preview-1",
        CAPACITY_MAX_USERS: "10",
        CAPACITY_MAX_JOBS_PER_DAY: "20",
        CAPACITY_MAX_DB_BYTES: "3000",
      }),
    );
    expect(env.commitSha).toBe("0a1b2c3");
    expect(env.databaseUrlUnpooled).toBe("postgresql://orbit:pw@direct.orbitdiff.test/app");
    expect(env.emailTransport).toBe("capture");
    expect(env.mailboxSecret).toBe(secret("mail"));
    expect(env.signupAccessCode).toBe("orbit-preview-1");
    expect(env.capacity).toEqual({ maxUsers: 10, maxJobsPerDay: 20, maxDatabaseBytes: 3000 });
  });

  it("reduces the base URL to its origin", () => {
    expect(parseEnv(valid({ APP_BASE_URL: "https://staging.orbitdiff.test/" })).baseUrl).toBe(
      "https://staging.orbitdiff.test",
    );
  });

  it("lowercases and trims admin emails and drops empty entries", () => {
    const env = parseEnv(valid({ ADMIN_EMAILS: " Owner@OrbitDiff.test ,, second@orbitdiff.test " }));
    expect([...env.adminEmails]).toEqual(["owner@orbitdiff.test", "second@orbitdiff.test"]);
  });

  it("treats blank optional variables as unset", () => {
    const env = parseEnv(valid({ SIGNUP_ACCESS_CODE: "  ", APP_COMMIT_SHA: "", MAILBOX_SECRET: "" }));
    expect(env.signupAccessCode).toBeNull();
    expect(env.commitSha).toBeNull();
    expect(env.mailboxSecret).toBeNull();
  });

  it("names every offending variable and never echoes a value", () => {
    const error = failure(
      valid({
        APP_STAGE: "prod-ish",
        BETTER_AUTH_SECRET: "short-secret-value",
        JOBS_TICK_SECRET: undefined,
        CAPACITY_MAX_USERS: "many",
      }),
    );
    expect(error.variables).toEqual([
      "APP_STAGE",
      "BETTER_AUTH_SECRET",
      "JOBS_TICK_SECRET",
      "CAPACITY_MAX_USERS",
    ]);
    for (const name of error.variables) expect(error.message).toContain(name);
    expect(error.message).not.toContain("prod-ish");
    expect(error.message).not.toContain("short-secret-value");
    expect(error.message).not.toContain("many");
  });

  it("rejects a database URL that is not a postgres URL without echoing it", () => {
    const error = failure(valid({ DATABASE_URL: "mysql://orbit:hunter2@db/app" }));
    expect(error.variables).toEqual(["DATABASE_URL"]);
    expect(error.message).not.toContain("hunter2");
  });

  it("refuses captured mail in production", () => {
    const error = failure(
      valid({
        APP_STAGE: "production",
        APP_BASE_URL: "https://orbitdiff.test",
        EMAIL_TRANSPORT: "capture",
        MAILBOX_SECRET: secret("mail"),
      }),
    );
    expect(error.variables).toEqual(["EMAIL_TRANSPORT"]);
  });

  it("requires the mailbox secret when staging captures mail", () => {
    expect(failure(valid({ EMAIL_TRANSPORT: "capture" })).variables).toEqual(["MAILBOX_SECRET"]);
  });

  it("requires a mailbox secret of at least 32 characters when one is set", () => {
    expect(failure(valid({ MAILBOX_SECRET: "too-short" })).variables).toEqual(["MAILBOX_SECRET"]);
  });

  it("requires an access code of at least 12 characters when one is set", () => {
    expect(failure(valid({ SIGNUP_ACCESS_CODE: "elevenchars" })).variables).toEqual([
      "SIGNUP_ACCESS_CODE",
    ]);
  });

  it("rejects an unknown mail transport", () => {
    expect(failure(valid({ EMAIL_TRANSPORT: "smtp" })).variables).toEqual(["EMAIL_TRANSPORT"]);
  });

  it("requires an https base URL in staging and production", () => {
    expect(failure(valid({ APP_BASE_URL: "http://staging.orbitdiff.test" })).variables).toEqual([
      "APP_BASE_URL",
    ]);
    expect(
      parseEnv(valid({ APP_STAGE: "development", APP_BASE_URL: "http://localhost:3000" })).baseUrl,
    ).toBe("http://localhost:3000");
  });

  it("rejects capacity values that are not positive integers", () => {
    expect(
      failure(valid({ CAPACITY_MAX_JOBS_PER_DAY: "0", CAPACITY_MAX_DB_BYTES: "1.5" })).variables,
    ).toEqual(["CAPACITY_MAX_JOBS_PER_DAY", "CAPACITY_MAX_DB_BYTES"]);
  });

  it("rejects an admin entry that is not an email address", () => {
    expect(failure(valid({ ADMIN_EMAILS: "owner@orbitdiff.test, not-an-email" })).variables).toEqual([
      "ADMIN_EMAILS",
    ]);
  });
});

describe("getEnv", () => {
  const names = Object.keys(valid());
  const saved = new Map(names.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetEnvForTests();
  });

  it("validates on first use rather than on import", () => {
    for (const name of names) delete process.env[name];
    resetEnvForTests();
    expect(() => getEnv()).toThrow(EnvError);
  });

  it("caches the parsed configuration until it is reset", () => {
    Object.assign(process.env, valid());
    resetEnvForTests();
    const first = getEnv();
    process.env.APP_STAGE = "development";
    expect(getEnv()).toBe(first);
    resetEnvForTests();
    expect(getEnv().stage).toBe("development");
  });
});
