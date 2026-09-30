import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import { errorCodeOf } from "@/server/jobs/worker";

describe("errorCodeOf", () => {
  it("uses the stable code of a domain rule failure", () => {
    expect(errorCodeOf(new DomainError("invalid_capture_time", "The capture time must be valid."))).toBe(
      "invalid_capture_time",
    );
  });

  it("reports a failed database statement without its text or values", () => {
    const failure = Object.assign(new Error("Failed query: select 1 params: atlas@orbitdiff.test"), {
      query: "select 1",
      params: ["atlas@orbitdiff.test"],
    });

    expect(errorCodeOf(failure)).toBe("database_error");
  });

  it("gives every other failure one fixed code, never its message", () => {
    expect(errorCodeOf(new Error("atlas_studio could not be processed"))).toBe("handler_error");
    expect(errorCodeOf("a thrown string")).toBe("handler_error");
    expect(errorCodeOf(undefined)).toBe("handler_error");
  });
});
