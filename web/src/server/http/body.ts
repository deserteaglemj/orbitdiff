import type { z } from "zod";

import { AppError } from "./errors";

function tooLarge(maxBytes: number): AppError {
  return new AppError("invalid_input", "The request body is too large.", { maxBytes });
}

/** A top-level object schema must be strict, otherwise unknown keys would be dropped silently. */
function assertStrict(schema: z.ZodType): void {
  const def = schema._zod.def as { type: string; catchall?: z.ZodType };
  if (def.type === "object" && def.catchall?._zod.def.type !== "never") {
    throw new Error("readJson needs a strict object schema: build it with z.strictObject().");
  }
}

/**
 * Read a request body, refusing it with `invalid_input` once it exceeds
 * `maxBytes`. The declared length is checked first, then the bytes actually
 * received, so a missing or false Content-Length cannot get past the cap.
 */
export async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Field paths for a failed parse. Names only: an issue message can echo input, so it is not used. */
function fieldNames(error: z.ZodError): string[] {
  const names = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) names.add([...path, key].join("."));
    } else {
      names.add(path.length > 0 ? path.join(".") : "body");
    }
  }
  return [...names].sort();
}

/**
 * Read and validate a JSON request body. Enforces a byte cap while reading,
 * requires a JSON content type, and reports invalid or unknown fields by name.
 * Pass a schema built with z.strictObject() (nested objects too).
 */
export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes: number): Promise<T> {
  assertStrict(schema);
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new AppError("invalid_input", "Send the request body as JSON.");
  }
  const bytes = await readBounded(request, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("invalid_input", "The request body is not valid JSON.");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("invalid_input", "Some fields are missing or not valid.", {
      fields: fieldNames(result.error),
    });
  }
  return result.data;
}
