import "server-only";

import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

import type { GateContext } from "./gate-context";

/**
 * What a suspended account may still reach: reading its own state (so the
 * interface can say it is suspended) and signing out. The other entries carry
 * no login: they are answered the same for everyone, and a login that would
 * follow from them is refused when it is created.
 *
 * Every other endpoint, including any added later, is refused for a suspended
 * login. Deleting the account is refused too: deletion would free the address,
 * and a new registration would come back as an active account.
 */
const OPEN_WHILE_SUSPENDED: ReadonlySet<string> = new Set([
  "/get-session",
  "/sign-out",
  "/sign-in/email",
  "/sign-up/email",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/reset-password",
]);

function suspended(): APIError {
  return new APIError("FORBIDDEN", { code: "ACCOUNT_SUSPENDED", message: "This account is suspended." });
}

/** Only `active` is active. A missing or unknown status counts as suspended, as it does in the guards. */
function isActive(status: unknown): boolean {
  return status === "active";
}

/** Better Auth `databaseHooks.session.create.before`: no login is ever created for a suspended account. */
export async function refuseLoginForSuspended(userId: string): Promise<void> {
  const [found] = await getDb().select({ status: user.status }).from(user).where(eq(user.id, userId));
  if (found && !isActive(found.status)) throw suspended();
}

/** Gate step: refuse a request that carries the login of a suspended account. */
export async function refuseSuspendedLogin(ctx: GateContext): Promise<void> {
  if (OPEN_WHILE_SUSPENDED.has(ctx.path)) return;
  const current = await getSessionFromCtx(ctx);
  if (current && !isActive((current.user as { status?: unknown }).status)) throw suspended();
}
