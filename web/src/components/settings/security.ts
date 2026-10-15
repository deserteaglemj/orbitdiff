import { describeAuthError } from "@/components/auth/auth-errors";
import { PASSWORD_MAX, PASSWORD_MIN, validateNewPassword } from "@/components/auth/sign-up-model";

/**
 * The rules of the Security section: changing the password, reading a refusal
 * from the account endpoints, and listing the signed-in devices. Pure functions
 * with no I/O. The server checks everything again.
 */
export interface PasswordChangeValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordChangeField = keyof PasswordChangeValues;
export type PasswordChangeErrors = Partial<Record<PasswordChangeField, string>>;

/** Field order on the screen, used to move focus to the first field with an error. */
export const PASSWORD_CHANGE_FIELDS: readonly PasswordChangeField[] = ["currentPassword", "newPassword", "confirmPassword"];

/** Field errors for the change-password form. An empty object means it can be sent. */
export function validatePasswordChange(values: PasswordChangeValues): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {};
  if (values.currentPassword.length === 0) errors.currentPassword = "Enter your current password.";
  const weak = validateNewPassword(values.newPassword);
  if (weak !== undefined) errors.newPassword = weak;
  if (values.confirmPassword !== values.newPassword) errors.confirmPassword = "The two passwords are not the same.";
  return errors;
}

/**
 * What the change-password form sends. The current password is always part of
 * it, and every other device is always signed out: someone who knew the old
 * password must not keep a login.
 */
export function buildPasswordChangeRequest(values: PasswordChangeValues): {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: true;
} {
  return { currentPassword: values.currentPassword, newPassword: values.newPassword, revokeOtherSessions: true };
}

export type SecurityFailure =
  | { kind: "field"; field: "currentPassword" | "newPassword"; message: string }
  /** The server no longer knows this login. */
  | { kind: "signed_out"; message: string }
  /** The list of devices needs a sign-in from the last day. */
  | { kind: "not_fresh"; message: string }
  | { kind: "form"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): string {
  if (!isRecord(error)) return "";
  if (typeof error.code === "string") return error.code;
  return isRecord(error.error) && typeof error.error.code === "string" ? error.error.code : "";
}

/**
 * Turn a refusal from the password and session endpoints into what the screen
 * shows. Refusals it does not know keep the server's own message.
 */
export function describeSecurityError(error: unknown): SecurityFailure {
  const code = codeOf(error);
  const status = isRecord(error) ? error.status : undefined;
  switch (code) {
    case "INVALID_PASSWORD":
      return { kind: "field", field: "currentPassword", message: "That is not your current password." };
    case "PASSWORD_TOO_SHORT":
      return { kind: "field", field: "newPassword", message: `Use at least ${PASSWORD_MIN} characters.` };
    case "PASSWORD_TOO_LONG":
      return { kind: "field", field: "newPassword", message: `Use at most ${PASSWORD_MAX} characters.` };
    case "SESSION_NOT_FRESH":
      return {
        kind: "not_fresh",
        message:
          "The list of signed-in devices is shown only during the first day after you sign in. Sign out and sign in again to see it.",
      };
    default:
      break;
  }
  if (status === 401 || code === "UNAUTHORIZED") {
    return { kind: "signed_out", message: "You are signed out on this device. Sign in again to continue." };
  }
  return { kind: "form", message: describeAuthError(error).message };
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\b(?:Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\b(?:Macintosh|Mac OS X)\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** Longest description read. A real one is a few hundred characters. */
const AGENT_MAX = 1024;

/**
 * A short name for the device of a session, from the description its browser
 * sent: "Chrome on macOS". Only words from the fixed lists above are ever
 * returned. The description itself is chosen by the device and is never shown.
 */
export function describeUserAgent(agent: unknown): string {
  if (typeof agent !== "string" || agent.trim().length === 0) return "Unknown device";
  const text = agent.slice(0, AGENT_MAX);
  const browser = BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? "Unknown browser";
  const system = SYSTEMS.find(([pattern]) => pattern.test(text))?.[1];
  return system === undefined ? browser : `${browser} on ${system}`;
}

export interface SessionRow {
  /** A key for the list. Never the token. */
  key: string;
  /** Needed to sign that device out. Held in memory only: it is never rendered. */
  token: string;
  /** True for the login this page is using. */
  current: boolean;
  device: string;
  address: string;
  /** ISO time, or null when it cannot be read. */
  signedInAt: string | null;
  expiresAt: string | null;
}

function toIso(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date === null || Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The signed-in devices as the list shows them: this device first, then the
 * others from the newest sign-in to the oldest. An entry without a token is
 * left out, because it could not be told apart or signed out.
 */
export function sessionRows(sessions: unknown, currentToken: string | null): SessionRow[] {
  if (!Array.isArray(sessions)) return [];
  const rows: SessionRow[] = [];
  for (const entry of sessions) {
    if (!isRecord(entry) || typeof entry.token !== "string" || entry.token.length === 0) continue;
    rows.push({
      key: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `session-${rows.length + 1}`,
      token: entry.token,
      current: currentToken !== null && entry.token === currentToken,
      device: describeUserAgent(entry.userAgent),
      address: typeof entry.ipAddress === "string" && entry.ipAddress.trim().length > 0 ? entry.ipAddress.trim() : "Unknown",
      signedInAt: toIso(entry.createdAt),
      expiresAt: toIso(entry.expiresAt),
    });
  }
  return rows.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    const left = a.signedInAt ?? "";
    const right = b.signedInAt ?? "";
    return left === right ? 0 : left < right ? 1 : -1;
  });
}
