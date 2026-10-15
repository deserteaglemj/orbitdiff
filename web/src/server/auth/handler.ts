import "server-only";

import { readBounded } from "@/server/http/body";
import { AppError, toErrorResponse } from "@/server/http/errors";

import { getAuth, type Auth } from "./auth";

/** Largest request body any enabled endpoint needs. The biggest real one is a sign-up, well under 2 KiB. */
export const AUTH_BODY_MAX_BYTES = 16 * 1024;
/** Longest request URL. The longest real one is a verification link: a token for a 254 character address plus an encoded 512 character callback path, about 2,100 characters. */
export const AUTH_URL_MAX_CHARS = 4_096;

const BASE_PATH = "/api/auth";

/**
 * The Better Auth endpoints this app uses, with the methods each accepts.
 * Anything else under /api/auth is answered 404 here, before Better Auth and
 * its rate limiter see the request, so junk paths cost no database row and the
 * OAuth, account-linking, token, and callback endpoints are not reachable.
 */
const ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  "/sign-up/email": ["POST"],
  "/sign-in/email": ["POST"],
  "/sign-out": ["POST"],
  "/get-session": ["GET", "POST"],
  "/verify-email": ["GET"],
  "/send-verification-email": ["POST"],
  "/request-password-reset": ["POST"],
  "/reset-password": ["POST"],
  "/change-password": ["POST"],
  "/update-user": ["POST"],
  "/delete-user": ["POST"],
  "/list-sessions": ["GET"],
  "/revoke-session": ["POST"],
  "/revoke-sessions": ["POST"],
  "/revoke-other-sessions": ["POST"],
};

function notFound(): AppError {
  return new AppError("not_found", "Not found.");
}

function assertEnabledEndpoint(request: Request): void {
  if (request.url.length > AUTH_URL_MAX_CHARS) throw notFound();
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${BASE_PATH}/`)) throw notFound();
  const path = pathname.slice(BASE_PATH.length);
  // Own-property lookup on the exact, still-encoded path: no decoding, no trailing slash, no prefix match.
  const methods = Object.hasOwn(ENDPOINTS, path) ? ENDPOINTS[path] : undefined;
  if (!methods?.includes(request.method.toUpperCase())) throw notFound();
}

/** Buffer the body under the cap and hand Better Auth a request that holds exactly those bytes. */
async function withBoundedBody(request: Request): Promise<Request> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return request;
  const bytes = await readBounded(request, AUTH_BODY_MAX_BYTES);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes.byteLength > 0 ? bytes : undefined,
  });
}

/**
 * The only way a request reaches Better Auth. It refuses paths that are not
 * enabled endpoints and bodies above the cap, and it turns anything unexpected
 * (a configuration failure, a failed query) into the generic 500 envelope with
 * one redacted log line. Better Auth is configured to rethrow such errors
 * instead of printing them, because its own print includes query parameters.
 *
 * It never throws. Pass `auth` only from a test that needs a differently
 * configured instance.
 */
export async function handleAuthRequest(request: Request, auth?: Auth): Promise<Response> {
  try {
    assertEnabledEndpoint(request);
    const bounded = await withBoundedBody(request);
    return await (auth ?? getAuth()).handler(bounded);
  } catch (error) {
    return toErrorResponse(error);
  }
}
