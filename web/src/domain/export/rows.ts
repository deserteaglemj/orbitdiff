import { sortByCodePoint } from "../canonical";
import { DomainError, MESSAGES } from "../errors";
import { normalizeHandle } from "../handles";
import { exceedsCodePoints } from "../text";
import type { Direction } from "./files";
import { isJsonObject, type JsonValue, parseJsonStrict, pyTruthy } from "./json";
import { urlSplit } from "./urlsplit";

/**
 * Relationship row extraction, a port of `personal._rows`.
 * Row timestamps and every other key are never read.
 */
const OWNER_FIELDS = ["account", "username", "owner"] as const;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const LIST_MESSAGE = "The export must contain a bounded relationship list.";
const CONFLICT_MESSAGE = "A relationship entry contains conflicting handle fields.";
const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;
const LINK_PREFIX = "/_u/";
const MAX_LINK_LENGTH = 200;

function linkHandle(path: string): string {
  let rest = path.replace(TRAILING_SLASHES, "");
  if (rest.startsWith(LINK_PREFIX)) {
    rest = rest.slice(LINK_PREFIX.length);
  }
  return rest.replace(LEADING_SLASHES, "");
}

/**
 * Sorted, unique, lowercased handles of one relationship document.
 * `account` is the selected owner handle, already normalized.
 */
export function extractRows(
  payload: Uint8Array,
  direction: Direction,
  account: string,
  maxAccounts: number,
): string[] {
  let decoded: JsonValue | undefined = parseJsonStrict(payload);
  if (isJsonObject(decoded)) {
    for (const field of OWNER_FIELDS) {
      if (field in decoded) {
        let owner: JsonValue | undefined = decoded[field];
        if (isJsonObject(owner)) {
          owner = owner.username;
        }
        if (normalizeHandle(owner) !== account) {
          throw new DomainError("owner_mismatch", MESSAGES.ownerMismatch);
        }
      }
    }
    decoded = decoded[`relationships_${direction}`];
  }
  if (!Array.isArray(decoded)) {
    throw new DomainError("malformed_row", LIST_MESSAGE);
  }
  if (decoded.length > maxAccounts) {
    throw new DomainError("too_large", LIST_MESSAGE);
  }
  const handles = new Set<string>();
  for (const row of decoded) {
    if (!isJsonObject(row)) {
      throw new DomainError("malformed_row", "A relationship entry is malformed.");
    }
    const records = row.string_list_data;
    if (!Array.isArray(records) || records.length !== 1 || !isJsonObject(records[0])) {
      throw new DomainError("malformed_row", "A relationship entry needs one handle record.");
    }
    const record = records[0];
    const handle = normalizeHandle(pyTruthy(record.value) ? record.value : row.title);
    if (pyTruthy(row.title) && normalizeHandle(row.title) !== handle) {
      throw new DomainError("conflicting_handle", CONFLICT_MESSAGE);
    }
    const href = record.href;
    if (href !== undefined && href !== null) {
      if (typeof href !== "string" || exceedsCodePoints(href, MAX_LINK_LENGTH)) {
        throw new DomainError("malformed_row", "A relationship handle URL is malformed.");
      }
      const url = urlSplit(href);
      if (
        (url.scheme !== "http" && url.scheme !== "https") ||
        !INSTAGRAM_HOSTS.has(url.netloc.toLowerCase()) ||
        url.query !== "" ||
        url.fragment !== "" ||
        normalizeHandle(linkHandle(url.path)) !== handle
      ) {
        throw new DomainError("conflicting_handle", CONFLICT_MESSAGE);
      }
    }
    handles.add(handle);
  }
  return sortByCodePoint(handles);
}
