import "server-only";

import { isDomainError } from "@/domain/errors";
import { LIMITS } from "@/domain/limits";
import { AppError, type ErrorCode } from "@/server/http/errors";

import type { Page } from "./contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The one answer for an object the caller cannot see. An id that does not
 * exist, an id that belongs to another user, and a malformed id all produce
 * exactly this error, so the three cannot be told apart.
 */
export function notFound(): AppError {
  return new AppError("not_found", "Not found.");
}

/** A path or query id, lowercased. Anything that is not a UUID is `not_found`, never a database error. */
export function requireUuid(value: unknown): string {
  if (!isUuid(value)) throw notFound();
  return value.toLowerCase();
}

/** Domain rule failures that are not plain invalid input. */
const DOMAIN_CODES: Partial<Record<string, ErrorCode>> = {
  conflict: "conflict",
  history_limit: "quota_exhausted",
};

const DOMAIN_MESSAGES: Partial<Record<string, string>> = {
  history_limit: `This profile already holds ${LIMITS.snapshotsPerProfile} imports, which is the limit.`,
  conflict: "A different export is already stored for that capture time.",
};

/**
 * Re-throw a domain rule failure as the API error it stands for. The domain
 * message is a fixed sentence, never input. Anything else is re-thrown as is.
 */
export function rethrowDomainError(error: unknown): never {
  if (isDomainError(error)) {
    const code = DOMAIN_CODES[error.code] ?? "invalid_input";
    throw new AppError(code, DOMAIN_MESSAGES[error.code] ?? error.message, { reason: error.code });
  }
  throw error;
}

export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface PageWindow {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Bounds applied inside every list service, so a caller that did not come
 * through parsePagination (a server component, a job) cannot ask for an
 * unbounded page either.
 */
export function pageWindow(request: PageRequest = {}): PageWindow {
  const whole = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback;
  const page = whole(request.page, 1);
  const pageSize = Math.min(whole(request.pageSize, LIMITS.pageSizeDefault), LIMITS.pageSizeMax);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function toPage<T>(data: T[], window: PageWindow, totalItems: number): Page<T> {
  return {
    data,
    pagination: {
      page: window.page,
      pageSize: window.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / window.pageSize),
    },
  };
}

/** Longest search text a list accepts. */
export const SEARCH_MAX = 100;

/** A trimmed, lowercased search text, or null when there is nothing to search for. */
export function searchText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text.length === 0) return null;
  if (text.length > SEARCH_MAX) {
    throw new AppError("invalid_input", `q must be at most ${SEARCH_MAX} characters.`, { fields: ["q"] });
  }
  return text;
}

/** A `LIKE` pattern that matches the text anywhere, with the wildcard characters escaped. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export function iso(value: Date): string {
  return value.toISOString();
}

export function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
