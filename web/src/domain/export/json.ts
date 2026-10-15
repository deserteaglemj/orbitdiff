import { DomainError } from "../errors";

/**
 * A JSON reader that behaves like `personal._json`: Python's `json.loads` on
 * bytes, with duplicate object keys rejected.
 *
 * `JSON.parse` cannot be used. It keeps the last duplicate key silently,
 * rejects the `NaN`, `Infinity`, and `-Infinity` literals that Python accepts,
 * rejects a byte order mark, and never sees UTF-16 or UTF-32 input, which
 * Python detects from the first bytes.
 *
 * Known limits of the port:
 *  - Nesting is bounded at MAX_JSON_DEPTH. CPython's own bound depends on the
 *    build and on the caller's stack (about 1,000 levels on 3.11, about 10,000
 *    on 3.13), so no single number reproduces it. Real exports nest 4 deep.
 *  - A key written as raw UTF-8 encoded surrogates and the same key written
 *    as an escaped surrogate pair are one key here and two keys in Python.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

/** Objects have no prototype, so keys such as `__proto__` are plain data. */
export interface JsonObject {
  [key: string]: JsonValue;
}

export const MAX_JSON_DEPTH = 512;
/** `sys.int_info.default_max_str_digits`: longer integer literals raise ValueError in Python. */
const MAX_INTEGER_DIGITS = 4300;
const MALFORMED = "A relationship JSON document is malformed.";

function malformed(): never {
  throw new DomainError("malformed_json", MALFORMED);
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python truthiness of a decoded JSON value. `NaN` is truthy, as in Python. */
export function pyTruthy(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string" || Array.isArray(value)) {
    return value.length > 0;
  }
  for (const key in value) {
    void key;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- bytes to text

type Encoding = "utf-8" | "utf-8-sig" | "utf-16" | "utf-16-le" | "utf-16-be" | "utf-32" | "utf-32-le" | "utf-32-be";

function startsWith(bytes: Uint8Array, ...prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/** `json.detect_encoding`. */
function detectEncoding(bytes: Uint8Array): Encoding {
  if (startsWith(bytes, 0x00, 0x00, 0xfe, 0xff) || startsWith(bytes, 0xff, 0xfe, 0x00, 0x00)) {
    return "utf-32";
  }
  if (startsWith(bytes, 0xfe, 0xff) || startsWith(bytes, 0xff, 0xfe)) {
    return "utf-16";
  }
  if (startsWith(bytes, 0xef, 0xbb, 0xbf)) {
    return "utf-8-sig";
  }
  if (bytes.length >= 4) {
    if (bytes[0] === 0) {
      return bytes[1] !== 0 ? "utf-16-be" : "utf-32-be";
    }
    if (bytes[1] === 0) {
      return bytes[2] !== 0 || bytes[3] !== 0 ? "utf-16-le" : "utf-32-le";
    }
  } else if (bytes.length === 2) {
    if (bytes[0] === 0) {
      return "utf-16-be";
    }
    if (bytes[1] === 0) {
      return "utf-16-le";
    }
  }
  return "utf-8";
}

const CHUNK = 0x8000;

function unitsToString(units: Uint16Array, length: number): string {
  let out = "";
  for (let start = 0; start < length; start += CHUNK) {
    out += String.fromCharCode.apply(
      null,
      units.subarray(start, Math.min(start + CHUNK, length)) as unknown as number[],
    );
  }
  return out;
}

/** Strict UTF-8 plus Python's `surrogatepass`: encoded surrogates decode to lone surrogates. */
function decodeUtf8Surrogatepass(bytes: Uint8Array): string {
  const units = new Uint16Array(bytes.length);
  let count = 0;
  let index = 0;
  const continuation = (at: number, low: number, high: number): number => {
    const byte = bytes[at];
    if (byte === undefined || byte < low || byte > high) {
      malformed();
    }
    return byte & 0x3f;
  };
  while (index < bytes.length) {
    const lead = bytes[index];
    if (lead < 0x80) {
      units[count++] = lead;
      index += 1;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      units[count++] = ((lead & 0x1f) << 6) | continuation(index + 1, 0x80, 0xbf);
      index += 2;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      const second = continuation(index + 1, lead === 0xe0 ? 0xa0 : 0x80, 0xbf);
      units[count++] = ((lead & 0x0f) << 12) | (second << 6) | continuation(index + 2, 0x80, 0xbf);
      index += 3;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      const second = continuation(index + 1, lead === 0xf0 ? 0x90 : 0x80, lead === 0xf4 ? 0x8f : 0xbf);
      const point =
        (((lead & 0x07) << 18) |
          (second << 12) |
          (continuation(index + 2, 0x80, 0xbf) << 6) |
          continuation(index + 3, 0x80, 0xbf)) -
        0x10000;
      units[count++] = 0xd800 | (point >> 10);
      units[count++] = 0xdc00 | (point & 0x3ff);
      index += 4;
    } else {
      malformed();
    }
  }
  return unitsToString(units, count);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return decodeUtf8Surrogatepass(bytes);
  }
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) {
    malformed();
  }
  const units = new Uint16Array(bytes.length / 2);
  for (let index = 0; index < units.length; index += 1) {
    const first = bytes[index * 2];
    const second = bytes[index * 2 + 1];
    units[index] = littleEndian ? first | (second << 8) : (first << 8) | second;
  }
  return unitsToString(units, units.length);
}

function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 4 !== 0) {
    malformed();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = new Uint16Array(bytes.length / 2);
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const point = view.getUint32(offset, littleEndian);
    if (point > 0x10ffff) {
      malformed();
    }
    if (point >= 0x10000) {
      units[count++] = 0xd800 | ((point - 0x10000) >> 10);
      units[count++] = 0xdc00 | ((point - 0x10000) & 0x3ff);
    } else {
      units[count++] = point;
    }
  }
  return unitsToString(units, count);
}

/** `bytes.decode(detect_encoding(bytes), "surrogatepass")`. */
export function decodeJsonBytes(bytes: Uint8Array): string {
  switch (detectEncoding(bytes)) {
    case "utf-8":
      return decodeUtf8(bytes);
    case "utf-8-sig":
      return decodeUtf8(bytes.subarray(3));
    case "utf-16":
      return decodeUtf16(bytes.subarray(2), bytes[0] === 0xff);
    case "utf-16-le":
      return decodeUtf16(bytes, true);
    case "utf-16-be":
      return decodeUtf16(bytes, false);
    case "utf-32":
      return decodeUtf32(bytes.subarray(4), bytes[0] === 0xff);
    case "utf-32-le":
      return decodeUtf32(bytes, true);
    case "utf-32-be":
      return decodeUtf32(bytes, false);
  }
}

// ---------------------------------------------------------------- text to value

type Frame = { array: JsonValue[] } | { object: JsonObject; key: string };

const PLAIN_RUN = /[^"\\\u0000-\u001f]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function hexValue(unit: number): number {
  if (unit >= 0x30 && unit <= 0x39) {
    return unit - 0x30;
  }
  if (unit >= 0x61 && unit <= 0x66) {
    return unit - 0x57;
  }
  if (unit >= 0x41 && unit <= 0x46) {
    return unit - 0x37;
  }
  return malformed();
}

/** Parses one document the way Python's scanner does, without recursion. */
export function parseJsonText(text: string): JsonValue {
  const end = text.length;
  let at = 0;

  const skipSpace = (): void => {
    for (; at < end; at += 1) {
      const unit = text.charCodeAt(at);
      if (unit !== 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) {
        return;
      }
    }
  };

  /** `at` is on the opening quote; leaves `at` after the closing quote. */
  const readString = (): string => {
    let out = "";
    at += 1;
    for (;;) {
      PLAIN_RUN.lastIndex = at;
      PLAIN_RUN.exec(text);
      const stop = PLAIN_RUN.lastIndex;
      if (stop > at) {
        out += text.slice(at, stop);
        at = stop;
      }
      if (at >= end) {
        malformed();
      }
      const unit = text.charCodeAt(at);
      if (unit === 0x22) {
        at += 1;
        return out;
      }
      if (unit !== 0x5c) {
        malformed();
      }
      const escape = text[at + 1];
      if (escape === "u") {
        if (at + 6 > end) {
          malformed();
        }
        let value = 0;
        for (let offset = 2; offset < 6; offset += 1) {
          value = (value << 4) | hexValue(text.charCodeAt(at + offset));
        }
        out += String.fromCharCode(value);
        at += 6;
      } else {
        const plain = escape === undefined ? undefined : ESCAPES[escape];
        if (plain === undefined) {
          malformed();
        }
        out += plain;
        at += 2;
      }
    }
  };

  const readKey = (): string => {
    if (text.charCodeAt(at) !== 0x22) {
      malformed();
    }
    const key = readString();
    skipSpace();
    if (text.charCodeAt(at) !== 0x3a) {
      malformed();
    }
    at += 1;
    skipSpace();
    return key;
  };

  const readScalar = (): JsonValue => {
    const literal = (word: string, value: JsonValue): JsonValue => {
      if (!text.startsWith(word, at)) {
        return malformed();
      }
      at += word.length;
      return value;
    };
    switch (text[at]) {
      case "n":
        return literal("null", null);
      case "t":
        return literal("true", true);
      case "f":
        return literal("false", false);
      case "N":
        return literal("NaN", Number.NaN);
      case "I":
        return literal("Infinity", Number.POSITIVE_INFINITY);
      default:
        break;
    }
    if (text.startsWith("-Infinity", at)) {
      at += 9;
      return Number.NEGATIVE_INFINITY;
    }
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (match === null) {
      return malformed();
    }
    const token = match[0];
    at += token.length;
    if (match[1] === undefined && match[2] === undefined) {
      const digits = token.charCodeAt(0) === 0x2d ? token.length - 1 : token.length;
      if (digits > MAX_INTEGER_DIGITS) {
        return malformed();
      }
      const integer = Number(token);
      return integer === 0 ? 0 : integer;
    }
    return Number(token);
  };

  const stack: Frame[] = [];
  skipSpace();
  for (;;) {
    if (at >= end) {
      malformed();
    }
    let value: JsonValue;
    const opener = text.charCodeAt(at);
    if (opener === 0x7b || opener === 0x5b) {
      if (stack.length >= MAX_JSON_DEPTH) {
        malformed();
      }
      at += 1;
      skipSpace();
      if (opener === 0x7b) {
        const object = Object.create(null) as JsonObject;
        if (text.charCodeAt(at) !== 0x7d) {
          stack.push({ object, key: readKey() });
          continue;
        }
        value = object;
      } else {
        if (text.charCodeAt(at) !== 0x5d) {
          stack.push({ array: [] });
          continue;
        }
        value = [];
      }
      at += 1;
    } else if (opener === 0x22) {
      value = readString();
    } else {
      value = readScalar();
    }

    for (;;) {
      skipSpace();
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        if (at !== end) {
          malformed();
        }
        return value;
      }
      const next = text.charCodeAt(at);
      if ("array" in frame) {
        frame.array.push(value);
        if (next === 0x5d) {
          at += 1;
          value = frame.array;
          stack.pop();
          continue;
        }
      } else {
        if (frame.key in frame.object) {
          malformed();
        }
        frame.object[frame.key] = value;
        if (next === 0x7d) {
          at += 1;
          value = frame.object;
          stack.pop();
          continue;
        }
      }
      if (next !== 0x2c) {
        malformed();
      }
      at += 1;
      skipSpace();
      if ("array" in frame) {
        if (text.charCodeAt(at) === 0x5d) {
          malformed();
        }
      } else {
        frame.key = readKey();
      }
      break;
    }
  }
}

/** `personal._json`. */
export function parseJsonStrict(bytes: Uint8Array): JsonValue {
  return parseJsonText(decodeJsonBytes(bytes));
}
