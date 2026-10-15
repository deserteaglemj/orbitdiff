import { sortByCodePoint } from "../canonical";
import { DomainError, MESSAGES } from "../errors";
import { normalizeHandle } from "../handles";
import {
  type Direction,
  type ExportFile,
  type ExportLimits,
  HOSTED_EXPORT_LIMITS,
  memberPath,
  RecognizedFiles,
  recognizeMember,
  type ShardSets,
} from "./files";
import { extractRows } from "./rows";
import { readZipMembers } from "./zip";

export type { Direction, ExportFile, ExportLimits, ShardSets } from "./files";
export { HOSTED_EXPORT_LIMITS, LOCAL_EXPORT_LIMITS } from "./files";

/**
 * What an owner export yields: usernames per direction and the shard numbers
 * that supplied them. A direction with no file is `null`, which is not the
 * same as a present, empty list.
 */
export interface ParsedExport {
  followers: string[] | null;
  following: string[] | null;
  shards: ShardSets;
}

const BOUNDED_MESSAGE = "Supply a bounded export ZIP or relationship JSON files.";

function isBytes(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

/**
 * Parses one ZIP, or named relationship JSON files, entirely in memory.
 * A port of `personal._parse_files`; `account` is the selected owner handle.
 * Only recognized follower and following files are decoded.
 */
export function parseExportFiles(
  files: readonly ExportFile[],
  account: string,
  limits: ExportLimits = HOSTED_EXPORT_LIMITS,
): ParsedExport {
  const owner = normalizeHandle(account);
  if (!Array.isArray(files) || files.length === 0) {
    throw new DomainError("nothing_recognized", BOUNDED_MESSAGE);
  }
  if (files.length > limits.maxFiles) {
    throw new DomainError("too_large", BOUNDED_MESSAGE);
  }
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    memberPath(file.name);
    if (!isBytes(file.bytes)) {
      throw new DomainError("invalid_input", "Imported file content must be bytes.");
    }
    if (names.has(file.name)) {
      throw new DomainError("invalid_input", "Duplicate import file names are not accepted.");
    }
    names.add(file.name);
    total += file.bytes.length;
  }
  if (total > limits.maxInputBytes) {
    throw new DomainError("too_large", "The upload exceeds the import size limit.");
  }
  let entries: readonly ExportFile[] = files;
  const archives = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
  if (archives.length > 0) {
    if (files.length !== 1) {
      throw new DomainError(
        "invalid_input",
        "Supply one ZIP, or named relationship JSON files, not both.",
      );
    }
    entries = readZipMembers(archives[0].bytes, limits);
  }
  const recognized = new RecognizedFiles();
  const values: Partial<Record<Direction, Set<string>>> = {};
  for (const entry of entries) {
    const parts = memberPath(entry.name);
    const member = recognizeMember(parts);
    if (member === null) {
      continue;
    }
    if (entry.bytes.length > limits.maxFileBytes) {
      throw new DomainError("too_large", "The relationship file exceeds the import size limit.");
    }
    recognized.add(parts, member);
    const handles = values[member.direction] ?? new Set<string>();
    values[member.direction] = handles;
    for (const handle of extractRows(entry.bytes, member.direction, owner, limits.maxAccounts)) {
      handles.add(handle);
    }
    if ((values.followers?.size ?? 0) + (values.following?.size ?? 0) > limits.maxAccounts) {
      throw new DomainError("too_large", MESSAGES.accountCount);
    }
  }
  if (values.followers === undefined && values.following === undefined) {
    throw new DomainError(
      "nothing_recognized",
      "No recognized followers or following JSON files were found.",
    );
  }
  return {
    followers: values.followers === undefined ? null : sortByCodePoint(values.followers),
    following: values.following === undefined ? null : sortByCodePoint(values.following),
    shards: recognized.shards(),
  };
}
