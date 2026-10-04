import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LIMITS } from "@/domain/limits";
import { readJson } from "@/server/http/body";
import { bearerToken, constantTimeEqual } from "@/server/http/compare";
import { AppError } from "@/server/http/errors";
import { assertSameOrigin } from "@/server/http/origin";
import { listEnvelope, parsePagination } from "@/server/http/pagination";

const BASE = "https://app.orbitdiff.test";

async function appError(run: () => unknown): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("assertSameOrigin", () => {
  const request = (method: string, origin?: string) =>
    new Request(`${BASE}/api/x`, { method, headers: origin ? { origin } : {} });

  it("accepts a state-changing request from the configured origin", () => {
    expect(() => assertSameOrigin(request("POST", BASE), BASE)).not.toThrow();
  });

  it("rejects a state-changing request with no Origin header", async () => {
    const error = await appError(() => assertSameOrigin(request("POST"), BASE));
    expect(error.code).toBe("forbidden_origin");
    expect(error.status).toBe(403);
  });

  it("rejects a state-changing request from another origin", async () => {
    for (const origin of ["https://evil.test", "http://app.orbitdiff.test", `${BASE}:8443`, "null"]) {
      const error = await appError(() => assertSameOrigin(request("DELETE", origin), BASE));
      expect(error.code).toBe("forbidden_origin");
    }
  });

  it("does not require an Origin header on safe methods", () => {
    expect(() => assertSameOrigin(request("GET"), BASE)).not.toThrow();
    expect(() => assertSameOrigin(request("HEAD"), BASE)).not.toThrow();
  });
});

describe("readJson", () => {
  const schema = z.strictObject({
    name: z.string().min(1),
    shards: z.strictObject({ followers: z.array(z.number().int()) }).optional(),
  });

  it("returns the parsed value for a valid body", async () => {
    await expect(readJson(post('{"name":"Atlas"}'), schema, 1024)).resolves.toEqual({ name: "Atlas" });
  });

  it("rejects a body over the byte cap announced by Content-Length", async () => {
    const error = await appError(() =>
      readJson(post('{"name":"Atlas"}', { "content-length": "4096" }), schema, 1024),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual({ maxBytes: 1024 });
  });

  it("rejects a streamed body that exceeds the byte cap without a Content-Length", async () => {
    const chunk = new TextEncoder().encode(`"${"a".repeat(600)}",`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("["));
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(`${BASE}/api/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const error = await appError(() => readJson(request, schema, 1024));
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual({ maxBytes: 1024 });
  });

  it("counts bytes rather than characters", async () => {
    const body = JSON.stringify({ name: "é".repeat(20) });
    expect(body.length).toBeLessThan(40);
    const error = await appError(() => readJson(post(body), schema, 40));
    expect(error.details).toEqual({ maxBytes: 40 });
  });

  it("rejects a body that is not JSON", async () => {
    const error = await appError(() => readJson(post("{not json"), schema, 1024));
    expect(error.code).toBe("invalid_input");
    expect(error.status).toBe(422);
  });

  it("rejects a request that does not declare a JSON content type", async () => {
    const error = await appError(() =>
      readJson(post('{"name":"Atlas"}', { "content-type": "text/plain" }), schema, 1024),
    );
    expect(error.code).toBe("invalid_input");
  });

  it("names unknown keys and invalid fields without echoing their values", async () => {
    const error = await appError(() =>
      readJson(
        post('{"name":"","role":"admin","shards":{"followers":["x"],"extra":"hunter2"}}'),
        schema,
        1024,
      ),
    );
    expect(error.code).toBe("invalid_input");
    expect(error.details).toEqual({
      fields: ["name", "role", "shards.extra", "shards.followers.0"],
    });
    expect(JSON.stringify(error.details) + error.message).not.toContain("hunter2");
    expect(JSON.stringify(error.details) + error.message).not.toContain("admin");
  });

  it("refuses a top-level object schema that would accept unknown keys", async () => {
    const loose = z.object({ name: z.string() });
    await expect(readJson(post('{"name":"Atlas"}'), loose, 1024)).rejects.toThrow(/strict/);
  });
});

describe("pagination", () => {
  const parse = (query: string) => parsePagination(new URLSearchParams(query));

  it("defaults to the first page and the default page size", () => {
    expect(parse("")).toEqual({ page: 1, pageSize: LIMITS.pageSizeDefault, offset: 0 });
  });

  it("computes the offset for a later page", () => {
    expect(parse("page=3&pageSize=10")).toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it("caps the page size at the maximum", () => {
    expect(parse("pageSize=5000").pageSize).toBe(LIMITS.pageSizeMax);
  });

  it("rejects values that are not positive integers and names the field", async () => {
    for (const [query, field] of [
      ["page=0", "page"],
      ["page=-1", "page"],
      ["page=1.5", "page"],
      ["page=abc", "page"],
      ["pageSize=0", "pageSize"],
      ["pageSize=ten", "pageSize"],
    ] as const) {
      const error = await appError(() => parse(query));
      expect(error.code).toBe("invalid_input");
      expect(error.details).toEqual({ fields: [field] });
    }
  });

  it("builds the list envelope with the total page count", () => {
    expect(listEnvelope(["a", "b"], { page: 2, pageSize: 2 }, 5)).toEqual({
      data: ["a", "b"],
      pagination: { page: 2, pageSize: 2, totalItems: 5, totalPages: 3 },
    });
    expect(listEnvelope([], { page: 1, pageSize: 25 }, 0).pagination.totalPages).toBe(0);
  });
});

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("orbit-secret", "orbit-secret")).toBe(true);
    expect(constantTimeEqual("orbit-secret", "orbit-secreT")).toBe(false);
    expect(constantTimeEqual("orbit-secret", "orbit-secret-longer")).toBe(false);
    expect(constantTimeEqual("", "orbit-secret")).toBe(false);
  });

  it("treats two empty strings as not equal so an unset secret never matches", () => {
    expect(constantTimeEqual("", "")).toBe(false);
  });
});

describe("bearerToken", () => {
  const withAuth = (value?: string) =>
    new Request(`${BASE}/api/x`, { headers: value ? { authorization: value } : {} });

  it("reads the token of a Bearer authorization header", () => {
    expect(bearerToken(withAuth("Bearer abc123"))).toBe("abc123");
  });

  it("returns null for a missing or differently shaped header", () => {
    expect(bearerToken(withAuth())).toBeNull();
    expect(bearerToken(withAuth("Basic abc123"))).toBeNull();
    expect(bearerToken(withAuth("Bearer "))).toBeNull();
  });
});
