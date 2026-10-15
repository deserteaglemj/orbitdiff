import { describeError, logText } from "@/server/http/log";

type Level = "debug" | "info" | "warn" | "error";

/** Better Auth passes at most one error with a message. More would only lengthen the line. */
const MAX_ERRORS = 2;

/**
 * Log sink handed to Better Auth. Its default logger prints whatever it is
 * given, including error objects that carry query parameters. This one writes a
 * single bounded line: the message and any Error are redacted, other values are
 * dropped, so no token, cookie, password, or full email address reaches the log.
 * The message can hold text a client sent, so it is cut before it is scanned.
 */
export function authLog(level: Level, message: string, ...args: unknown[]): void {
  const errors = args
    .filter((arg) => arg instanceof Error)
    .slice(0, MAX_ERRORS)
    .map((error) => describeError(error));
  const line = [`[auth] ${logText(message)}`, ...errors].join(" ");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
