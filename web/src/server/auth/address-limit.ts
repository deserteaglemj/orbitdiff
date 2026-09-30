import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { rateLimit } from "@/server/db/schema";

export interface AddressRule {
  /** Window length in seconds. */
  window: number;
  /** Requests allowed inside one window. */
  max: number;
}

/**
 * Limits per target address and endpoint, on top of Better Auth's limits per
 * client address. They hold however many client addresses the requests come
 * from (or claim to come from): password guesses against one account, and mail
 * sent to one mailbox, are bounded either way.
 *
 * The windows are 60 seconds because the rows live in Better Auth's rate_limit
 * table, which it prunes after its own longest window (60 seconds). A longer
 * window here would be cut short by that pruning.
 */
export const ADDRESS_RULES: Readonly<Record<string, AddressRule>> = {
  "/sign-in/email": { window: 60, max: 10 },
  "/sign-up/email": { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 3 },
  "/send-verification-email": { window: 60, max: 3 },
};

export type AddressDecision = { allowed: true } | { allowed: false; retryAfter: number };

/** The stored key holds a digest, never the address. */
function keyFor(path: string, address: string): string {
  const digest = createHash("sha256").update(address.toLowerCase(), "utf8").digest("hex").slice(0, 32);
  return `address:${digest}|${path}`;
}

/**
 * Count one request against an address, in a single atomic statement: a fixed
 * window that starts with the first request. `last_request` holds the window
 * start, and the count stops rising just above the limit.
 */
export async function consumeAddressLimit(
  path: string,
  address: string,
  rule: AddressRule,
  now: number = Date.now(),
): Promise<AddressDecision> {
  const windowMs = rule.window * 1000;
  const expired = sql`${rateLimit.lastRequest} <= ${now - windowMs}`;
  const [row] = await getDb()
    .insert(rateLimit)
    .values({ id: randomUUID(), key: keyFor(path, address), count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${expired} then 1 else least(${rateLimit.count} + 1, ${rule.max + 1}) end`,
        lastRequest: sql`case when ${expired} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });
  if (!row || row.count <= rule.max) return { allowed: true };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((row.lastRequest + windowMs - now) / 1000)) };
}
