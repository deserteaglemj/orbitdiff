import { describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import {
  identifySnapshot,
  type ImportValidationOptions,
  validateImportPayload,
} from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";

const NOW = new Date("2026-09-30T12:00:00Z");
const options: ImportValidationOptions = { account: "atlas_studio", now: NOW, limits: LIMITS };

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: "atlas_studio",
    capturedAt: "2026-09-01T12:00:00+00:00",
    completeFollowers: true,
    completeFollowing: false,
    followers: ["nova_labs"],
    following: ["nova_labs", "pixel_forge"],
    shards: { followers: [1], following: [0] },
    ...overrides,
  };
}

function codeOf(value: unknown, custom: ImportValidationOptions = options): string {
  try {
    validateImportPayload(value, custom);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
  throw new Error("expected the payload to be rejected");
}

describe("validateImportPayload", () => {
  it("returns the normalized import", () => {
    expect(validateImportPayload(payload(), options)).toEqual({
      account: "atlas_studio",
      capturedAt: "2026-09-01T12:00:00+00:00",
      followers: ["nova_labs"],
      following: ["nova_labs", "pixel_forge"],
      shards: { followers: [1], following: [0] },
      declarations: { followers: true, following: false },
    });
  });

  it("puts the capture time in canonical form", () => {
    expect(validateImportPayload(payload({ capturedAt: "2026-09-01T14:00:00.250+02:00" }), options).capturedAt).toBe(
      "2026-09-01T12:00:00+00:00",
    );
    expect(validateImportPayload(payload({ capturedAt: "2026-09-01T12:00:00.000Z" }), options).capturedAt).toBe(
      "2026-09-01T12:00:00+00:00",
    );
  });

  it("keeps an unknown capture time unknown", () => {
    expect(validateImportPayload(payload({ capturedAt: null }), options).capturedAt).toBeNull();
  });

  it("rejects a capture time beyond the tolerance or without a timezone", () => {
    expect(codeOf(payload({ capturedAt: "2026-09-30T12:05:01Z" }))).toBe("invalid_capture_time");
    expect(codeOf(payload({ capturedAt: "2026-09-01T12:00:00" }))).toBe("invalid_capture_time");
    expect(codeOf(payload({ capturedAt: 1756728000 }))).toBe("invalid_capture_time");
  });

  it("requires the payload account to be the profile handle", () => {
    expect(validateImportPayload(payload({ account: "Atlas_Studio" }), options).account).toBe("atlas_studio");
    expect(codeOf(payload({ account: "nova_labs" }))).toBe("owner_mismatch");
    expect(codeOf(payload({ account: "not a handle" }))).toBe("invalid_handle");
    expect(codeOf(payload({ account: null }))).toBe("invalid_handle");
  });

  it("rejects anything that is not a plain object with exactly the known keys", () => {
    for (const value of [null, undefined, "text", 7, [], [payload()]]) {
      expect(codeOf(value)).toBe("invalid_input");
    }
    expect(codeOf(payload({ extra: 1 }))).toBe("invalid_input");
    expect(codeOf(payload({ isAdmin: true }))).toBe("invalid_input");
    for (const key of Object.keys(payload())) {
      const incomplete = payload();
      delete incomplete[key];
      expect(codeOf(incomplete)).toBe("invalid_input");
    }
  });

  it("requires boolean declarations", () => {
    expect(codeOf(payload({ completeFollowers: "true" }))).toBe("invalid_input");
    expect(codeOf(payload({ completeFollowing: 1 }))).toBe("invalid_input");
    expect(codeOf(payload({ completeFollowing: null }))).toBe("invalid_input");
  });

  it.each([
    ["not a list", "nova_labs"],
    ["an object", { 0: "nova_labs" }],
    ["unsorted", ["pixel_forge", "nova_labs"]],
    ["duplicated", ["nova_labs", "nova_labs"]],
    ["a non-string entry", ["nova_labs", 5]],
    ["a sparse list", [, "nova_labs"]],
  ])("rejects a roster that is %s", (_label, followers) => {
    expect(codeOf(payload({ followers }))).toBe("invalid_input");
  });

  it("rejects usernames that are not normalized handles", () => {
    expect(codeOf(payload({ followers: ["Nova_Labs"] }))).toBe("invalid_handle");
    expect(codeOf(payload({ followers: ["bad-name"] }))).toBe("invalid_handle");
    expect(codeOf(payload({ following: ["..."] }))).toBe("invalid_handle");
    expect(codeOf(payload({ following: [" nova_labs"] }))).toBe("invalid_handle");
  });

  it("orders rosters by code point, not by locale", () => {
    const followers = ["0x", "_x", "a.b", "a_b", "ab"];
    expect(validateImportPayload(payload({ followers }), options).followers).toEqual(followers);
    expect(codeOf(payload({ followers: ["a_b", "a.b"] }))).toBe("invalid_input");
  });

  it("accepts one direction and keeps a present empty list distinct from a missing one", () => {
    const onlyFollowing = validateImportPayload(
      payload({ followers: null, shards: { followers: [], following: [0] } }),
      options,
    );
    expect(onlyFollowing.followers).toBeNull();
    const emptyFollowers = validateImportPayload(payload({ followers: [] }), options);
    expect(emptyFollowers.followers).toEqual([]);
  });

  it("requires shards exactly for the directions that are present", () => {
    expect(codeOf(payload({ followers: null }))).toBe("invalid_input");
    expect(codeOf(payload({ shards: { followers: [], following: [0] } }))).toBe("invalid_input");
    expect(
      codeOf(payload({ followers: null, following: null, shards: { followers: [], following: [] } })),
    ).toBe("invalid_input");
  });

  it.each([
    ["unsorted", [2, 1]],
    ["duplicated", [1, 1]],
    ["zero mixed with numbers", [0, 1]],
    ["negative", [-1]],
    ["above 9999", [10000]],
    ["fractional", [1.5]],
    ["text", ["1"]],
    ["not a list", 1],
    ["null", null],
  ])("rejects shard numbers that are %s", (_label, followers) => {
    expect(codeOf(payload({ shards: { followers, following: [0] } }))).toBe("invalid_input");
  });

  it("rejects malformed shard containers", () => {
    expect(codeOf(payload({ shards: null }))).toBe("invalid_input");
    expect(codeOf(payload({ shards: [[1], [0]] }))).toBe("invalid_input");
    expect(codeOf(payload({ shards: { followers: [1] } }))).toBe("invalid_input");
    expect(codeOf(payload({ shards: { followers: [1], following: [0], other: [] } }))).toBe("invalid_input");
  });

  it("accepts contiguous and gapped shard sets alike, leaving coverage to decide", () => {
    const gapped = validateImportPayload(payload({ shards: { followers: [1, 3], following: [0] } }), options);
    expect(gapped.shards.followers).toEqual([1, 3]);
  });

  it("bounds the number of usernames over both directions", () => {
    const limits = { ...LIMITS, accountsPerSnapshot: 3 };
    expect(codeOf(payload({ followers: ["ember_lab", "nova_labs"] }), { ...options, limits })).toBe("too_large");
    expect(validateImportPayload(payload(), { ...options, limits }).followers).toEqual(["nova_labs"]);
  });

  it("applies the hosted account bound", () => {
    const names = Array.from({ length: LIMITS.accountsPerSnapshot + 1 }, (_, index) => `u${String(index).padStart(6, "0")}`);
    expect(codeOf(payload({ followers: names, following: null, shards: { followers: [1], following: [] } }))).toBe(
      "too_large",
    );
    const fits = validateImportPayload(
      payload({ followers: names.slice(1), following: null, shards: { followers: [1], following: [] } }),
      options,
    );
    expect(fits.followers).toHaveLength(LIMITS.accountsPerSnapshot);
  });

  it("bounds the number of shard numbers", () => {
    const limits = { ...LIMITS, exportFiles: 2 };
    expect(codeOf(payload({ shards: { followers: [1, 2, 3], following: [0] } }), { ...options, limits })).toBe("too_large");
  });

  it("does not share arrays with the caller", () => {
    const input = payload();
    const result = validateImportPayload(input, options);
    (input.followers as string[]).push("zzz");
    (input.shards as { followers: number[] }).followers.push(9);
    expect(result.followers).toEqual(["nova_labs"]);
    expect(result.shards.followers).toEqual([1]);
  });

  it("feeds the digests the server computes itself", async () => {
    const normalized = validateImportPayload(payload({ completeFollowing: true, following: ["nova_labs"] }), options);
    const identified = await identifySnapshot(normalized.account, normalized);
    expect(identified.contentDigest).toBe("ab8673791dca32fe54cc6ea9fcd2e422af631ed4b70d3473c4f80d9a95edeb87");
    expect(identified.snapshotDigest).toBe("e36c94b001b2f9cd658f3cd2bfc5514e19072c4972ab0c33d0dff963301802d1");
  });

  it("never asks for credentials in its messages", () => {
    for (const bad of [null, payload({ extra: 1 }), payload({ followers: ["B"] }), payload({ shards: null })]) {
      let message = "";
      try {
        validateImportPayload(bad, options);
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        message = (error as DomainError).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toMatch(/password|cookie|session|verification code/i);
    }
  });
});
