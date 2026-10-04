import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, ERROR_STATUS, toErrorResponse } from "@/server/http/errors";
import { json, route } from "@/server/http/handler";
import { redact } from "@/server/http/log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("error codes", () => {
  it("maps every code to the status in the design", () => {
    expect(ERROR_STATUS).toEqual({
      unauthenticated: 401,
      unverified: 403,
      suspended: 403,
      forbidden_origin: 403,
      not_found: 404,
      conflict: 409,
      invalid_input: 422,
      quota_exhausted: 429,
      cooldown: 429,
      capacity_paused: 503,
      unavailable: 503,
      internal: 500,
    });
  });
});

describe("toErrorResponse", () => {
  it("renders an AppError as the error envelope with its status", async () => {
    const response = toErrorResponse(
      new AppError("invalid_input", "Check the highlighted fields.", { fields: ["timezone"] }),
    );
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_input",
        message: "Check the highlighted fields.",
        details: { fields: ["timezone"] },
      },
    });
  });

  it("omits details when an AppError has none", async () => {
    const body = await toErrorResponse(new AppError("not_found", "Not found.")).json();
    expect(body).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  it("never leaks the message of an unexpected error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = toErrorResponse(
      new Error("connect ECONNREFUSED postgres://orbit:pw@db.internal/app"),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal", message: "Something went wrong. Try again shortly." },
    });
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("db.internal");
    expect(logged).toHaveBeenCalledOnce();
  });

  it("treats a thrown non-error value as internal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = toErrorResponse("boom");
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal");
  });

  it("keeps email addresses out of the log line for an unexpected error", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    toErrorResponse(new Error("duplicate key for atlas@orbitdiff.test"));
    const line = logged.mock.calls[0]?.join(" ") ?? "";
    expect(line).not.toContain("atlas@orbitdiff.test");
    expect(line).toContain("[email]");
  });
});

describe("redact", () => {
  it("masks email addresses and connection URLs", () => {
    expect(redact("to nova@orbitdiff.test via postgres://orbit:pw@db.internal/app now")).toBe(
      "to [email] via [url] now",
    );
  });
});

describe("route", () => {
  it("returns the handler response untouched", async () => {
    const handler = route(async () => json({ ok: true }, { status: 201 }));
    const response = await handler(new Request("http://127.0.0.1:3100/api/x"), undefined);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("converts a thrown AppError into its response", async () => {
    const handler = route(async () => {
      throw new AppError("cooldown", "Try again later.");
    });
    const response = await handler(new Request("http://127.0.0.1:3100/api/x"), undefined);
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("cooldown");
  });

  it("converts an unexpected throw into a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = route(() => {
      throw new TypeError("secret internals");
    });
    const response = await handler(new Request("http://127.0.0.1:3100/api/x"), undefined);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret internals");
  });

  it("passes the request and the route context through", async () => {
    const handler = route(async (request: Request, context: { params: Promise<{ id: string }> }) =>
      json({ id: (await context.params).id, method: request.method }),
    );
    const response = await handler(new Request("http://127.0.0.1:3100/api/x", { method: "PATCH" }), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(await response.json()).toEqual({ id: "p1", method: "PATCH" });
  });
});
