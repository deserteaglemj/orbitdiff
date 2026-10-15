/**
 * One error type for every domain rule. The `code` is stable and meant for
 * programs; the `message` is the sentence the Python implementation raises, so
 * the two implementations stay comparable case by case.
 */
export type DomainErrorCode =
  | "invalid_handle"
  | "invalid_profile_url"
  | "invalid_capture_time"
  | "invalid_timezone"
  | "invalid_input"
  | "unsafe_path"
  | "ambiguous_roots"
  | "overlapping_shards"
  | "malformed_json"
  | "malformed_row"
  | "conflicting_handle"
  | "owner_mismatch"
  | "nothing_recognized"
  | "too_large"
  | "unsupported_zip"
  | "conflict"
  | "history_limit"
  | "incomplete_collection";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** Sentences shared by more than one module, word for word as in `personal.py`. */
export const MESSAGES = {
  handle: "A valid Instagram account handle is required.",
  ownerMismatch: "The export account does not match the selected account.",
  accountCount: "The relationship account count exceeds the import limit.",
  declarations: "Completeness declarations must be booleans.",
} as const;
