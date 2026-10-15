import { logError } from "./log";

/** Error codes and HTTP statuses from docs/web/design.md section 8. */
export const ERROR_STATUS = {
  unauthenticated: 401,
  unverified: 403,
  suspended: 403,
  forbidden_origin: 403,
  not_found: 404,
  conflict: 409,
  invalid_input: 422,
  quota_exhausted: 429,
  cooldown: 429,
  capacity_paused: 503,
  unavailable: 503,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ErrorDetails = Record<string, unknown>;

/**
 * An expected failure with a stable code. The message and details are sent to
 * the client, so they must never contain secrets or another tenant's data.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetails };
}

const INTERNAL_MESSAGE = "Something went wrong. Try again shortly.";

/**
 * Turn anything thrown into the error envelope. Only an AppError reaches the
 * client as written; everything else becomes a generic 500 and one redacted log line.
 */
export function toErrorResponse(error: unknown): Response {
  let body: ErrorBody;
  let status: number;
  if (error instanceof AppError) {
    status = error.status;
    body = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) body.error.details = error.details;
  } else {
    logError("http", error);
    status = ERROR_STATUS.internal;
    body = { error: { code: "internal", message: INTERNAL_MESSAGE } };
  }
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
