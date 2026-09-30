import { describeApiFailure } from "@/components/onboarding/api";

import { formatLocalTime } from "./local-time";

/**
 * Calls from the signed-in screens to the JSON routes of this app
 * (docs/web/design.md, section 8). A refusal keeps the route's own message and
 * its details, so a screen can say how long a cooldown still runs or when a
 * daily limit starts again.
 */
export interface ApiRefusal {
  status: number;
  code: string;
  message: string;
  /** Field names the route reported as missing or not valid. */
  fields: string[];
  /** The `details` object of the error envelope, or an empty object. */
  details: Record<string, unknown>;
}

export type ApiOutcome<T> = { ok: true; status: number; data: T } | ({ ok: false } & ApiRefusal);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a failed response: the envelope's message and details, or a plain sentence with the status. */
export function readApiRefusal(status: number, bodyText: string): ApiRefusal {
  const failure = describeApiFailure(status, bodyText);
  let details: Record<string, unknown> = {};
  if (failure.code !== "unknown") {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
      if (error && isRecord(error.details)) details = error.details;
    } catch {
      details = {};
    }
  }
  return { ...failure, details };
}

function waitText(seconds: number): string {
  if (seconds < 60) return "You can try again in less than a minute.";
  const minutes = Math.ceil(seconds / 60);
  return `You can try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/**
 * The sentence to show for a refusal: the route's own message, followed by
 * the remaining cooldown or by the local time a daily limit starts again when
 * the route reported one.
 */
export function describeRefusal(
  refusal: Pick<ApiRefusal, "code" | "message" | "details">,
  timeZone: string,
): string {
  const { details } = refusal;
  const wait = details.retryAfterSeconds;
  if (refusal.code === "cooldown" && typeof wait === "number" && Number.isFinite(wait) && wait > 0) {
    return `${refusal.message} ${waitText(wait)}`;
  }
  const resets = details.resetsAt;
  if (refusal.code === "quota_exhausted" && typeof resets === "string" && !Number.isNaN(new Date(resets).getTime())) {
    return `${refusal.message} The limit starts again at ${formatLocalTime(resets, timeZone)}.`;
  }
  return refusal.message;
}

const NETWORK: ApiRefusal = {
  status: 0,
  code: "network",
  message: "The request did not reach the server. Check your connection and try again.",
  fields: [],
  details: {},
};

/**
 * Send a request to a route of this app and read the answer. It never throws.
 * A body is sent as JSON; without one no content type is set. A response
 * without content (204) has `null` data.
 */
export async function requestJson<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, ...NETWORK };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, ...readApiRefusal(response.status, text) };
  if (text.length === 0) return { ok: true, status: response.status, data: null as T };
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, ...readApiRefusal(response.status, "") };
  }
}
