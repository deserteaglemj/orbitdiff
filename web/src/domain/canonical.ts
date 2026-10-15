/**
 * Canonical JSON and SHA-256 digests equal to the Python ones:
 * `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`.
 *
 * Numbers are limited to safe integers. Python writes `1.0` for a float and
 * `1` for an int, a distinction JavaScript cannot carry, and no digest in this
 * domain contains a float.
 */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const HIGH_START = 0xd800;
const HIGH_END = 0xdbff;

/**
 * Orders two strings the way Python orders `str`: by code point.
 * JavaScript's `<` orders by UTF-16 code unit, which places astral characters
 * before U+E000 to U+FFFF. `localeCompare` is never used.
 */
export function compareCodePoints(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }
  if (index === limit) {
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  }
  if (index > 0) {
    const previous = left.charCodeAt(index - 1);
    if (previous >= HIGH_START && previous <= HIGH_END) {
      const a = left.codePointAt(index - 1) as number;
      const b = right.codePointAt(index - 1) as number;
      if (a !== b) {
        return a < b ? -1 : 1;
      }
    }
  }
  const a = left.codePointAt(index) as number;
  const b = right.codePointAt(index) as number;
  return a < b ? -1 : 1;
}

/** A sorted copy, in code point order. */
export function sortByCodePoint(values: Iterable<string>): string[] {
  return Array.from(values).sort(compareCodePoints);
}

const PLAIN = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;
const SHORT: Record<number, string> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

function quote(text: string): string {
  if (PLAIN.test(text)) {
    return `"${text}"`;
  }
  let out = '"';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const short = SHORT[unit];
    if (short !== undefined) {
      out += short;
    } else if (unit >= 0x20 && unit <= 0x7e) {
      out += text[index];
    } else {
      out += `\\u${unit.toString(16).padStart(4, "0")}`;
    }
  }
  return `${out}"`;
}

export function canonical(value: CanonicalValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return quote(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("canonical() encodes safe integers only");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly CanonicalValue[]).map(canonical).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as { readonly [key: string]: CanonicalValue };
    const keys = Object.keys(record).sort(compareCodePoints);
    return `{${keys.map((key) => `${quote(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new TypeError("canonical() cannot encode this value");
}

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

/** Lowercase hexadecimal SHA-256. Text is hashed as UTF-8. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  let out = "";
  for (const byte of new Uint8Array(buffer)) {
    out += HEX[byte];
  }
  return out;
}

/** `personal._digest`: SHA-256 of the canonical JSON. */
export async function digest(value: CanonicalValue): Promise<string> {
  return sha256Hex(canonical(value));
}
