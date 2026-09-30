import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonical, compareCodePoints, sortByCodePoint } from "@/domain/canonical";
import { captureTimeMillis, formatCaptureTime } from "@/domain/capture-time";
import { DomainError, isDomainError } from "@/domain/errors";
import {
  buildView,
  decideImport,
  deriveEvents,
  type HistoryEntry,
  identifySnapshot,
  type Snapshot,
} from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";

const digestOf = (index: number): string => index.toString(16).padStart(64, "0");

function entry(index: number, capturedAt: string | null, isCurrent = false): HistoryEntry {
  return {
    snapshotDigest: digestOf(index),
    contentDigest: digestOf(1000 + index),
    capturedAt,
    declarations: { followers: false, following: false },
    isCurrent,
  };
}

function dated(day: number): string {
  return `2026-08-${String(day).padStart(2, "0")}T12:00:00+00:00`;
}

describe("DomainError", () => {
  it("carries a stable code next to the message", () => {
    const error = new DomainError("conflict", "Different rosters conflict at the same capture time.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DomainError");
    expect(error.code).toBe("conflict");
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(new Error("conflict"))).toBe(false);
  });
});

describe("hosted history bound", () => {
  const full = Array.from({ length: LIMITS.snapshotsPerProfile }, (_, index) =>
    entry(index, dated(index + 1), index === LIMITS.snapshotsPerProfile - 1),
  );
  const incoming = {
    snapshotDigest: digestOf(500),
    contentDigest: digestOf(1500),
    capturedAt: "2026-09-15T12:00:00+00:00",
    declarations: { followers: true, following: true },
  };

  it("holds thirty snapshots per profile", () => {
    expect(LIMITS.snapshotsPerProfile).toBe(30);
    expect(decideImport(full.slice(1), incoming).kind).toBe("append");
  });

  it("rejects a new snapshot at the bound with history_limit", () => {
    let code = "";
    try {
      decideImport(full, incoming);
    } catch (error) {
      code = (error as DomainError).code;
    }
    expect(code).toBe("history_limit");
  });

  it("still accepts a duplicate at the bound and strengthens its declarations", () => {
    const decision = decideImport(full, {
      ...full[3],
      declarations: { followers: true, following: false },
    });
    expect(decision).toMatchObject({
      kind: "duplicate",
      declarations: { followers: true, following: false },
      declarationsChanged: true,
      isCurrent: false,
      currentDigest: full[full.length - 1].snapshotDigest,
    });
  });

  it("reports a conflict before the bound", () => {
    let code = "";
    try {
      decideImport(full, { ...incoming, capturedAt: full[0].capturedAt });
    } catch (error) {
      code = (error as DomainError).code;
    }
    expect(code).toBe("conflict");
  });
});

describe("hosted event bound", () => {
  it("keeps at most the hosted number of export observations", async () => {
    const names = Array.from(
      { length: LIMITS.eventsPerProfile + 50 },
      (_, index) => `u${String(index).padStart(6, "0")}`,
    );
    const base: Snapshot = {
      followers: [],
      following: null,
      shards: { followers: [1], following: [] },
      capturedAt: "2026-09-01T12:00:00+00:00",
      declarations: { followers: true, following: false },
    };
    const snapshots = await Promise.all([
      identifySnapshot("atlas_studio", base),
      identifySnapshot("atlas_studio", { ...base, followers: names, capturedAt: "2026-09-10T12:00:00+00:00" }),
    ]);
    const events = await deriveEvents(snapshots);
    expect(events).toHaveLength(LIMITS.eventsPerProfile);
    expect(events[0]).toMatchObject({ type: "follower_observed_added", username: "u000000" });
    expect(new Set(events.map((event) => event.digest)).size).toBe(events.length);
  });
});

describe("buildView wording", () => {
  it("labels absence only as a user-declared export observation", () => {
    const view = buildView(
      {
        followers: ["nova_labs"],
        following: ["nova_labs", "pixel_forge"],
        shards: { followers: [1], following: [0] },
        capturedAt: "2026-09-30T06:00:00+00:00",
        declarations: { followers: true, following: true },
      },
      new Date("2026-09-30T12:00:00Z"),
    );
    expect(view.coverage.followers.independentlyVerified).toBe(false);
    expect(view.coverage.followers.basis).toBe("user_declared");
    expect(view.issues.map((issue) => issue.code)).toEqual(["username_identity"]);
    expect(JSON.stringify(view)).not.toMatch(/unfollowed|live|real time/i);
  });

  it("uses the hosted stale window", () => {
    const snapshot: Snapshot = {
      followers: [],
      following: [],
      shards: { followers: [1], following: [0] },
      capturedAt: "2026-09-01T00:00:00+00:00",
      declarations: { followers: true, following: true },
    };
    const captured = Date.parse("2026-09-01T00:00:00Z");
    expect(buildView(snapshot, new Date(captured + LIMITS.staleAfterMs)).status).toBe("ok");
    expect(buildView(snapshot, new Date(captured + LIMITS.staleAfterMs + 1)).status).toBe("stale");
  });
});

describe("capture time helpers", () => {
  it("round trips instants through the canonical form", () => {
    expect(captureTimeMillis("2026-09-01T12:00:00+00:00")).toBe(Date.parse("2026-09-01T12:00:00Z"));
    expect(formatCaptureTime(new Date(captureTimeMillis("1969-12-31T23:59:59+00:00")))).toBe(
      "1969-12-31T23:59:59+00:00",
    );
    expect(formatCaptureTime(new Date("0099-03-01T00:00:00.999Z"))).toBe("0099-03-01T00:00:00+00:00");
    expect(formatCaptureTime(new Date(-1))).toBe("1969-12-31T23:59:59+00:00");
  });

  it("rejects values that are not capture times", () => {
    expect(() => captureTimeMillis("yesterday")).toThrow(DomainError);
    expect(() => formatCaptureTime(new Date(Number.NaN))).toThrow(TypeError);
  });
});

describe("canonical", () => {
  it("refuses values Python would encode differently", () => {
    expect(() => canonical(1.5)).toThrow(TypeError);
    expect(() => canonical(2 ** 53)).toThrow(TypeError);
    expect(() => canonical(Number.NaN)).toThrow(TypeError);
    expect(() => canonical(undefined as unknown as null)).toThrow(TypeError);
  });

  it("writes negative zero as the integer zero", () => {
    expect(canonical([-0, 0])).toBe("[0,0]");
  });

  it("orders lone surrogates and astral characters by code point", () => {
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("a", "ab")).toBe(-1);
    expect(compareCodePoints("😀", "\ud83d￿")).toBe(1);
    expect(compareCodePoints("😀", "😁")).toBe(-1);
    expect(sortByCodePoint(["￿", "😀", "\ud800", "z"])).toEqual([
      "z",
      "\ud800",
      "￿",
      "😀",
    ]);
  });
});

describe("the following-list state machine stays out of the hosted app", () => {
  const source = fileURLToPath(new URL("../../../src", import.meta.url));

  function filesUnder(directory: string): string[] {
    const found: string[] = [];
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        found.push(...filesUnder(path));
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) {
        found.push(path);
      }
    }
    return found;
  }

  it("is imported by no route, page, service, or job", () => {
    const importers = filesUnder(source)
      .filter((path) => !path.includes(join("domain", "following")))
      .filter((path) => /following\/reconcile|domain\/following/.test(readFileSync(path, "utf8")));
    expect(importers).toEqual([]);
  });
});
