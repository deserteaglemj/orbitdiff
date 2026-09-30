import { describe, expect, it } from "vitest";

import { EnvError, normalizeOperatorName, parseEnv, readOperatorName } from "@/server/env";

const filler = (label: string) => `${"unit-only-".repeat(4)}${label}`;

function valid(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    APP_STAGE: "staging",
    APP_BASE_URL: "https://staging.orbitdiff.test",
    DATABASE_URL: "postgres://orbit:pw@db.orbitdiff.test:5432/app",
    BETTER_AUTH_SECRET: filler("auth"),
    JOBS_TICK_SECRET: filler("jobs"),
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

describe("OPERATOR_NAME in the configuration", () => {
  it("is null when the variable is absent", () => {
    expect(parseEnv(valid()).operatorName).toBeNull();
  });

  it("is null when the variable is an empty string", () => {
    expect(parseEnv(valid({ OPERATOR_NAME: "" })).operatorName).toBeNull();
  });

  it("is null when the variable is whitespace only", () => {
    expect(parseEnv(valid({ OPERATOR_NAME: " \t  " })).operatorName).toBeNull();
  });

  it("is trimmed", () => {
    expect(parseEnv(valid({ OPERATOR_NAME: "  OrbitDiff Test Operator  " })).operatorName).toBe(
      "OrbitDiff Test Operator",
    );
  });

  it("accepts a name of 2 characters and a name of 80 characters", () => {
    expect(parseEnv(valid({ OPERATOR_NAME: "AB" })).operatorName).toBe("AB");
    expect(parseEnv(valid({ OPERATOR_NAME: "n".repeat(80) })).operatorName).toBe("n".repeat(80));
  });

  it("rejects a name of 1 character, naming the variable", () => {
    expect(failure(valid({ OPERATOR_NAME: "Q" })).variables).toEqual(["OPERATOR_NAME"]);
  });

  it("rejects a name of 81 characters without echoing it", () => {
    const name = `Operator ${"z".repeat(72)}`;
    expect(name).toHaveLength(81);
    const error = failure(valid({ OPERATOR_NAME: name }));
    expect(error.variables).toEqual(["OPERATOR_NAME"]);
    expect(error.message).not.toContain(name);
  });
});

describe("normalizeOperatorName", () => {
  it("returns the trimmed name when it has 2 to 80 characters", () => {
    expect(normalizeOperatorName(" Atlas Studio ")).toBe("Atlas Studio");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["whitespace only", "   \n "],
    ["one character", "Q"],
    ["one character padded with spaces", "  Q  "],
    ["81 characters", "n".repeat(81)],
    ["a number", 42],
    ["true", true],
    ["an object", { name: "Atlas Studio" }],
  ])("fails closed for %s", (_label, value) => {
    expect(normalizeOperatorName(value)).toBeNull();
  });
});

describe("readOperatorName", () => {
  it("reads the name without needing any other variable", () => {
    expect(readOperatorName({ OPERATOR_NAME: " OrbitDiff Test Operator " })).toBe("OrbitDiff Test Operator");
  });

  it("returns null when the variable is absent, empty, or blank", () => {
    expect(readOperatorName({})).toBeNull();
    expect(readOperatorName({ OPERATOR_NAME: "" })).toBeNull();
    expect(readOperatorName({ OPERATOR_NAME: "   " })).toBeNull();
  });

  it("returns null for a value the configuration would reject", () => {
    expect(readOperatorName({ OPERATOR_NAME: "Q" })).toBeNull();
  });
});
