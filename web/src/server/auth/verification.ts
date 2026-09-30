import "server-only";

import { createHash } from "node:crypto";

import { verifyJWT } from "better-auth/crypto";
import { and, eq, exists, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { account, user } from "@/server/db/schema";

import { isRecord, type GateContext } from "./gate-context";

/**
 * How an email address gets verified here, and why it is not the Better Auth default.
 *
 * Anyone can register an address they do not own and choose its password. If a
 * click on the mailed link verified the account, the owner's click (or a mail
 * scanner's) would make that stranger's password usable: for an ADMIN_EMAILS
 * address that is admin. So the link alone verifies nothing and signs no one in.
 *
 *   1. Opening a valid link leaves a signed, httpOnly proof in that browser:
 *      "whoever uses this browser can read mail sent to this address".
 *   2. The address is marked verified only when a sign-in from that browser
 *      presents the account's current password. Reading the mailbox and knowing
 *      the password are then proven by the same person.
 *
 * A pending account is replaced when its address is registered again (see
 * pending.ts), so the owner can always take an unverified address back.
 */
const PROOF_COOKIE = "mailbox_proof";
export const PROOF_TTL_SECONDS = 60 * 60;
const TOKEN_MAX_CHARS = 1_024;
const PASSWORD_MAX_CHARS = 1_024;

function addressDigest(address: string): string {
  return createHash("sha256").update(address.toLowerCase(), "utf8").digest("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function proofCookie(ctx: GateContext) {
  return ctx.context.createAuthCookie(PROOF_COOKIE, { maxAge: PROOF_TTL_SECONDS });
}

async function leaveProof(ctx: GateContext, address: string): Promise<void> {
  const cookie = proofCookie(ctx);
  const value = `${addressDigest(address)}.${nowSeconds() + PROOF_TTL_SECONDS}`;
  await ctx.setSignedCookie(cookie.name, value, ctx.context.secret, cookie.attributes);
}

/** True when this browser holds an unexpired, correctly signed proof for exactly this address. */
async function holdsProof(ctx: GateContext, address: string): Promise<boolean> {
  const value = await ctx.getSignedCookie(proofCookie(ctx).name, ctx.context.secret);
  if (typeof value !== "string") return false;
  const [digest, expires, ...rest] = value.split(".");
  if (rest.length > 0 || !/^[0-9]{1,12}$/.test(expires ?? "")) return false;
  return digest === addressDigest(address) && Number(expires) > nowSeconds();
}

/** Add `error=<code>` to a callback path that the gate has already checked. */
function withError(callbackPath: string, code: string): string {
  const url = new URL(callbackPath, "http://app.invalid");
  url.searchParams.set("error", code);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Answer GET /verify-email. Always ends in a redirect to the callback path, so
 * Better Auth's own handler (which would verify on the click and could sign the
 * clicker in) never runs.
 */
export async function openVerificationLink(ctx: GateContext): Promise<never> {
  const query = isRecord(ctx.query) ? ctx.query : {};
  const callbackPath = typeof query.callbackURL === "string" ? query.callbackURL : "/";
  const token = query.token;
  const payload: unknown =
    typeof token === "string" && token.length <= TOKEN_MAX_CHARS
      ? await verifyJWT(token, ctx.context.secret)
      : null;
  // A token that carries `updateTo` belongs to the email-change flow, which is switched off.
  if (!isRecord(payload) || typeof payload.email !== "string" || payload.updateTo !== undefined) {
    throw ctx.redirect(withError(callbackPath, "INVALID_TOKEN"));
  }
  const address = payload.email.toLowerCase();
  const [found] = await getDb()
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, address));
  if (!found) throw ctx.redirect(withError(callbackPath, "USER_NOT_FOUND"));
  if (!found.emailVerified) await leaveProof(ctx, address);
  throw ctx.redirect(callbackPath);
}

/**
 * Called before POST /sign-in/email. When the browser holds a proof for the
 * address and the password is the pending account's current password, mark the
 * address verified. Better Auth's sign-in then runs as usual and creates the
 * session. In every other case this does nothing, and an unverified account
 * keeps answering EMAIL_NOT_VERIFIED.
 */
export async function completeVerification(ctx: GateContext): Promise<void> {
  if (!isRecord(ctx.body)) return;
  const { email, password } = ctx.body;
  if (typeof email !== "string" || typeof password !== "string") return;
  if (password.length > PASSWORD_MAX_CHARS) return;
  const address = email.toLowerCase();
  if (!(await holdsProof(ctx, address))) return;

  const db = getDb();
  const [pending] = await db
    .select({ id: user.id, hash: account.password })
    .from(user)
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(and(eq(user.email, address), eq(user.emailVerified, false)));
  if (!pending?.hash) return;
  if (!(await ctx.context.password.verify({ hash: pending.hash, password }))) return;

  // Only for the credential that was just proven: if the pending account was
  // replaced or its password changed in the meantime, this updates nothing.
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(
      and(
        eq(user.id, pending.id),
        eq(user.emailVerified, false),
        exists(
          db
            .select({ one: sql`1` })
            .from(account)
            .where(
              and(
                eq(account.userId, pending.id),
                eq(account.providerId, "credential"),
                eq(account.password, pending.hash),
              ),
            ),
        ),
      ),
    );
}
