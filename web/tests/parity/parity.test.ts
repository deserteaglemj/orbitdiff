/**
 * Cross-language parity: every case in golden.json was produced by the real
 * Python implementation (web/scripts/parity_golden.py). The TypeScript port
 * must return the same result or raise the same message.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonical,
  type CanonicalValue,
  compareCodePoints,
  digest,
  sha256Hex,
  sortByCodePoint,
} from "@/domain/canonical";
import { formatCaptureTime, parseCaptureTime } from "@/domain/capture-time";
import { DomainError } from "@/domain/errors";
import { parseExportFiles } from "@/domain/export";
import {
  type ExportLimits,
  LOCAL_EXPORT_LIMITS,
  memberPath,
  parentOf,
  recognizeMember,
} from "@/domain/export/files";
import { type JsonObject, type JsonValue, parseJsonStrict } from "@/domain/export/json";
import {
  buildView,
  contentDigest,
  type Coverage,
  coverage,
  decideImport,
  deriveEvents,
  type HistoryEntry,
  identifySnapshot,
  type Snapshot,
  snapshotDigest,
} from "@/domain/export/snapshot";
import { decodeCp437, readZipMembers } from "@/domain/export/zip";
import {
  applyCollection,
  emptyGraphState,
  type FollowingCollection,
  type FollowingEvent,
  type GraphState,
  reconcile,
  rosterOf,
  validateCollection,
} from "@/domain/following/reconcile";
import { normalizeHandle } from "@/domain/handles";

type Outcome<T> = { ok: T; error?: undefined } | { error: string; ok?: undefined };
type Named = { name: string };

interface Golden {
  meta: { python: string; clock: string; default_limits: ExportLimits };
  handles: Array<Named & { value: unknown } & Outcome<string>>;
  capture: {
    now: string;
    cases: Array<Named & { value: unknown } & Outcome<string | null>>;
    python_only: Array<Named & { value: string; ok: string }>;
  };
  json: {
    cases: Array<Named & { input: ByteSpec } & Outcome<unknown>>;
    python_only: Array<Named & { input: ByteSpec; ok: string }>;
  };
  layout: Array<ParseCase & ParseOutcome>;
  shapes: Array<ParseCase & ParseOutcome>;
  hrefs: Array<ParseCase & ParseOutcome>;
  href_message_only: Array<ParseCase & ParseOutcome>;
  archives: {
    cases: Array<Named & { zip: string; limits: ExportLimits } & Outcome<Array<[string, ByteSpec]>>>;
    message_only: Array<Named & { zip: string; limits: ExportLimits; error: string }>;
    mutations: Array<
      Named & {
        zip: string;
        limits: ExportLimits;
        /** Offset and length of the member's DEFLATE data inside the archive. */
        start: number;
        length: number;
        /** The sentence Python raises for a change that is not listed below. */
        rejected: string;
        /** Changes Python still reads as the unchanged content: offset * 256 + value. */
        accepted: number[];
        /** Changes Python rejects with another sentence. */
        other: Array<[number, string]>;
      }
    >;
    parsed: Array<ParseCase & ParseOutcome>;
  };
  codepage: { cp437: string };
  reconcile: Array<{
    confirmed_present: boolean;
    pending_present: boolean | null;
    observed_present: boolean;
    kind: string;
    present: boolean | null;
    event_type: string | null;
  }>;
  collections: Array<Named & { collection: PythonCollection } & Outcome<boolean>>;
  apply: Array<
    Named & {
      steps: Array<{
        collection: PythonCollection;
        baseline_run: boolean;
        ok?: unknown[];
        error?: string;
        state: PythonGraph;
      }>;
    }
  >;
  replay: {
    target: string;
    steps: Array<{
      fixture: string;
      baseline_run: boolean;
      collected_at: string;
      ok: unknown[];
      state: PythonGraph;
    }>;
  };
  views: Array<
    Named & {
      account: string;
      now: string;
      snapshot: PythonSnapshot;
      view: { coverage_details: { followers: unknown; following: unknown } } & Record<string, unknown>;
    }
  >;
  store: Array<
    Named & {
      account: string;
      maxSnapshots: number;
      steps: Array<{
        input: {
          followers: string[] | null;
          following: string[] | null;
          shards: { followers: number[]; following: number[] };
          captured_at: string | null;
          complete_followers: boolean;
          complete_following: boolean;
        };
        imported_at: string;
        receipt?: Record<string, unknown>;
        error?: string;
        state: unknown;
      }>;
    }
  >;
  events: Array<
    Named & {
      account: string;
      cap: number;
      snapshots: PythonSnapshot[];
      events: Array<{ id: string } & Record<string, unknown>>;
    }
  >;
  members: Array<
    Named & { value: unknown } & Outcome<{
        path: string;
        parent: string;
        recognized: [string, number] | null;
      }>
  >;
  canonical: {
    cases: Array<Named & { value: CanonicalValue; canonical: string; digest: string }>;
    sorts: Array<Named & { value: string[]; sorted: string[] }>;
  };
}

const golden = JSON.parse(
  readFileSync(new URL("./golden.json", import.meta.url), "utf8"),
) as Golden;

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The port must raise a DomainError with exactly the Python message, or return the Python result. */
function expectSame<T>(expected: Outcome<T>, run: () => unknown): void {
  if (expected.error !== undefined) {
    const error = caught(run);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(expected.error);
    return;
  }
  expect(run()).toEqual(expected.ok);
}

describe("golden file", () => {
  it("holds only groups this file replays", () => {
    expect(Object.keys(golden).sort()).toEqual([
      "apply",
      "archives",
      "canonical",
      "capture",
      "codepage",
      "collections",
      "events",
      "handles",
      "href_message_only",
      "hrefs",
      "json",
      "layout",
      "members",
      "meta",
      "reconcile",
      "replay",
      "shapes",
      "store",
      "views",
    ]);
  });

  it("was generated by CPython 3.13 with the local limits", () => {
    expect(golden.meta.python).toBe("3.13");
    expect(golden.meta.default_limits).toEqual(LOCAL_EXPORT_LIMITS);
  });
});

describe("handles (personal._handle)", () => {
  for (const item of golden.handles) {
    it(item.name, () => {
      expectSame(item, () => normalizeHandle(item.value));
    });
  }
});

describe("canonical JSON and digests (personal._canonical, personal._digest)", () => {
  for (const item of golden.canonical.cases) {
    it(item.name, async () => {
      expect(canonical(item.value)).toBe(item.canonical);
      expect(await digest(item.value)).toBe(item.digest);
    });
  }

  it("hashes bytes and text alike", async () => {
    const vector = golden.canonical.cases[0];
    expect(await sha256Hex(new TextEncoder().encode(vector.canonical))).toBe(vector.digest);
    expect(await sha256Hex(vector.canonical)).toBe(vector.digest);
  });

  for (const item of golden.canonical.sorts) {
    it(`sorts by code point: ${item.name}`, () => {
      expect(sortByCodePoint(item.value)).toEqual(item.sorted);
    });
  }
});

describe("capture time (personal._capture with a fixed clock)", () => {
  const now = new Date(golden.capture.now);

  for (const item of golden.capture.cases) {
    it(item.name, () => {
      expectSame(item, () => parseCaptureTime(item.value, now));
    });
  }

  it("formats an instant in the canonical form", () => {
    expect(formatCaptureTime(new Date("2026-09-01T14:00:00.987+02:00"))).toBe(
      "2026-09-01T12:00:00+00:00",
    );
    expect(formatCaptureTime(now)).toBe(golden.capture.now);
  });

  describe("forms only Python accepts are rejected on purpose", () => {
    for (const item of golden.capture.python_only) {
      it(item.name, () => {
        expect(item.ok).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
        const error = caught(() => parseCaptureTime(item.value, now));
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("invalid_capture_time");
        expect((error as DomainError).message).toBe(
          "The capture time must be a valid, non-future timestamp with a timezone.",
        );
      });
    }
  });
});

describe("member paths (personal._member_path, personal._recognized)", () => {
  for (const item of golden.members) {
    it(item.name, () => {
      expectSame(item, () => {
        const parts = memberPath(item.value);
        const recognized = recognizeMember(parts);
        return {
          path: parts.join("/"),
          parent: parentOf(parts),
          recognized: recognized === null ? null : [recognized.direction, recognized.shard],
        };
      });
    });
  }
});

type ByteSpec =
  | { text: string }
  | { hex: string }
  | { nested: { open: string; close: string; depth: number; core: string } };

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesOf(blob: ByteSpec): Uint8Array {
  if ("hex" in blob) {
    return fromHex(blob.hex);
  }
  if ("text" in blob) {
    return new TextEncoder().encode(blob.text);
  }
  const { open, close, depth, core } = blob.nested;
  return new TextEncoder().encode(open.repeat(depth) + core + close.repeat(depth));
}

/** Renders a parsed value the way the generator tags Python values. */
function tagValue(value: JsonValue): unknown {
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return { $float: "nan" };
    }
    if (!Number.isFinite(value)) {
      return { $float: value > 0 ? "inf" : "-inf" };
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(tagValue);
  }
  if (value !== null && typeof value === "object") {
    return {
      $dict: Object.keys(value)
        .sort(compareCodePoints)
        .map((key) => [key, tagValue(value[key])]),
    };
  }
  return value;
}

/** Python integers beyond double precision are compared as the nearest double. */
function normalizeTagged(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeTagged);
  }
  if (value !== null && typeof value === "object") {
    const record = value as { $int?: string; $dict?: Array<[string, unknown]> };
    if (record.$int !== undefined) {
      return tagValue(Number(record.$int));
    }
    if (record.$dict !== undefined) {
      return {
        $dict: [...record.$dict]
          .sort((left, right) => compareCodePoints(left[0], right[0]))
          .map(([key, item]) => [key, normalizeTagged(item)]),
      };
    }
  }
  return value;
}

describe("strict JSON (personal._json)", () => {
  for (const item of golden.json.cases) {
    it(item.name, () => {
      if (item.error !== undefined) {
        expectSame(item, () => parseJsonStrict(bytesOf(item.input)));
      } else if (item.ok === "accepted" && "nested" in item.input) {
        expect(() => parseJsonStrict(bytesOf(item.input))).not.toThrow();
      } else {
        expect(tagValue(parseJsonStrict(bytesOf(item.input)))).toEqual(normalizeTagged(item.ok));
      }
    });
  }

  it("keeps a prototype key as plain data", () => {
    const parsed = parseJsonStrict(new TextEncoder().encode('{"__proto__":{"polluted":true}}'));
    expect(Object.keys(parsed as JsonObject)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  describe("nesting only Python accepts is rejected on purpose", () => {
    for (const item of golden.json.python_only) {
      it(item.name, () => {
        const error = caught(() => parseJsonStrict(bytesOf(item.input)));
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("malformed_json");
      });
    }
  });
});

interface ParseCase extends Named {
  account: string;
  limits: ExportLimits;
  files: Array<{ name: string } & ByteSpec>;
}

type ParseOutcome = Outcome<{
  values: { followers: string[] | null; following: string[] | null };
  shards: { followers: number[]; following: number[] };
}>;

function runParse(item: ParseCase): unknown {
  const files = item.files.map((file) => ({ name: file.name, bytes: bytesOf(file) }));
  const parsed = parseExportFiles(files, item.account, item.limits);
  return {
    values: { followers: parsed.followers, following: parsed.following },
    shards: parsed.shards,
  };
}

describe("export files (personal._parse_files)", () => {
  const groups: Array<[string, Array<ParseCase & ParseOutcome>]> = [
    ["file names, layout, and limits", golden.layout],
    ["document and row shapes", golden.shapes],
    ["row links", golden.hrefs],
    ["archives through the entry point", golden.archives.parsed],
  ];
  for (const [title, cases] of groups) {
    describe(title, () => {
      for (const item of cases) {
        it(item.name, () => {
          expectSame(item, () => runParse(item));
        });
      }
    });
  }

  describe("rows both sides reject with different wording", () => {
    for (const item of golden.href_message_only) {
      it(item.name, () => {
        expect(item.error).toBeDefined();
        const error = caught(() => runParse(item));
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).message).toBe(
          "A relationship entry contains conflicting handle fields.",
        );
      });
    }
  });
});

describe("archives (personal._zip_files)", () => {
  const asHex = (members: Array<[string, ByteSpec]>): Array<[string, string]> =>
    members.map(([name, blob]) => [name, toHex(bytesOf(blob))]);
  const read = (item: { zip: string; limits: ExportLimits }): Array<[string, string]> =>
    readZipMembers(fromHex(item.zip), item.limits).map((member) => [
      member.name,
      toHex(member.bytes),
    ]);

  for (const item of golden.archives.cases) {
    it(item.name, () => {
      if (item.error !== undefined) {
        expectSame(item, () => read(item));
      } else {
        expect(read(item)).toEqual(asHex(item.ok));
      }
    });
  }

  it("decodes legacy member names with code page 437 like Python", () => {
    const every = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(decodeCp437(every)).toBe(golden.codepage.cp437);
  });

  describe("archives both sides reject with different wording", () => {
    for (const item of golden.archives.message_only) {
      it(item.name, () => {
        expect(item.error).toBeDefined();
        const error = caught(() => read(item));
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe("unsupported_zip");
        expect((error as DomainError).message).toBe("The export ZIP could not be read safely.");
      });
    }
  });

  /**
   * The size and CRC-32 stay those of the original content, so only the
   * DEFLATE decoder can tell a damaged stream from a sound one. zlib rejects
   * streams that still decode to the right bytes; the port must agree on
   * every one of them.
   */
  describe("every single-byte change inside the DEFLATE data of a member", () => {
    for (const item of golden.archives.mutations) {
      it(item.name, () => {
        const payload = fromHex(item.zip);
        const unchanged = JSON.stringify(read(item));
        const accepted = new Set(item.accepted);
        const other = new Map(item.other);
        const wrong: string[] = [];
        let changes = 0;
        for (let offset = 0; offset < item.length; offset += 1) {
          const at = item.start + offset;
          const original = payload[at];
          for (let value = 0; value < 256; value += 1) {
            if (value === original) {
              continue;
            }
            payload[at] = value;
            changes += 1;
            const key = offset * 256 + value;
            const expected = accepted.has(key) ? "accepted" : (other.get(key) ?? item.rejected);
            let actual: string;
            try {
              const members = readZipMembers(payload, item.limits).map((member) => [
                member.name,
                toHex(member.bytes),
              ]);
              actual = JSON.stringify(members) === unchanged ? "accepted" : "other content";
            } catch (error) {
              actual = error instanceof DomainError ? error.message : `crash: ${String(error)}`;
            }
            if (actual !== expected && wrong.length < 12) {
              wrong.push(`offset ${offset} value ${value}: Python "${expected}", port "${actual}"`);
            }
          }
          payload[at] = original;
        }
        expect(wrong).toEqual([]);
        expect(changes).toBe(item.length * 255);
        expect(item.accepted.length).toBeGreaterThan(0);
      });
    }

    it("covers a stored, a fixed, a dynamic, and a multi-block stream", () => {
      expect(golden.archives.mutations.map((item) => item.name)).toEqual([
        "stored block",
        "fixed huffman block",
        "hand made dynamic block",
        "stream written by zlib in two flushed parts",
      ]);
    });
  });
});

interface PythonSnapshot {
  followers: string[] | null;
  following: string[] | null;
  captured_at: string | null;
  imported_at: string;
  shards: { followers: number[]; following: number[] };
  declarations: { followers: boolean; following: boolean };
  content_id: string;
  id: string;
}

function snapshotOf(item: PythonSnapshot): Snapshot {
  return {
    followers: item.followers,
    following: item.following,
    shards: item.shards,
    capturedAt: item.captured_at,
    declarations: item.declarations,
  };
}

function pythonCoverage(value: Coverage): Record<string, unknown> {
  return {
    present: value.present,
    complete: value.complete,
    declared_complete: value.declaredComplete,
    basis: value.basis,
    independently_verified: value.independentlyVerified,
    shards: value.shards,
    shards_contiguous: value.shardsContiguous,
    captured_at_known: value.capturedAtKnown,
  };
}

describe("coverage, view, and metrics (personal._coverage, personal._view)", () => {
  for (const item of golden.views) {
    it(item.name, async () => {
      const snapshot = snapshotOf(item.snapshot);
      const identified = await identifySnapshot(item.account, snapshot);
      expect(identified.contentDigest).toBe(item.snapshot.content_id);
      expect(identified.snapshotDigest).toBe(item.snapshot.id);
      expect(await contentDigest(item.account, snapshot)).toBe(item.snapshot.content_id);
      expect(await snapshotDigest(item.snapshot.content_id, snapshot.capturedAt)).toBe(
        item.snapshot.id,
      );

      const view = buildView(snapshot, new Date(item.now));
      expect({
        username: item.account,
        snapshot_id: identified.snapshotDigest,
        status: view.status,
        stale: view.stale,
        last_success_at: view.capturedAt,
        coverage: view.coverageLabel,
        coverage_details: {
          followers: pythonCoverage(view.coverage.followers),
          following: pythonCoverage(view.coverage.following),
        },
        metrics: {
          followers: view.metrics.followers,
          following: view.metrics.following,
          mutuals: view.metrics.mutuals,
          not_following_back: view.metrics.notFollowingBack,
          followers_observed: view.metrics.followersObserved,
          following_observed: view.metrics.followingObserved,
          reciprocal_unknown: view.metrics.reciprocalUnknown,
          unattributed_balance: null,
        },
        issues: view.issues,
        accounts: view.accounts.map((account) => ({
          username: account.username,
          following: account.following,
          followed_by: account.followedBy,
          relationship: account.relationship,
        })),
        capture_time_basis: view.captureTimeBasis,
      }).toEqual(item.view);
      expect(pythonCoverage(coverage(snapshot, "followers"))).toEqual(
        item.view.coverage_details.followers,
      );
    });
  }
});

interface StoredEntry extends HistoryEntry {
  importedAt: string;
}

describe("snapshot history decisions (personal._store)", () => {
  for (const scenario of golden.store) {
    it(scenario.name, async () => {
      let history: StoredEntry[] = [];
      for (const step of scenario.steps) {
        const input = step.input;
        let failure: unknown;
        try {
          const capturedAt = parseCaptureTime(input.captured_at, new Date(step.imported_at));
          const incoming = await identifySnapshot(scenario.account, {
            followers: input.followers,
            following: input.following,
            shards: input.shards,
            capturedAt,
            declarations: {
              followers: input.complete_followers,
              following: input.complete_following,
            },
          });
          const decision = decideImport(history, incoming, scenario.maxSnapshots);
          const stored = history.find((entry) => entry.snapshotDigest === decision.snapshotDigest);
          const resolved: StoredEntry = {
            snapshotDigest: decision.snapshotDigest,
            contentDigest: incoming.contentDigest,
            capturedAt,
            declarations: decision.declarations,
            isCurrent: false,
            importedAt:
              decision.kind === "duplicate" && stored !== undefined
                ? stored.importedAt
                : step.imported_at,
          };
          if (decision.kind === "append") {
            history = [...history, resolved];
          } else {
            const target = decision.kind === "enrich" ? decision.replaces : decision.snapshotDigest;
            history = history.map((entry) => (entry.snapshotDigest === target ? resolved : entry));
          }
          history = history.map((entry) => ({
            ...entry,
            isCurrent: entry.snapshotDigest === decision.currentDigest,
          }));
          expect({
            snapshot_id: decision.snapshotDigest,
            duplicate: decision.kind === "duplicate",
            provenance_enriched: decision.kind === "enrich",
            current: decision.isCurrent,
            captured_at: capturedAt,
            imported_at: resolved.importedAt,
          }).toEqual(step.receipt);
        } catch (error) {
          failure = error;
        }
        if (step.error !== undefined) {
          expect(failure).toBeInstanceOf(DomainError);
          expect((failure as DomainError).message).toBe(step.error);
        } else if (failure !== undefined) {
          throw failure;
        }
        expect({
          current: history.find((entry) => entry.isCurrent)?.snapshotDigest,
          snapshots: history.map((entry) => ({
            id: entry.snapshotDigest,
            content_id: entry.contentDigest,
            captured_at: entry.capturedAt,
            declarations: entry.declarations,
          })),
        }).toEqual(step.state);
      }
    });
  }
});

describe("export observations between snapshots (personal._events)", () => {
  for (const item of golden.events) {
    it(item.name, async () => {
      const snapshots = await Promise.all(
        item.snapshots.map((snapshot) => identifySnapshot(item.account, snapshotOf(snapshot))),
      );
      expect(snapshots.map((snapshot) => snapshot.snapshotDigest)).toEqual(
        item.snapshots.map((snapshot) => snapshot.id),
      );
      const events = await deriveEvents(snapshots, item.cap);
      expect(
        events.map((event) => ({
          id: event.digest,
          ts: event.intervalEnd,
          type: event.type,
          username: event.username,
          previous_captured_at: event.intervalStart,
          source: event.source,
          evidence: event.evidence,
        })),
      ).toEqual(item.events);
      for (const event of events) {
        expect(event.type.startsWith(event.direction === "followers" ? "follower_" : "following_")).toBe(true);
      }
    });
  }

  it("reproduces the recorded digests of the reference vectors", async () => {
    const vectors = golden.events.find((item) => item.name === "golden vectors a to b");
    expect(vectors?.events.map((event) => event.id)).toEqual([
      "8a2e9be2867da57ecb732af923f7aaabbc72898a796c749b41aa9764d65c2d1c",
      "661174b109fc73c70daf9c35da32f55f9b7a4bc1549b7befcdd2cfbb32e39e60",
      "09e1d591b5325de66eab1ea05271e69b69be6fd0c1076021e07dcd65dd6ceff4",
    ]);
    expect(vectors?.snapshots.map((snapshot) => snapshot.id)).toEqual([
      "e36c94b001b2f9cd658f3cd2bfc5514e19072c4972ab0c33d0dff963301802d1",
      "a8691b6ea74bc34445edcf68618473b79530c7ce561a61042942372521511048",
    ]);
  });
});

interface PythonCollection {
  target: string;
  reported_count: unknown;
  complete: unknown;
  collected_at: string;
  accounts: Array<[unknown, string]>;
}

interface PythonGraph {
  runs: unknown[];
  targets: Record<
    string,
    {
      initialized: boolean;
      confirmed_count: number | null;
      pending_count: number | null;
      roster: unknown[];
      events: unknown[];
    }
  >;
}

function collectionOf(item: PythonCollection): FollowingCollection {
  return {
    target: item.target,
    reportedCount: item.reported_count as number,
    complete: item.complete as boolean,
    collectedAt: item.collected_at,
    accounts: item.accounts.map(([profileId, username]) => ({
      profileId: profileId as string,
      username,
    })),
  };
}

function pythonEvent(event: FollowingEvent): Record<string, unknown> {
  return {
    event_type: event.eventType,
    target: event.target,
    actor_id: event.actorId,
    username: event.username,
    first_seen_at: event.firstSeenAt,
    confirmed_at: event.confirmedAt,
    run_id: event.runId,
  };
}

function pythonGraph(state: GraphState, targets: string[]): PythonGraph {
  const result: PythonGraph = {
    runs: state.runs.map((run) => ({
      id: run.id,
      target: run.target,
      state: run.state,
      run_kind: run.runKind,
      collected_at: run.collectedAt,
      reported_count: run.reportedCount,
      collected_count: run.collectedCount,
    })),
    targets: {},
  };
  for (const target of targets) {
    const roster = rosterOf(state, target);
    const initialized = state.targets.has(target);
    result.targets[target] = {
      initialized,
      confirmed_count: initialized ? roster.filter((row) => row.confirmedPresent).length : null,
      pending_count: initialized ? roster.filter((row) => row.pendingPresent !== null).length : null,
      roster: roster.map((row) => ({
        profile_id: row.profileId,
        username: row.username,
        confirmed_present: row.confirmedPresent,
        observed_present: row.observedPresent,
        pending_present: row.pendingPresent,
        pending_first_seen_at: row.pendingFirstSeenAt,
      })),
      events: state.events.filter((event) => event.target === target).map(pythonEvent),
    };
  }
  return result;
}

describe("public following-list state machine (diff.py, providers/base.py, store.py)", () => {
  describe("reconcile truth table", () => {
    for (const row of golden.reconcile) {
      const label = `confirmed ${row.confirmed_present}, pending ${row.pending_present}, observed ${row.observed_present}`;
      it(label, () => {
        expect(
          reconcile(
            { confirmedPresent: row.confirmed_present, pendingPresent: row.pending_present },
            row.observed_present,
          ),
        ).toEqual({ kind: row.kind, present: row.present, eventType: row.event_type });
      });
    }

    it("covers all twelve combinations", () => {
      expect(golden.reconcile).toHaveLength(12);
    });
  });

  describe("collection validation", () => {
    for (const item of golden.collections) {
      it(item.name, () => {
        expectSame(item, () => {
          validateCollection(collectionOf(item.collection));
          return true;
        });
      });
    }
  });

  describe("applying complete observations", () => {
    for (const scenario of golden.apply) {
      it(scenario.name, () => {
        let state = emptyGraphState();
        const targets: string[] = [];
        for (const step of scenario.steps) {
          if (!targets.includes(step.collection.target)) {
            targets.push(step.collection.target);
          }
          const before = state;
          const frozen = JSON.stringify(pythonGraph(before, targets));
          let failure: unknown;
          try {
            const applied = applyCollection(state, collectionOf(step.collection), {
              baselineRun: step.baseline_run,
            });
            expect(applied.events.map(pythonEvent)).toEqual(step.ok);
            state = applied.state;
          } catch (error) {
            failure = error;
          }
          if (step.error !== undefined) {
            expect(failure).toBeInstanceOf(DomainError);
            expect((failure as DomainError).message).toBe(step.error);
          } else if (failure !== undefined) {
            throw failure;
          }
          expect(pythonGraph(state, targets)).toEqual(step.state);
          expect(JSON.stringify(pythonGraph(before, targets))).toBe(frozen);
        }
      });
    }
  });

  it("replays the bundled fixtures: silent baseline, two pending edges, then two confirmed events", () => {
    const fixtures = new URL("../../../src/orbitdiff/fixtures/", import.meta.url);
    let state = emptyGraphState();
    const lines: string[] = [];
    for (const step of golden.replay.steps) {
      const fixture = JSON.parse(readFileSync(new URL(step.fixture, fixtures), "utf8")) as {
        target: string;
        reported_count: number;
        complete: boolean;
        accounts: Array<{ profile_id: string; username: string }>;
      };
      expect(fixture.target).toBe(golden.replay.target);
      const applied = applyCollection(
        state,
        {
          target: fixture.target,
          reportedCount: fixture.reported_count,
          complete: fixture.complete,
          collectedAt: step.collected_at,
          accounts: fixture.accounts.map((account) => ({
            profileId: account.profile_id,
            username: account.username,
          })),
        },
        { baselineRun: step.baseline_run },
      );
      state = applied.state;
      expect(applied.events.map(pythonEvent)).toEqual(step.ok);
      expect(pythonGraph(state, [golden.replay.target])).toEqual(step.state);
      lines.push(...applied.events.map((event) => `${event.eventType} ${event.username}`));
    }
    const pending = golden.replay.steps[1].state.targets[golden.replay.target];
    expect(golden.replay.steps[0].ok).toEqual([]);
    expect(pending.pending_count).toBe(2);
    expect(lines).toEqual(["following_stopped nova_labs", "following_started ember_lab"]);
  });
});
