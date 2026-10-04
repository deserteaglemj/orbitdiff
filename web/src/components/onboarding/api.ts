/**
 * Calls to the application's JSON routes from a screen. Every failure ends as a
 * sentence to show: the message of the error envelope when the route sent one,
 * and a plain statement otherwise. The design envelope is
 * `{ error: { code, message, details? } }` (docs/web/design.md, section 8).
 */
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  /** Field names the route reported as missing or not valid. */
  fields: string[];
}

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure);

const MESSAGE_MAX = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a failed response. Anything that is not the error envelope becomes a plain sentence with the status. */
export function describeApiFailure(status: number, bodyText: string): ApiFailure {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
  if (!error || typeof error.message !== "string" || error.message.trim().length === 0) {
    return {
      status,
      code: "unknown",
      message: `The server could not handle this request (status ${status}). Try again shortly.`,
      fields: [],
    };
  }
  const details = isRecord(error.details) ? error.details : null;
  const fields = Array.isArray(details?.fields)
    ? details.fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    status,
    code: typeof error.code === "string" ? error.code : "unknown",
    message: error.message.trim().slice(0, MESSAGE_MAX),
    fields,
  };
}

/** Send JSON to a route of this app and read the answer. It never throws. */
export async function callApi<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
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
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, ...describeApiFailure(response.status, "") };
  }
}
