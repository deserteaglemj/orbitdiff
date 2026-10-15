import { describeAuthError } from "@/components/auth/auth-errors";

/**
 * The confirmation in front of account deletion, and what the screen shows
 * afterwards. Pure apart from the one call it is handed, so the rule is tested
 * without a browser.
 *
 * The gate fails closed: a request is built only for a password that is text
 * and not empty. Every other value (missing, null, empty, a number, an object)
 * builds nothing, and nothing is sent. The server checks again: it refuses a
 * request without a password and verifies the password it gets.
 */
export type DeletionRequest = { ok: true; body: { password: string } } | { ok: false; error: string };

const ASK_FOR_PASSWORD = "Enter your password to delete your account.";
const NOT_DELETED = "Your account was not deleted.";

/** The body for the delete-user endpoint: the password, exactly as typed, and nothing else. */
export function buildDeletionRequest(password: unknown): DeletionRequest {
  if (typeof password !== "string" || password.length === 0) return { ok: false, error: ASK_FOR_PASSWORD };
  return { ok: true, body: { password } };
}

/** The shape of `authClient.deleteUser`: it answers with data or with an error, and may throw when offline. */
export type DeleteUserCall = (body: { password: string }) => Promise<{ data?: unknown; error?: unknown }>;

export type DeletionOutcome =
  /** The server confirmed the deletion. */
  | { kind: "deleted" }
  /** Shown under the password field. */
  | { kind: "password"; message: string }
  /** Shown in the alert region of the form. */
  | { kind: "refused"; message: string };

/** Refusal codes that are about the password itself. */
const PASSWORD_CODES = new Set(["INVALID_PASSWORD", "PASSWORD_REQUIRED", "PASSWORD_TOO_LONG"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): string {
  if (!isRecord(error)) return "";
  if (typeof error.code === "string") return error.code;
  return isRecord(error.error) && typeof error.error.code === "string" ? error.error.code : "";
}

/** The server's own sentence, ended with a full stop, followed by the fact that nothing was deleted. */
function withOutcome(message: string): string {
  const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${sentence} ${NOT_DELETED}`;
}

/**
 * Ask the server to delete the account. `call` is only reached with a password
 * that passed buildDeletionRequest. The account counts as deleted only when the
 * server says so with `success: true`; a refusal is shown with the server's own
 * message, and an answer that confirms nothing is reported as unconfirmed.
 */
export async function deleteAccount(call: DeleteUserCall, password: unknown): Promise<DeletionOutcome> {
  const request = buildDeletionRequest(password);
  if (!request.ok) return { kind: "password", message: request.error };
  let answer: { data?: unknown; error?: unknown };
  try {
    answer = await call(request.body);
  } catch {
    return {
      kind: "refused",
      message: "The request did not reach the server, so your account was not deleted. Check your connection and try again.",
    };
  }
  if (answer.error !== null && answer.error !== undefined) {
    const message = withOutcome(describeAuthError(answer.error).message);
    return { kind: PASSWORD_CODES.has(codeOf(answer.error)) ? "password" : "refused", message };
  }
  if (isRecord(answer.data) && answer.data.success === true) return { kind: "deleted" };
  return {
    kind: "refused",
    message: "The server did not confirm the deletion. Reload this page to see whether your account still exists.",
  };
}
