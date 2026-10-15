import type { createAuthMiddleware } from "better-auth/api";

/** The context Better Auth hands to a `hooks.before` handler. */
export type GateContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export type Body = Record<string, unknown>;

export function isRecord(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
