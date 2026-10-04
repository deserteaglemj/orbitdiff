/** The masking patterns never see more than this many characters, whatever the caller passes. */
export const REDACT_INPUT_CHARS = 2_000;
/** Longest error description, and longest message part of an auth log line. */
export const MAX_LOG_CHARS = 400;

// Every quantifier that can be retried from many start positions is bounded, so
// the cost of a replace is linear in the text length. An unbounded local part
// made the address pattern quadratic on a long run without an "@".
const URL_SHAPE = /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]+/gi;
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,63}/g;
const PARAMS_TAIL = /\bparams:/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,40}$/;
const CUT_MARK = "[cut]";

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

/**
 * The part of a text the patterns may run on. A longer text is cut back to the
 * last whitespace inside the window, so the final word is never half a link or
 * half an address.
 */
function boundedWindow(text: string): string {
  if (text.length <= REDACT_INPUT_CHARS) return text;
  let end = REDACT_INPUT_CHARS;
  while (end > 0 && !isSpace(text.charCodeAt(end - 1))) end -= 1;
  return `${text.slice(0, end)}${CUT_MARK}`;
}

/**
 * Mask what must never reach a log line: URLs (connection strings, links that
 * carry tokens) and email addresses. The input is cut to a fixed window before
 * any pattern runs, so the cost does not depend on how much text a caller sends.
 */
export function redact(text: string): string {
  return mask(boundedWindow(text));
}

/** Only ever called on a text that is already inside the window. */
function mask(text: string): string {
  return text.replace(URL_SHAPE, "[url]").replace(EMAIL_SHAPE, "[email]");
}

/**
 * One bounded line of free text for a log: nothing after a query parameter
 * list, no link, no address, no line break.
 */
export function logText(text: string): string {
  const head = boundedWindow(text).split(PARAMS_TAIL, 1)[0] ?? "";
  return mask(head).replace(/\s+/g, " ").trim().slice(0, MAX_LOG_CHARS);
}

function codeOf(value: unknown): string | null {
  const code = (value as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && SAFE_CODE.test(code) ? code : null;
}

/** A failed database query: its message and fields hold the statement and every bound value. */
function isQueryFailure(error: Error): boolean {
  return "params" in error || "query" in error;
}

/**
 * One redacted, bounded line for an unexpected failure. Never logs a stack or a
 * cause object. For a failed query it logs the error name and the database
 * error code only: the statement and its parameters (tokens, password hashes,
 * addresses) are never printed.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return `non-error value of type ${typeof error}`;
  if (isQueryFailure(error)) {
    const code = codeOf(error.cause) ?? codeOf(error);
    return `${error.name}${code ? ` ${code}` : ""}: a database query failed`;
  }
  const code = codeOf(error);
  return `${code ? `${error.name} ${code}` : error.name}: ${logText(error.message)}`;
}

export function logError(scope: string, error: unknown): void {
  console.error(`[${scope}] ${describeError(error)}`);
}
