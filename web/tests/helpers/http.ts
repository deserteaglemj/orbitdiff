import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";

/**
 * Turn the Set-Cookie headers of a response into a Cookie request header value.
 * Cookies the response deletes (Max-Age=0) are left out.
 */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((line) => !/;\s*max-age=0/i.test(line))
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

export interface RouteCall {
  /** Defaults to GET. */
  method?: string;
  /** Path with optional query ("/api/profiles?page=2") or an absolute URL. */
  url: string;
  /** Cookie header value, as returned by createVerifiedUser(). */
  cookie?: string;
  /** Sent as a JSON body with a JSON content type. */
  json?: unknown;
  /** Origin header. Defaults to the app origin; pass null to send none, or another origin. */
  origin?: string | null;
  headers?: Record<string, string>;
  /** Dynamic route segments, delivered as the promise Next.js 16 passes. */
  params?: Record<string, string>;
}

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => unknown;

/**
 * Invoke an App Router route handler directly with a real Request, the way
 * Next.js would: `const response = await callRoute(GET, { url: "/api/health" })`.
 * Returns the handler's Response after queued background work has finished.
 */
export async function callRoute(handler: unknown, call: RouteCall): Promise<Response> {
  const baseUrl = getEnv().baseUrl;
  const headers = new Headers(call.headers);
  const origin = call.origin === undefined ? baseUrl : call.origin;
  if (origin !== null) headers.set("origin", origin);
  if (call.cookie) headers.set("cookie", call.cookie);
  let body: string | undefined;
  if (call.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(call.json);
  }
  const request = new Request(new URL(call.url, baseUrl), {
    method: call.method ?? "GET",
    headers,
    body,
  });
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(call.params ?? {}),
  });
  await settleBackground();
  if (!(response instanceof Response)) throw new Error("the route handler did not return a Response");
  return response;
}
