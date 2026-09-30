/**
 * Raw DEFLATE decoding with the acceptance rules of zlib, a port of the
 * `inflate` state machine as Python reaches it through
 * `zlib.decompressobj(-15).decompress(data, max_length)`.
 *
 * A general purpose inflater is not enough for parity. zlib refuses streams
 * that still decode to the intended bytes: a stored block whose length
 * complement is wrong, more than 286 literal and length symbols or more than
 * 30 distance symbols, an over-subscribed or incomplete code set, a length
 * repeat with nothing to repeat or past the symbol count, a block without an
 * end-of-block code, a code that stands for no symbol, and a distance that
 * reaches before the start of the output. The size and CRC-32 checks of the
 * ZIP reader cannot see any of these, so the decoder has to.
 *
 * When zlib stops matters as much as what it rejects:
 *  - It decodes as far as the supplied input allows and then waits. A broken
 *    block whose bits have not all arrived is not an error yet.
 *  - At the output limit it still walks through everything that produces no
 *    output (the end of a block, the next block header, its code sets, the
 *    next length and distance codes) and stops only when a byte has to be
 *    written. A distance is checked against the start of the output only
 *    when there is room to copy.
 *  - It takes input one byte at a time, as needed, so the count of bytes it
 *    leaves back at the output limit is exact.
 */

/**
 * Stands for `zlib.error`. The message is the sentence of zlib's reference
 * decoder. It is for diagnosis only: some zlib builds word an invalid code
 * differently, and the importer reports every one of them the same way.
 */
export class InflateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InflateError";
  }
}

const MAX_CODE_BITS = 15;
const WINDOW_SIZE = 32768;

/** Returned by `symbol` when the input ends before the code does. */
const NEED_INPUT = -1;
/** The symbol of a bit pattern that stands for no code. Larger than every real symbol. */
const NO_CODE = 0xfff;
const NO_CODE_ENTRY = (NO_CODE << 4) | 1;

const TYPE = 0;
const STORED = 1;
const COPY = 2;
const TABLE = 3;
const LENLENS = 4;
const CODELENS = 5;
const LEN = 6;
const LENEXT = 7;
const DIST = 8;
const DISTEXT = 9;
const MATCH = 10;
const LIT = 11;
const DONE = 12;

/** The order in which a dynamic block lists the widths of its code length code. */
const LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
/** Base length and extra bits of the length symbols 257 to 285. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** Base distance and extra bits of the distance symbols 0 to 29. */
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

const EMPTY = new Uint8Array(0);

interface Huffman {
  /** Index width of `direct`. */
  root: number;
  /**
   * Indexed by the next `root` bits of the stream. `(symbol << 4) | width` for
   * a code no wider than `root`, 0 for the prefix of a wider code, and
   * `NO_CODE_ENTRY` for a pattern that stands for no code.
   */
  direct: Uint16Array;
  /** Number of codes per width, for the codes wider than `root`. */
  count: Uint16Array;
  /** Symbols in code order. */
  symbols: Uint16Array;
}

function reverseBits(code: number, width: number): number {
  let out = 0;
  for (let bit = 0; bit < width; bit += 1) {
    out = (out << 1) | ((code >>> bit) & 1);
  }
  return out;
}

/**
 * `inflate_table`: the decoding table of a canonical Huffman code, or null
 * for a set of widths zlib refuses. An incomplete set is accepted only when
 * it is a single code one bit wide, and never for the code length code. A set
 * without any code is accepted; every pattern then reads as one bit that
 * stands for no code.
 */
function buildTable(
  widths: ArrayLike<number>,
  from: number,
  size: number,
  codeLengthCode: boolean,
  rootBits: number,
): Huffman | null {
  const count = new Uint16Array(MAX_CODE_BITS + 1);
  for (let index = 0; index < size; index += 1) {
    count[widths[from + index]] += 1;
  }
  count[0] = 0;
  let max = MAX_CODE_BITS;
  while (max >= 1 && count[max] === 0) {
    max -= 1;
  }
  if (max === 0) {
    return { root: 1, direct: Uint16Array.of(NO_CODE_ENTRY, NO_CODE_ENTRY), count, symbols: new Uint16Array(0) };
  }
  let left = 1;
  for (let width = 1; width <= MAX_CODE_BITS; width += 1) {
    left = left * 2 - count[width];
    if (left < 0) {
      return null;
    }
  }
  if (left > 0 && (codeLengthCode || max !== 1)) {
    return null;
  }

  const starts = new Uint16Array(MAX_CODE_BITS + 2);
  for (let width = 1; width <= MAX_CODE_BITS; width += 1) {
    starts[width + 1] = starts[width] + count[width];
  }
  const symbols = new Uint16Array(starts[MAX_CODE_BITS + 1]);
  for (let symbol = 0; symbol < size; symbol += 1) {
    const width = widths[from + symbol];
    if (width !== 0) {
      symbols[starts[width]] = symbol;
      starts[width] += 1;
    }
  }

  const root = Math.min(rootBits, max);
  const span = 1 << root;
  const direct = new Uint16Array(span).fill(NO_CODE_ENTRY);
  let code = 0;
  let index = 0;
  for (let width = 1; width <= max; width += 1) {
    for (let each = 0; each < count[width]; each += 1) {
      const reversed = reverseBits(code, width);
      if (width <= root) {
        const entry = (symbols[index] << 4) | width;
        for (let at = reversed; at < span; at += 1 << width) {
          direct[at] = entry;
        }
      } else {
        direct[reversed & (span - 1)] = 0;
      }
      code += 1;
      index += 1;
    }
    code <<= 1;
  }
  return { root, direct, count, symbols };
}

function fixedTable(widths: number[], rootBits: number): Huffman {
  const table = buildTable(widths, 0, widths.length, false, rootBits);
  if (table === null) {
    throw new Error("the fixed Huffman code is complete");
  }
  return table;
}

/** The fixed code of block type 1. Symbols 286 and 287 have codes and stand for nothing. */
const FIXED_LITERALS = fixedTable(
  Array.from({ length: 288 }, (_, symbol) => (symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8)),
  9,
);
/** Thirty-two distance codes of five bits. Symbols 30 and 31 stand for nothing. */
const FIXED_DISTANCES = fixedTable(new Array<number>(32).fill(5), 5);

/**
 * One raw DEFLATE stream, decoded across any number of `decompress` calls.
 * After an `InflateError` the inflater must not be used again.
 */
export class RawInflater {
  /** True once the final block has ended (`decompressobj.eof`). */
  eof = false;
  /**
   * How many bytes at the end of the last input were not taken because the
   * output limit was reached: the length of `decompressobj.unconsumed_tail`
   * while the stream has not ended. The caller supplies them again at the
   * start of the next input. Zero once the stream has ended; bytes after the
   * final block are never read.
   */
  unconsumed = 0;

  private mode = TYPE;
  private last = false;
  /** Bit buffer: `bits` bits of input not yet decoded, lowest first. */
  private hold = 0;
  private bits = 0;
  private input: Uint8Array = EMPTY;
  private next = 0;
  /** Bytes left in a stored block, bytes left in a copy, or the literal about to be written. */
  private length = 0;
  /** Distance of the copy in progress. */
  private offset = 0;
  private extra = 0;
  private literalCount = 0;
  private distanceCount = 0;
  private codeCount = 0;
  private have = 0;
  /** A repeat symbol whose count bits have not arrived yet, or -1. */
  private repeat = -1;
  private readonly widths = new Uint16Array(320);
  private literals: Huffman = FIXED_LITERALS;
  private distances: Huffman = FIXED_DISTANCES;
  /** The last bytes written by earlier calls, at most 32 KiB. */
  private window: Uint8Array | null = null;
  private windowFill = 0;

  /**
   * Decodes `data` until the stream ends, the input is used up, or
   * `maxLength` bytes (a positive number) have been written. Throws an
   * `InflateError` for a stream zlib refuses; what was decoded in that call is
   * then discarded, as in Python.
   */
  decompress(data: Uint8Array, maxLength: number): Uint8Array {
    this.input = data;
    this.next = 0;
    let out = new Uint8Array(Math.min(maxLength, Math.max(64, Math.min(data.length * 4, 65536))));
    let put = 0;
    const room = (wanted: number): void => {
      if (wanted > out.length) {
        const bigger = new Uint8Array(Math.min(maxLength, Math.max(wanted, out.length * 2)));
        bigger.set(out.subarray(0, put));
        out = bigger;
      }
    };
    const widths = this.widths;

    run: for (;;) {
      switch (this.mode) {
        case TYPE: {
          if (this.last) {
            this.drop(this.bits & 7);
            this.mode = DONE;
            break;
          }
          if (!this.need(3)) {
            break run;
          }
          this.last = (this.hold & 1) === 1;
          const kind = (this.hold >>> 1) & 3;
          this.drop(3);
          if (kind === 0) {
            this.mode = STORED;
          } else if (kind === 1) {
            this.literals = FIXED_LITERALS;
            this.distances = FIXED_DISTANCES;
            this.mode = LEN;
          } else if (kind === 2) {
            this.mode = TABLE;
          } else {
            throw new InflateError("invalid block type");
          }
          break;
        }
        case STORED: {
          this.drop(this.bits & 7);
          if (!this.need(32)) {
            break run;
          }
          if ((this.hold & 0xffff) !== ((this.hold >>> 16) ^ 0xffff)) {
            throw new InflateError("invalid stored block lengths");
          }
          this.length = this.hold & 0xffff;
          this.hold = 0;
          this.bits = 0;
          this.mode = COPY;
          break;
        }
        case COPY: {
          if (this.length === 0) {
            this.mode = TYPE;
            break;
          }
          const copy = Math.min(this.length, data.length - this.next, maxLength - put);
          if (copy === 0) {
            break run;
          }
          room(put + copy);
          out.set(data.subarray(this.next, this.next + copy), put);
          this.next += copy;
          put += copy;
          this.length -= copy;
          break;
        }
        case TABLE: {
          if (!this.need(14)) {
            break run;
          }
          this.literalCount = (this.hold & 31) + 257;
          this.distanceCount = ((this.hold >>> 5) & 31) + 1;
          this.codeCount = ((this.hold >>> 10) & 15) + 4;
          this.drop(14);
          if (this.literalCount > 286 || this.distanceCount > 30) {
            throw new InflateError("too many length or distance symbols");
          }
          this.have = 0;
          this.mode = LENLENS;
          break;
        }
        case LENLENS: {
          while (this.have < this.codeCount) {
            if (!this.need(3)) {
              break run;
            }
            widths[LENGTH_ORDER[this.have]] = this.hold & 7;
            this.have += 1;
            this.drop(3);
          }
          while (this.have < 19) {
            widths[LENGTH_ORDER[this.have]] = 0;
            this.have += 1;
          }
          const table = buildTable(widths, 0, 19, true, 7);
          if (table === null) {
            throw new InflateError("invalid code lengths set");
          }
          this.literals = table;
          this.have = 0;
          this.repeat = -1;
          this.mode = CODELENS;
          break;
        }
        case CODELENS: {
          const total = this.literalCount + this.distanceCount;
          while (this.have < total) {
            if (this.repeat < 0) {
              const symbol = this.symbol(this.literals);
              if (symbol === NEED_INPUT) {
                break run;
              }
              if (symbol < 16 || symbol === NO_CODE) {
                // A code length code without any code reads as width zero, one bit each.
                widths[this.have] = symbol === NO_CODE ? 0 : symbol;
                this.have += 1;
                continue;
              }
              this.repeat = symbol;
            }
            const field = this.repeat === 16 ? 2 : this.repeat === 17 ? 3 : 7;
            if (!this.need(field)) {
              break run;
            }
            let width = 0;
            let copy = (this.hold & ((1 << field) - 1)) + (this.repeat === 18 ? 11 : 3);
            if (this.repeat === 16) {
              if (this.have === 0) {
                throw new InflateError("invalid bit length repeat");
              }
              width = widths[this.have - 1];
            }
            this.drop(field);
            this.repeat = -1;
            if (this.have + copy > total) {
              throw new InflateError("invalid bit length repeat");
            }
            for (; copy > 0; copy -= 1) {
              widths[this.have] = width;
              this.have += 1;
            }
          }
          if (widths[256] === 0) {
            throw new InflateError("invalid code -- missing end-of-block");
          }
          const literals = buildTable(widths, 0, this.literalCount, false, 9);
          if (literals === null) {
            throw new InflateError("invalid literal/lengths set");
          }
          const distances = buildTable(widths, this.literalCount, this.distanceCount, false, 6);
          if (distances === null) {
            throw new InflateError("invalid distances set");
          }
          this.literals = literals;
          this.distances = distances;
          this.mode = LEN;
          break;
        }
        case LEN: {
          const symbol = this.symbol(this.literals);
          if (symbol === NEED_INPUT) {
            break run;
          }
          if (symbol < 256) {
            this.length = symbol;
            this.mode = LIT;
          } else if (symbol === 256) {
            this.mode = TYPE;
          } else if (symbol > 285) {
            throw new InflateError("invalid literal/length code");
          } else {
            this.length = LENGTH_BASE[symbol - 257];
            this.extra = LENGTH_EXTRA[symbol - 257];
            this.mode = LENEXT;
          }
          break;
        }
        case LENEXT: {
          if (!this.need(this.extra)) {
            break run;
          }
          this.length += this.hold & ((1 << this.extra) - 1);
          this.drop(this.extra);
          this.mode = DIST;
          break;
        }
        case DIST: {
          const symbol = this.symbol(this.distances);
          if (symbol === NEED_INPUT) {
            break run;
          }
          if (symbol > 29) {
            throw new InflateError("invalid distance code");
          }
          this.offset = DISTANCE_BASE[symbol];
          this.extra = DISTANCE_EXTRA[symbol];
          this.mode = DISTEXT;
          break;
        }
        case DISTEXT: {
          if (!this.need(this.extra)) {
            break run;
          }
          this.offset += this.hold & ((1 << this.extra) - 1);
          this.drop(this.extra);
          this.mode = MATCH;
          break;
        }
        case MATCH: {
          if (put === maxLength) {
            break run;
          }
          // Bytes of the distance that lie before this call's output.
          const before = this.offset - put;
          if (before > this.windowFill) {
            throw new InflateError("invalid distance too far back");
          }
          let copy = Math.min(this.length, maxLength - put);
          room(put + copy);
          this.length -= copy;
          if (before > 0 && this.window !== null) {
            for (let from = this.windowFill - before; copy > 0 && from < this.windowFill; copy -= 1) {
              out[put] = this.window[from];
              put += 1;
              from += 1;
            }
          }
          for (let from = put - this.offset; copy > 0; copy -= 1) {
            out[put] = out[from];
            put += 1;
            from += 1;
          }
          if (this.length === 0) {
            this.mode = LEN;
          }
          break;
        }
        case LIT: {
          if (put === maxLength) {
            break run;
          }
          room(put + 1);
          out[put] = this.length;
          put += 1;
          this.mode = LEN;
          break;
        }
        default:
          break run;
      }
    }

    if (this.mode === DONE) {
      this.eof = true;
      this.unconsumed = 0;
      this.window = null;
    } else {
      this.unconsumed = data.length - this.next;
      this.remember(out, put);
    }
    this.input = EMPTY;
    this.next = 0;
    return out.subarray(0, put);
  }

  /** `NEEDBITS`: takes input bytes until `count` bits are buffered. False when the input ends first. */
  private need(count: number): boolean {
    while (this.bits < count) {
      if (this.next === this.input.length) {
        return false;
      }
      this.hold |= this.input[this.next] << this.bits;
      this.next += 1;
      this.bits += 8;
    }
    return true;
  }

  /** `DROPBITS`. */
  private drop(count: number): void {
    this.hold >>>= count;
    this.bits -= count;
  }

  /**
   * Decodes one symbol, taking input only while the bits at hand cannot
   * settle the code. Returns `NEED_INPUT` when the input ends first, and
   * `NO_CODE` after one bit for a pattern without a code.
   */
  private symbol(table: Huffman): number {
    const mask = (1 << table.root) - 1;
    let entry = table.direct[this.hold & mask];
    while (((entry & 15) || table.root) > this.bits) {
      if (!this.need(this.bits + 1)) {
        return NEED_INPUT;
      }
      entry = table.direct[this.hold & mask];
    }
    if (entry !== 0) {
      this.drop(entry & 15);
      return entry >>> 4;
    }
    // A code wider than the direct table: walk the canonical code bit by bit.
    let code = 0;
    let first = 0;
    let index = 0;
    for (let width = 1; width <= MAX_CODE_BITS; width += 1) {
      if (!this.need(width)) {
        return NEED_INPUT;
      }
      code |= (this.hold >>> (width - 1)) & 1;
      const count = table.count[width];
      if (code - count < first) {
        this.drop(width);
        return table.symbols[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new InflateError("invalid code");
  }

  /** Keeps the last 32 KiB of output for distances that reach into earlier calls. */
  private remember(out: Uint8Array, count: number): void {
    if (count === 0) {
      return;
    }
    const window = this.window ?? (this.window = new Uint8Array(WINDOW_SIZE));
    if (count >= WINDOW_SIZE) {
      window.set(out.subarray(count - WINDOW_SIZE, count));
      this.windowFill = WINDOW_SIZE;
      return;
    }
    const keep = Math.min(this.windowFill, WINDOW_SIZE - count);
    window.copyWithin(0, this.windowFill - keep, this.windowFill);
    window.set(out.subarray(0, count), keep);
    this.windowFill = keep + count;
  }
}
