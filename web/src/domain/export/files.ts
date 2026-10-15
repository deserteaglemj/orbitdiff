import { DomainError } from "../errors";
import { LIMITS } from "../limits";
import { exceedsCodePoints } from "../text";

/**
 * Member path safety, recognized relationship file names, and the shard and
 * single-root rules of `personal._parse_files`.
 */
export type Direction = "followers" | "following";

export const DIRECTIONS: readonly Direction[] = ["followers", "following"];

export interface ShardSets {
  followers: number[];
  following: number[];
}

export interface ExportLimits {
  /** Bytes of one recognized file, raw or decompressed. */
  maxFileBytes: number;
  /** Sum of the supplied bytes, and sum of recognized decompressed ZIP members. */
  maxInputBytes: number;
  /** Supplied files, and ZIP central directory entries. */
  maxFiles: number;
  /** Rows in one list, and distinct usernames over both directions. */
  maxAccounts: number;
}

/** Bounds of the hosted app. Lower than the local importer where the hosted store is smaller. */
export const HOSTED_EXPORT_LIMITS: Readonly<ExportLimits> = Object.freeze({
  maxFileBytes: LIMITS.exportFileBytes,
  maxInputBytes: LIMITS.exportInputBytes,
  maxFiles: LIMITS.exportFiles,
  maxAccounts: LIMITS.accountsPerSnapshot,
});

/** Bounds of the local Python importer (`personal.MAX_*`). */
export const LOCAL_EXPORT_LIMITS: Readonly<ExportLimits> = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxInputBytes: 32 * 1024 * 1024,
  maxFiles: 1024,
  maxAccounts: 100_000,
});

export interface RecognizedMember {
  direction: Direction;
  /** The numeric suffix, or 0 for a file without one. */
  shard: number;
}

const MEMBER_NAME = /^(followers|following)(?:_([1-9][0-9]{0,3}))?\.json$/;
const RELATIONSHIP_FOLDER = "followers_and_following";
const CONTROL = /[\u0000-\u001f\u007f]/;
const TRAILING_SLASHES = /\/+$/;

function isProtected(part: string): boolean {
  const lowered = part.toLowerCase();
  return lowered === ".ssh" || lowered === ".env" || lowered.startsWith(".env.");
}

/**
 * `personal._member_path`. Returns the path segments of a safe member name.
 * A trailing slash run is dropped, as `PurePosixPath` does.
 */
export function memberPath(name: unknown): string[] {
  if (typeof name !== "string" || name === "" || exceedsCodePoints(name, 1024)) {
    throw new DomainError("unsafe_path", "Invalid import member path.");
  }
  const parts = name.replace(TRAILING_SLASHES, "").split("/");
  if (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes(":") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    CONTROL.test(name) ||
    parts.length > 16 ||
    parts.some((part) => exceedsCodePoints(part, 255))
  ) {
    throw new DomainError("unsafe_path", "Unsafe import member path.");
  }
  if (parts.some(isProtected)) {
    throw new DomainError("unsafe_path", "A protected path is not accepted inside an export.");
  }
  return parts;
}

/** `str(path.parent)`: "." for a name at the root of the supplied set. */
export function parentOf(parts: readonly string[]): string {
  return parts.length <= 1 ? "." : parts.slice(0, -1).join("/");
}

/**
 * `personal._recognized`. A recognized name counts at the root of the set or
 * directly inside a folder named `followers_and_following`.
 */
export function recognizeMember(parts: readonly string[]): RecognizedMember | null {
  const match = MEMBER_NAME.exec(parts[parts.length - 1] ?? "");
  if (match === null) {
    return null;
  }
  if (parts.length > 1 && parts[parts.length - 2] !== RELATIONSHIP_FOLDER) {
    return null;
  }
  return {
    direction: match[1] as Direction,
    shard: match[2] === undefined ? 0 : Number(match[2]),
  };
}

/**
 * Tracks the recognized files of one import: they must share one parent path,
 * a shard cannot repeat, and an unsuffixed file cannot mix with numbered ones.
 */
export class RecognizedFiles {
  private parent: string | null = null;
  private readonly seen: ShardSets = { followers: [], following: [] };

  add(parts: readonly string[], member: RecognizedMember): void {
    const parent = parentOf(parts);
    if (this.parent !== null && this.parent !== parent) {
      throw new DomainError(
        "ambiguous_roots",
        "Multiple export roots are ambiguous; import one account scope at a time.",
      );
    }
    this.parent = parent;
    const shards = this.seen[member.direction];
    if (
      shards.includes(member.shard) ||
      (shards.length > 0 && (member.shard === 0 || shards.includes(0)))
    ) {
      throw new DomainError("overlapping_shards", "Overlapping relationship shards are ambiguous.");
    }
    shards.push(member.shard);
  }

  /** Shard numbers per direction, ascending. */
  shards(): ShardSets {
    return {
      followers: [...this.seen.followers].sort((a, b) => a - b),
      following: [...this.seen.following].sort((a, b) => a - b),
    };
  }
}

/** One supplied file: a name relative to the selected set, and its bytes. */
export interface ExportFile {
  name: string;
  bytes: Uint8Array;
}
