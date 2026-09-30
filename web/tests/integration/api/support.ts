import { expect } from "vitest";

import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";

import { callRoute, type RouteCall } from "../../helpers";

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Assert the error envelope and its status, and return the parsed body. */
export async function expectError(response: Response, status: number, code: string): Promise<ErrorBody> {
  const body = (await response.json()) as ErrorBody;
  expect({ status: response.status, code: body.error?.code }).toEqual({ status, code });
  expect(typeof body.error.message).toBe("string");
  return body;
}

/** Call a route for a profile: fills the `id` path parameter from the URL. */
export function callProfileRoute(handler: unknown, id: string, call: Omit<RouteCall, "params">): Promise<Response> {
  return callRoute(handler, { ...call, params: { id } });
}

/**
 * Invoke a route with a raw body, for the cases callRoute cannot build:
 * a body that is not JSON, a wrong content type, or a body over the byte cap.
 */
export async function callRaw(
  handler: unknown,
  call: { url: string; method: string; cookie?: string; body: string; contentType?: string; params?: Record<string, string> },
): Promise<Response> {
  const baseUrl = getEnv().baseUrl;
  const headers = new Headers({ origin: baseUrl, "content-type": call.contentType ?? "application/json" });
  if (call.cookie) headers.set("cookie", call.cookie);
  const request = new Request(new URL(call.url, baseUrl), { method: call.method, headers, body: call.body });
  const run = handler as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const response = await run(request, { params: Promise.resolve(call.params ?? {}) });
  await settleBackground();
  return response;
}

/** Every key of a JSON value, at any depth. */
export function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysOf(item, found);
    }
  }
  return found;
}
