import { getEnv } from "@/server/env";

import { AppError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery check for cookie-authenticated routes. A
 * state-changing request must carry an Origin header equal to the configured
 * base URL origin. Safe methods pass, so this can be called unconditionally.
 */
export function assertSameOrigin(request: Request, baseUrl: string = getEnv().baseUrl): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(baseUrl).origin) {
    throw new AppError("forbidden_origin", "This request did not come from the app.");
  }
}
