import { describeApiFailure, type ApiResult } from "@/components/onboarding/api";

/**
 * Read JSON from a route of this app. It never throws: a refusal ends as the
 * route's own message, and a request that did not arrive as a plain sentence.
 * The admin screen only reads, so this is the only call it makes.
 */
export async function getJson(path: string): Promise<ApiResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network",
      message: "The request did not reach the server. Check your connection and try again.",
      fields: [],
    };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, ...describeApiFailure(response.status, text) };
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, ...describeApiFailure(response.status, "") };
  }
}
