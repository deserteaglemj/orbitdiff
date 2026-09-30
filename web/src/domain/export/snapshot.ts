import { compareCodePoints, digest, sortByCodePoint } from "../canonical";
import { captureTimeMillis, parseCaptureTime } from "../capture-time";
import { DomainError, MESSAGES } from "../errors";
import { normalizeHandle } from "../handles";
import { LIMITS } from "../limits";
import { type Direction, DIRECTIONS, type ShardSets } from "./files";

export type { Direction, ShardSets } from "./files";

/**
 * Snapshot identity, coverage, the store decision, the view, and the export
 * observations between dated snapshots. A port of the pure parts of
 * `personal.py` (`_content_id`, `_coverage`, `_store`, `_view`, `_events`).
 *
 * Everything here describes owner export observations. A difference between
 * two exports is an observation of those two files, never a live follow or
 * unfollow, and usernames are the only identity an export carries.
 */
export interface Declarations {
  followers: boolean;
  following: boolean;
}

export interface SnapshotContent {
  /** Sorted, unique, lowercase usernames; `null` when the direction was not supplied. */
  followers: string[] | null;
  following: string[] | null;
  shards: ShardSets;
}

export interface Snapshot extends SnapshotContent {
  /** Canonical capture time, or `null` when the owner did not declare one. */
  capturedAt: string | null;
  /** The owner's completeness declarations. */
  declarations: Declarations;
}

export interface SnapshotIdentity {
  contentDigest: string;
  snapshotDigest: string;
}

export type IdentifiedSnapshot = Snapshot & SnapshotIdentity;

/** The body of `POST /api/profiles/:id/imports`. */
export interface ImportPayload {
  account: string;
  capturedAt: string | null;
  completeFollowers: boolean;
  completeFollowing: boolean;
  followers: string[] | null;
  following: string[] | null;
  shards: ShardSets;
}

export interface NormalizedImport extends Snapshot {
  account: string;
}

export interface ImportValidationOptions {
  /** The handle of the profile that receives the import. */
  account: string;
  now: Date;
  limits: { accountsPerSnapshot: number; exportFiles: number };
}

// ---------------------------------------------------------------- identity

/** `personal._content_id`: completeness declarations and import time are not part of it. */
export async function contentDigest(account: string, content: SnapshotContent): Promise<string> {
  return digest([
    account,
    content.followers,
    content.following,
    { followers: content.shards.followers, following: content.shards.following },
  ]);
}

/** The snapshot id: the content digest bound to the capture time. */
export async function snapshotDigest(
  contentDigestValue: string,
  capturedAt: string | null,
): Promise<string> {
  return digest([contentDigestValue, capturedAt]);
}

export async function identifySnapshot<T extends Snapshot>(
  account: string,
  snapshot: T,
): Promise<T & SnapshotIdentity> {
  const content = await contentDigest(account, snapshot);
  return {
    ...snapshot,
    contentDigest: content,
    snapshotDigest: await snapshotDigest(content, snapshot.capturedAt),
  };
}

// ---------------------------------------------------------------- import payload

const PAYLOAD_KEYS = [
  "account",
  "capturedAt",
  "completeFollowers",
  "completeFollowing",
  "followers",
  "following",
  "shards",
] as const;
const MAX_SHARD = 9999;

const PAYLOAD_MESSAGES = {
  shape: "The import request is malformed.",
  roster: "Relationship lists must be sorted, unique, lowercase usernames.",
  shards:
    "Shard lists must be sorted, unique numbers from 0 to 9999, and an unsuffixed file cannot be mixed with numbered files.",
  presence: "Shard numbers must be supplied exactly for the directions that are present.",
  direction: "An import needs at least one of followers or following.",
  shardCount: "The import lists too many relationship files.",
} as const;

function invalid(message: string): never {
  throw new DomainError("invalid_input", message);
}

function plainRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(PAYLOAD_MESSAGES.shape);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(PAYLOAD_MESSAGES.shape);
  }
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return invalid(PAYLOAD_MESSAGES.shape);
  }
  return value as Record<string, unknown>;
}

function validRoster(value: unknown): string[] | null {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return invalid(PAYLOAD_MESSAGES.roster);
  }
  const roster: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "string") {
      return invalid(PAYLOAD_MESSAGES.roster);
    }
    if (normalizeHandle(entry) !== entry) {
      throw new DomainError("invalid_handle", MESSAGES.handle);
    }
    if (index > 0 && compareCodePoints(roster[index - 1], entry) >= 0) {
      return invalid(PAYLOAD_MESSAGES.roster);
    }
    roster.push(entry);
  }
  return roster;
}

function validShards(value: unknown, maxFiles: number): number[] {
  if (!Array.isArray(value)) {
    return invalid(PAYLOAD_MESSAGES.shards);
  }
  if (value.length > maxFiles) {
    throw new DomainError("too_large", PAYLOAD_MESSAGES.shardCount);
  }
  const shards: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > MAX_SHARD) {
      return invalid(PAYLOAD_MESSAGES.shards);
    }
    if (index > 0 && shards[index - 1] >= entry) {
      return invalid(PAYLOAD_MESSAGES.shards);
    }
    shards.push(entry);
  }
  if (shards.length > 1 && shards[0] === 0) {
    return invalid(PAYLOAD_MESSAGES.shards);
  }
  return shards;
}

/**
 * Re-validates an untrusted, already normalized import. Nothing is repaired:
 * a list that is not sorted, unique, and lowercase is rejected. The caller
 * computes the digests from the returned value with `identifySnapshot`.
 */
export function validateImportPayload(
  payload: unknown,
  options: ImportValidationOptions,
): NormalizedImport {
  const body = plainRecord(payload, PAYLOAD_KEYS);
  const account = normalizeHandle(body.account);
  if (account !== options.account) {
    throw new DomainError("owner_mismatch", MESSAGES.ownerMismatch);
  }
  if (typeof body.completeFollowers !== "boolean" || typeof body.completeFollowing !== "boolean") {
    return invalid(MESSAGES.declarations);
  }
  const capturedAt = parseCaptureTime(body.capturedAt, options.now);
  const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  if (lengthOf(body.followers) + lengthOf(body.following) > options.limits.accountsPerSnapshot) {
    throw new DomainError("too_large", MESSAGES.accountCount);
  }
  const followers = validRoster(body.followers);
  const following = validRoster(body.following);
  const shardBody = plainRecord(body.shards, DIRECTIONS);
  const shards: ShardSets = {
    followers: validShards(shardBody.followers, options.limits.exportFiles),
    following: validShards(shardBody.following, options.limits.exportFiles),
  };
  if ((shards.followers.length > 0) !== (followers !== null) || (shards.following.length > 0) !== (following !== null)) {
    return invalid(PAYLOAD_MESSAGES.presence);
  }
  if (followers === null && following === null) {
    return invalid(PAYLOAD_MESSAGES.direction);
  }
  return {
    account,
    capturedAt,
    followers,
    following,
    shards,
    declarations: { followers: body.completeFollowers, following: body.completeFollowing },
  };
}

// ---------------------------------------------------------------- coverage

export interface Coverage {
  present: boolean;
  /** Effective complete coverage: present, contiguous shards, known capture time, declared. */
  complete: boolean;
  declaredComplete: boolean;
  basis: "user_declared" | "unknown";
  /** Always false: completeness is the owner's assertion. */
  independentlyVerified: false;
  shards: number[];
  shardsContiguous: boolean;
  capturedAtKnown: boolean;
}

function contiguous(shards: readonly number[]): boolean {
  if (shards.length === 0) {
    return false;
  }
  if (shards.length === 1 && shards[0] === 0) {
    return true;
  }
  return shards.every((shard, index) => shard === index + 1);
}

/** `personal._coverage`. */
export function coverage(snapshot: Snapshot, direction: Direction): Coverage {
  const shards = snapshot.shards[direction];
  const present = snapshot[direction] !== null;
  const shardsContiguous = contiguous(shards);
  const declaredComplete = snapshot.declarations[direction];
  const capturedAtKnown = snapshot.capturedAt !== null;
  const complete = present && shardsContiguous && capturedAtKnown && declaredComplete;
  return {
    present,
    complete,
    declaredComplete,
    basis: complete ? "user_declared" : "unknown",
    independentlyVerified: false,
    shards: [...shards],
    shardsContiguous,
    capturedAtKnown,
  };
}

// ---------------------------------------------------------------- store decision

export interface HistoryEntry extends SnapshotIdentity {
  capturedAt: string | null;
  declarations: Declarations;
  isCurrent: boolean;
}

export interface IncomingSnapshot extends SnapshotIdentity {
  capturedAt: string | null;
  declarations: Declarations;
}

export interface ImportDecision {
  /**
   * `duplicate`: the snapshot is already stored; only declarations may strengthen.
   * `enrich`: a stored undated snapshot with the same content is replaced in place.
   * `append`: a new snapshot joins the history.
   */
  kind: "duplicate" | "enrich" | "append";
  /** Digest of the snapshot the import resolves to. */
  snapshotDigest: string;
  /** For `enrich`, the digest of the undated snapshot that is replaced. */
  replaces: string | null;
  /** Declarations the resolved snapshot holds afterwards. */
  declarations: Declarations;
  /** True when a duplicate strengthened a declaration. */
  declarationsChanged: boolean;
  /** Digest of the current snapshot afterwards. */
  currentDigest: string;
  /** Whether the resolved snapshot is the current one afterwards. */
  isCurrent: boolean;
}

/**
 * The decision of `personal._store` for one import against the stored
 * history. Raises `conflict` or `history_limit`; changes nothing itself.
 */
export function decideImport(
  history: readonly HistoryEntry[],
  incoming: IncomingSnapshot,
  maxSnapshots: number = LIMITS.snapshotsPerProfile,
): ImportDecision {
  const current = history.find((entry) => entry.isCurrent);
  const duplicate = history.find((entry) => entry.snapshotDigest === incoming.snapshotDigest);
  const enriched =
    incoming.capturedAt === null
      ? undefined
      : history.find(
          (entry) => entry.contentDigest === incoming.contentDigest && entry.capturedAt === null,
        );
  if (
    incoming.capturedAt !== null &&
    history.some(
      (entry) =>
        entry.capturedAt === incoming.capturedAt && entry.contentDigest !== incoming.contentDigest,
    )
  ) {
    throw new DomainError("conflict", "Different rosters conflict at the same capture time.");
  }

  let kind: ImportDecision["kind"];
  let declarations: Declarations = { ...incoming.declarations };
  let declarationsChanged = false;
  let replaces: string | null = null;
  if (duplicate !== undefined) {
    kind = "duplicate";
    declarations = {
      followers: duplicate.declarations.followers || incoming.declarations.followers,
      following: duplicate.declarations.following || incoming.declarations.following,
    };
    declarationsChanged =
      declarations.followers !== duplicate.declarations.followers ||
      declarations.following !== duplicate.declarations.following;
  } else if (enriched !== undefined) {
    kind = "enrich";
    replaces = enriched.snapshotDigest;
  } else {
    if (history.length >= maxSnapshots) {
      throw new DomainError(
        "history_limit",
        "The personal history limit is reached; preserve this workspace and start a new one.",
      );
    }
    kind = "append";
  }

  const becomesCurrent =
    current === undefined ||
    (incoming.capturedAt !== null &&
      (current.capturedAt === null || incoming.capturedAt > current.capturedAt));
  const currentDigest =
    becomesCurrent || current === undefined ? incoming.snapshotDigest : current.snapshotDigest;
  return {
    kind,
    snapshotDigest: incoming.snapshotDigest,
    replaces,
    declarations,
    declarationsChanged,
    currentDigest,
    isCurrent: currentDigest === incoming.snapshotDigest,
  };
}

// ---------------------------------------------------------------- view

export type Relationship = "mutual" | "not_following_back" | "follows_you" | "unknown";

export interface RelationshipRow {
  username: string;
  /** The owner follows them. `null` when unknown. */
  following: boolean | null;
  /** They follow the owner. `null` when unknown. */
  followedBy: boolean | null;
  relationship: Relationship;
}

export interface ExportMetrics {
  followers: number | null;
  following: number | null;
  mutuals: number | null;
  notFollowingBack: number | null;
  followersObserved: number | null;
  followingObserved: number | null;
  reciprocalUnknown: number | null;
}

export interface Issue {
  code: string;
  message: string;
}

export interface ExportView {
  status: "degraded" | "stale" | "ok";
  stale: boolean;
  capturedAt: string | null;
  captureTimeBasis: "user_declared" | "unknown";
  coverage: Record<Direction, Coverage>;
  coverageLabel: string;
  accounts: RelationshipRow[];
  metrics: ExportMetrics;
  issues: Issue[];
}

function relationshipOf(following: boolean | null, followedBy: boolean | null): Relationship {
  if (following === true && followedBy === true) {
    return "mutual";
  }
  if (following === true && followedBy === false) {
    return "not_following_back";
  }
  if (following === false && followedBy === true) {
    return "follows_you";
  }
  return "unknown";
}

function coverageWord(value: Coverage): string {
  return value.complete ? "user-declared complete" : value.present ? "partial" : "missing";
}

/**
 * `personal._view` for one snapshot. Absence is stated only for a direction
 * with effective complete coverage; everything else stays unknown.
 */
export function buildView(snapshot: Snapshot, now: Date): ExportView {
  const covered: Record<Direction, Coverage> = {
    followers: coverage(snapshot, "followers"),
    following: coverage(snapshot, "following"),
  };
  const followers = new Set(snapshot.followers ?? []);
  const following = new Set(snapshot.following ?? []);
  const accounts: RelationshipRow[] = [];
  let mutuals = 0;
  let notFollowingBack = 0;
  let reciprocalUnknown = 0;
  for (const username of sortByCodePoint(new Set([...followers, ...following]))) {
    const outbound = following.has(username) ? true : covered.following.complete ? false : null;
    const inbound = followers.has(username) ? true : covered.followers.complete ? false : null;
    const relationship = relationshipOf(outbound, inbound);
    if (outbound === true && inbound === true) {
      mutuals += 1;
    }
    if (relationship === "not_following_back") {
      notFollowingBack += 1;
    }
    if (outbound === true && inbound === null) {
      reciprocalUnknown += 1;
    }
    accounts.push({ username, following: outbound, followedBy: inbound, relationship });
  }

  const captured = snapshot.capturedAt;
  const stale =
    captured === null || now.getTime() - captureTimeMillis(captured) > LIMITS.staleAfterMs;
  const complete = covered.followers.complete && covered.following.complete;
  const issues: Issue[] = [];
  if (captured === null) {
    issues.push({
      code: "capture_time_unknown",
      message: "The export capture time is unknown; relationship timestamps are not snapshot dates.",
    });
  }
  for (const direction of DIRECTIONS) {
    if (!covered[direction].complete) {
      issues.push({
        code: `${direction}_coverage_unknown`,
        message: `The ${direction} export is missing or not declared complete with a known capture time; missing relationships remain unknown.`,
      });
    }
  }
  issues.push({
    code: "username_identity",
    message:
      "Exports identify usernames, so a username change cannot be proven to be a new person or a removed relationship.",
  });

  return {
    status: !complete ? "degraded" : stale ? "stale" : "ok",
    stale,
    capturedAt: captured,
    captureTimeBasis: captured === null ? "unknown" : "user_declared",
    coverage: covered,
    coverageLabel: DIRECTIONS.map((direction) => `${direction} ${coverageWord(covered[direction])}`).join("; "),
    accounts,
    metrics: {
      followers: covered.followers.complete ? followers.size : null,
      following: covered.following.complete ? following.size : null,
      mutuals: covered.followers.present && covered.following.present ? mutuals : null,
      notFollowingBack:
        covered.followers.complete && covered.following.present ? notFollowingBack : null,
      followersObserved: covered.followers.present ? followers.size : null,
      followingObserved: covered.following.present ? following.size : null,
      reciprocalUnknown: covered.following.present ? reciprocalUnknown : null,
    },
    issues,
  };
}

// ---------------------------------------------------------------- export observations

export type ExportEventType =
  | "follower_observed_added"
  | "follower_observed_removed"
  | "following_observed_added"
  | "following_observed_removed";

export interface ExportEvent {
  /** `sha256(canonical([previous digest, current digest, type, username]))`. */
  digest: string;
  type: ExportEventType;
  direction: Direction;
  username: string;
  /** Capture time of the earlier export. */
  intervalStart: string;
  /** Capture time of the later export. */
  intervalEnd: string;
  source: "export_observation";
  evidence: "observed";
}

const EVENT_PREFIX: Record<Direction, "follower" | "following"> = {
  followers: "follower",
  following: "following",
};

/**
 * `personal._events`: differences between consecutive dated snapshots, newest
 * pair first. Additions need the earlier direction complete; removals need
 * the later direction complete. Undated snapshots never take part. The result
 * is a pure function of the whole dated history, so it is recomputed, never
 * patched, when the history changes.
 */
export async function deriveEvents(
  snapshots: readonly IdentifiedSnapshot[],
  cap: number = LIMITS.eventsPerProfile,
): Promise<ExportEvent[]> {
  const known = snapshots
    .filter((snapshot) => snapshot.capturedAt !== null)
    .sort((left, right) => {
      const a = left.capturedAt as string;
      const b = right.capturedAt as string;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const events: ExportEvent[] = [];
  for (let index = known.length - 2; index >= 0; index -= 1) {
    const previous = known[index];
    const current = known[index + 1];
    for (const direction of DIRECTIONS) {
      const earlier = previous[direction];
      const later = current[direction];
      if (earlier === null || later === null) {
        continue;
      }
      const before = new Set(earlier);
      const after = new Set(later);
      const changes: Array<["added" | "removed", string[]]> = [
        [
          "added",
          coverage(previous, direction).complete ? later.filter((name) => !before.has(name)) : [],
        ],
        [
          "removed",
          coverage(current, direction).complete ? earlier.filter((name) => !after.has(name)) : [],
        ],
      ];
      for (const [change, usernames] of changes) {
        for (const username of sortByCodePoint(new Set(usernames))) {
          const type = `${EVENT_PREFIX[direction]}_observed_${change}` as ExportEventType;
          events.push({
            digest: await digest([previous.snapshotDigest, current.snapshotDigest, type, username]),
            type,
            direction,
            username,
            intervalStart: previous.capturedAt as string,
            intervalEnd: current.capturedAt as string,
            source: "export_observation",
            evidence: "observed",
          });
          if (events.length >= cap) {
            return events;
          }
        }
      }
    }
  }
  return events;
}
