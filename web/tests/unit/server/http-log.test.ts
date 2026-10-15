import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authLog } from "@/server/auth/log";
import { describeError, logError, MAX_LOG_CHARS, REDACT_INPUT_CHARS, redact } from "@/server/http/log";

afterEach(() => {
  vi.restoreAllMocks();
});

function elapsedMs(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("redact cost", () => {
  it("does not grow with the square of a long run that has no @", () => {
    // The unbounded pattern needed about 3 seconds for 80,000 letters.
    expect(elapsedMs(() => redact("a".repeat(80_000)))).toBeLessThan(250);
  });

  it("does not grow with the square of a long dotted run that has no scheme", () => {
    expect(elapsedMs(() => redact("a.".repeat(40_000)))).toBeLessThan(250);
  });

  it("stays linear inside the window when every start looks like an address", () => {
    const text = `${"a".repeat(REDACT_INPUT_CHARS - 10)} tail`;
    expect(elapsedMs(() => redact(text))).toBeLessThan(250);
  });
});

describe("redact bounds", () => {
  it("returns a bounded text for input of any size", () => {
    const out = redact(`Invalid callbackURL: ${"a".repeat(40_000)}`);
    expect(out.length).toBeLessThanOrEqual(REDACT_INPUT_CHARS + 20);
    expect(out.startsWith("Invalid callbackURL:")).toBe(true);
    expect(out.endsWith("[cut]")).toBe(true);
  });

  it("leaves a short text as it is", () => {
    expect(redact("Invalid password")).toBe("Invalid password");
  });

  it("drops the word that straddles the cut, so half an address cannot survive", () => {
    const filler = "x ".repeat((REDACT_INPUT_CHARS - 12) / 2);
    const out = redact(`${filler}victim@orbitdiff.test and more text`);
    expect(out).not.toContain("victim");
    expect(out).not.toContain("@");
  });

  it("masks long addresses and links whole", () => {
    const local = "a".repeat(64);
    expect(redact(`to ${local}@orbitdiff.test now`)).toBe("to [email] now");
    expect(redact(`see https://orbitdiff.test/reset?token=${"t".repeat(300)} now`)).toBe("see [url] now");
  });

  it("masks an address whose local part is longer than the pattern bound", () => {
    const out = redact(`to ${"a".repeat(200)}@orbitdiff.test now`);
    expect(out).not.toContain("@orbitdiff.test");
  });
});

describe("describeError", () => {
  const failed = () =>
    new DrizzleQueryError(
      'select "id", "value" from "verification" where "identifier" = $1 limit $2',
      ["reset-password:tok-abcdefghij0123456789", 1],
      Object.assign(new Error('column "identifier" does not exist'), { code: "42703" }),
    );

  it("never prints the statement or the parameters of a failed query", () => {
    const line = describeError(failed());
    expect(line).not.toContain("tok-abcdefghij0123456789");
    expect(line).not.toContain("params");
    expect(line).not.toContain("select");
    expect(line).not.toContain("identifier");
  });

  it("keeps the database error code of a failed query", () => {
    expect(describeError(failed())).toContain("42703");
  });

  it("treats any object that carries query parameters the same way", () => {
    const wrapped = Object.assign(new Error("Failed query: insert into account\nparams: u1,credential,salt:hash"), {
      params: ["u1", "credential", "salt:hash"],
    });
    expect(describeError(wrapped)).not.toContain("salt:hash");
  });

  it("cuts a message at a parameter list even when the error object has none", () => {
    const line = describeError(new Error("Failed query: select 1\nparams: nova-secret-value,2"));
    expect(line).not.toContain("nova-secret-value");
  });

  it("still reports an ordinary error in one bounded line", () => {
    const line = describeError(new TypeError(`bad ${"value ".repeat(500)}`));
    expect(line.startsWith("TypeError: bad value")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(MAX_LOG_CHARS + 20);
    expect(line).not.toContain("\n");
  });
});

describe("log sinks", () => {
  it("logError writes one line without the parameters of a failed query", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("http", new DrizzleQueryError("select 1 where a = $1", ["session-token-value"], new Error("boom")));
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]).toHaveLength(1);
    expect(String(logged.mock.calls[0]?.[0])).not.toContain("session-token-value");
  });

  it("authLog bounds the line it writes", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authLog("error", `Invalid callbackURL: ${"a".repeat(20_000)}`);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line.length).toBeLessThanOrEqual(MAX_LOG_CHARS + 40);
    expect(line.startsWith("[auth] Invalid callbackURL:")).toBe(true);
  });

  it("authLog writes nothing from the parameters of a failed query", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    authLog(
      "error",
      "Failed query: select 1\nparams: victim-token,1",
      new DrizzleQueryError("select 1 where a = $1", ["victim-token"], new Error("boom")),
    );
    expect(logged.mock.calls.flat().join(" ")).not.toContain("victim-token");
  });
});
