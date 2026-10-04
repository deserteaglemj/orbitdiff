import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";

import { InflateError, RawInflater } from "@/domain/export/inflate";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Bits in stream order, padded with zeros to a whole byte. Spaces are ignored. */
function pack(bits: string): Uint8Array {
  const clean = bits.replaceAll(" ", "");
  const out = new Uint8Array(Math.ceil(clean.length / 8));
  for (let position = 0; position < clean.length; position += 1) {
    if (clean[position] === "1") {
      out[position >> 3] |= 1 << (position & 7);
    }
  }
  return out;
}

function join(pieces: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** The zlib sentence for a stream that must be rejected. */
function rejection(stream: Uint8Array): string {
  try {
    new RawInflater().decompress(stream, 1 << 20);
  } catch (error) {
    expect(error).toBeInstanceOf(InflateError);
    return (error as InflateError).message;
  }
  throw new Error("expected the stream to be rejected");
}

/**
 * One literal zero, then copies of 258 bytes at 13 bits each, without an end.
 * Eight megabytes of it would inflate to about 1.3 GB.
 */
function endlessRun(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let position = 0;
  const put = (bits: string): void => {
    for (const bit of bits) {
      if (bit === "1") {
        out[position >> 3] |= 1 << (position & 7);
      }
      position += 1;
    }
  };
  put("110");
  put("00110000");
  while (position + 13 <= bytes * 8) {
    put("1100010100000");
  }
  return out;
}

const text = encode(
  JSON.stringify(Array.from({ length: 600 }, (_, index) => `nova_labs_${(index * 7) % 13}`)),
);

describe("RawInflater", () => {
  it.each([0, 1, 6, 9])("decodes a stream written by another compressor at level %i", (level) => {
    const inflater = new RawInflater();
    const out = inflater.decompress(deflateSync(text, { level: level as 0 | 1 | 6 | 9 }), text.length + 1);
    expect(out).toEqual(text);
    expect(inflater.eof).toBe(true);
    expect(inflater.unconsumed).toBe(0);
  });

  it("copies from the output of an earlier call", () => {
    const inflater = new RawInflater();
    // A stored block "ab" that is not final.
    const stored = inflater.decompress(fromHex("000200fdff6162"), 100);
    expect(new TextDecoder().decode(stored)).toBe("ab");
    expect(inflater.eof).toBe(false);
    // A final fixed block: the literal "c", then three bytes from two bytes back.
    const fixed = inflater.decompress(pack("1 10 10010011 0000001 00001 0000000"), 100);
    expect(new TextDecoder().decode(fixed)).toBe("cbcb");
    expect(inflater.eof).toBe(true);
  });

  it("stops at the output limit and keeps the rest of the input back", () => {
    const stream = endlessRun(8 * 1024 * 1024);
    const inflater = new RawInflater();
    const out = inflater.decompress(stream, 4097);
    expect(out.length).toBe(4097);
    expect(out.every((byte) => byte === 0)).toBe(true);
    expect(inflater.eof).toBe(false);
    // zlib has taken 28 bytes at this point: one literal and sixteen copies.
    expect(inflater.unconsumed).toBe(stream.length - 28);
  });

  it("continues from where the output limit stopped it", () => {
    const stream = deflateSync(text, { level: 9 });
    const inflater = new RawInflater();
    const pieces: Uint8Array[] = [];
    let data = stream;
    for (let round = 0; round < 1000 && !inflater.eof; round += 1) {
      const piece = inflater.decompress(data, 100);
      expect(piece.length).toBeLessThanOrEqual(100);
      pieces.push(piece);
      data = data.subarray(data.length - inflater.unconsumed);
    }
    expect(inflater.eof).toBe(true);
    expect(join(pieces)).toEqual(text);
  });

  it("continues when the input arrives one byte at a time", () => {
    for (const level of [0, 1, 9] as const) {
      const stream = deflateSync(text, { level });
      const inflater = new RawInflater();
      const pieces: Uint8Array[] = [];
      for (let index = 0; index < stream.length; index += 1) {
        expect(inflater.eof).toBe(false);
        pieces.push(inflater.decompress(stream.subarray(index, index + 1), 1 << 20));
        expect(inflater.unconsumed).toBe(0);
      }
      expect(inflater.eof).toBe(true);
      expect(join(pieces)).toEqual(text);
    }
  });

  it("waits for more input instead of failing on a stream that is cut short", () => {
    const stream = deflateSync(text, { level: 9 });
    const inflater = new RawInflater();
    const out = inflater.decompress(stream.subarray(0, stream.length - 3), 1 << 20);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toEqual(text.subarray(0, out.length));
    expect(inflater.eof).toBe(false);
    expect(inflater.unconsumed).toBe(0);
  });

  it("ends at the final block and ignores the bytes after it", () => {
    const stream = join([deflateSync(text, { level: 9 }), fromHex("07ffffffff")]);
    const inflater = new RawInflater();
    expect(inflater.decompress(stream, 1 << 20)).toEqual(text);
    expect(inflater.eof).toBe(true);
    expect(inflater.unconsumed).toBe(0);
    expect(inflater.decompress(fromHex("07"), 100).length).toBe(0);
  });

  it("accepts the incomplete code sets zlib accepts", () => {
    // Only an end-of-block code, one bit wide.
    const endOnly = new RawInflater();
    expect(endOnly.decompress(fromHex("05c0810800000000207feb03"), 100).length).toBe(0);
    expect(endOnly.eof).toBe(true);
    // One distance code, one bit wide, used by a match.
    const oneDistance = new RawInflater();
    const spaces = oneDistance.decompress(fromHex("0dc08100000000802095fc293f0b"), 100);
    expect(new TextDecoder().decode(spaces)).toBe("    ");
    expect(oneDistance.eof).toBe(true);
  });

  it("reads an empty code length code one bit per symbol, as zlib does", () => {
    const header = "05000000";
    const waiting = new RawInflater();
    expect(waiting.decompress(fromHex(header + "00".repeat(31)), 100).length).toBe(0);
    expect(waiting.eof).toBe(false);
    expect(rejection(fromHex(header + "00".repeat(32)))).toBe("invalid code -- missing end-of-block");
  });

  it("reports a distance before the start of the output only when there is room to copy", () => {
    // Five literals, then a copy from 100 bytes back.
    const stream = pack("1 10 01010001 01010001 01010001 01010001 01010001 0000001 01101 11000 0000000");
    expect(rejection(stream)).toBe("invalid distance too far back");
    const full = new RawInflater();
    expect(new TextDecoder().decode(full.decompress(stream, 5))).toBe("!!!!!");
    expect(full.eof).toBe(false);
    expect(full.unconsumed).toBe(1);
    expect(() => full.decompress(new Uint8Array(0), 1)).toThrow(InflateError);
  });

  it.each<[string, Uint8Array, string]>([
    ["a stored block with a wrong length complement", fromHex("0102000000"), "invalid stored block lengths"],
    ["block type three", pack("1 11"), "invalid block type"],
    ["287 literal and length symbols", fromHex("f50000"), "too many length or distance symbols"],
    ["31 distance symbols", fromHex("051e00"), "too many length or distance symbols"],
    ["a code length code with a single code", fromHex("05000200"), "invalid code lengths set"],
    ["an over-subscribed code length code", fromHex("05009200"), "invalid code lengths set"],
    ["a length repeat with nothing before it", fromHex("05000224"), "invalid bit length repeat"],
    ["a length repeat past the symbol count", fromHex("050080e4ff1f"), "invalid bit length repeat"],
    ["a block without an end-of-block code", fromHex("050080e47f1b"), "invalid code -- missing end-of-block"],
    ["an incomplete literal and length code", fromHex("0580810800000080fcad0f"), "invalid literal/lengths set"],
    ["an over-subscribed literal and length code", fromHex("05c0810800000000a0f7973e"), "invalid literal/lengths set"],
    ["an incomplete distance code", fromHex("05c1810000000080207feb1e"), "invalid distances set"],
    ["the unused code of a one code literal set", fromHex("05c0810800000000207feb0b"), "invalid literal/length code"],
    ["the unused code of a one code distance set", fromHex("0dc08100000000802095fc293f0f"), "invalid distance code"],
    ["a match without any distance code", fromHex("0dc0810c000000c02095fc29ff59"), "invalid distance code"],
    ["fixed table symbol 286", pack("1 10 11000110"), "invalid literal/length code"],
    ["fixed table distance symbol 30", pack("1 10 0000001 11110"), "invalid distance code"],
    ["a copy before any output", pack("1 10 0000001 00000 0000000"), "invalid distance too far back"],
  ])("rejects %s", (_label, stream, message) => {
    expect(rejection(stream)).toBe(message);
  });

  it("waits when a length repeat lacks its count bits, then rejects it once they arrive", () => {
    // Ten code length code entries put the repeat code in the last bit of the sixth byte.
    const inflater = new RawInflater();
    expect(inflater.decompress(fromHex("05c002040080"), 100).length).toBe(0);
    expect(inflater.eof).toBe(false);
    expect(inflater.unconsumed).toBe(0);
    expect(() => inflater.decompress(fromHex("00"), 100)).toThrow("invalid bit length repeat");
    expect(rejection(fromHex("05c00204008000"))).toBe("invalid bit length repeat");
  });
});
