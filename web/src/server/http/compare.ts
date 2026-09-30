import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare two shared-key strings without leaking where they differ or how long
 * they are. Both sides are hashed first, so the comparison always runs over 32
 * bytes. An empty value never matches: an unset key must not authorize anything.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** The value of an `Authorization: Bearer <value>` header, or null. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}
