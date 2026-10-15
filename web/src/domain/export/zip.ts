import { DomainError } from "../errors";
import { type ExportFile, type ExportLimits, memberPath, recognizeMember } from "./files";
import { InflateError, RawInflater } from "./inflate";

/**
 * Bounded ZIP reading, a port of `personal._check_zip_directory` and
 * `personal._zip_files` together with the parts of CPython 3.13 `zipfile`
 * they rely on (`_EndRecData`, `_RealGetContents`, `ZipInfo._decodeExtra`,
 * `ZipFile.open`, `ZipExtFile.read`).
 *
 * The central directory is bounded before any member is touched, and only
 * recognized relationship members are decompressed. Decompression is done by
 * `RawInflater`, a port of zlib's `inflate`, with the output limit Python
 * passes, so a compression bomb cannot grow past the per-file limit.
 *
 * The size and CRC-32 checks do not make a member sound on their own: zlib
 * refuses DEFLATE data that still decodes to the right bytes (a wrong stored
 * block complement, a bad code set, a code without a symbol after the
 * content, and more), and Python then rejects the archive. The port rejects
 * exactly the same streams. `archives.mutations` in the golden file pins
 * every single-byte change to the DEFLATE data of four members.
 *
 * Differences from Python that remain, all limited to hand-built archives:
 *  - A member name that is not valid UTF-8 while flagged as UTF-8 makes
 *    Python raise the codec's own sentence. Here it is reported as an
 *    archive that could not be read safely. Both sides reject.
 *  - A ZIP64 record that declares a directory of 2^63 bytes or more crashes
 *    Python with an OverflowError. Here it is an unreadable archive.
 */
const UNREADABLE = "The export ZIP could not be read safely.";
const INVALID_DIRECTORY = "The export ZIP directory is invalid.";
const TOO_MANY = "The archive contains too many files for the import limit.";
const UNSUPPORTED = "Unsupported export ZIP directory structure.";

const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const DIRECTORY_ENTRY_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_RECORD_SIZE = 56;
const MAX_EXTRACT_VERSION = 63;
const MIN_READ_SIZE = 4096;
const MARKER_32 = 0xffffffff;

const FLAG_ENCRYPTED = 1;
const FLAG_COMPRESSED_PATCH = 1 << 5;
const FLAG_STRONG_ENCRYPTION = 1 << 6;
const FLAG_UTF8 = 1 << 11;

const ZERO = BigInt(0);
const BIG_32 = BigInt(32);
const BIG_MARKER_32 = BigInt(MARKER_32);
const BIG_MARKER_64 = (BigInt(MARKER_32) << BIG_32) + BigInt(MARKER_32);

/** Stands for BadZipFile, zlib.error, RuntimeError, NotImplementedError, and EOFError. */
class Unreadable extends Error {}

function unreadable(): never {
  throw new Unreadable();
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u64(bytes: Uint8Array, at: number): bigint {
  return BigInt(u32(bytes, at)) + (BigInt(u32(bytes, at + 4)) << BIG_32);
}

function hasSignature(bytes: Uint8Array, at: number, third: number, fourth: number): boolean {
  return (
    at >= 0 &&
    at + 4 <= bytes.length &&
    bytes[at] === 0x50 &&
    bytes[at + 1] === 0x4b &&
    bytes[at + 2] === third &&
    bytes[at + 3] === fourth
  );
}

/** `bytes.rfind(b"PK\x05\x06", start)`. */
function lastEndSignature(bytes: Uint8Array, start: number): number {
  for (let at = bytes.length - 4; at >= start; at -= 1) {
    if (hasSignature(bytes, at, 0x05, 0x06)) {
      return at;
    }
  }
  return -1;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 as in `zlib.crc32(data, seed)`. */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let value = ~seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  }
  return ~value >>> 0;
}

const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
  "áíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** The historical ZIP file name encoding, as `bytes.decode("cp437")`. */
export function decodeCp437(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    out += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  }
  return out;
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return unreadable();
  }
}

/** `zipfile._sanitize_filename` on a POSIX host: the name ends at the first null character. */
function sanitizeName(name: string): string {
  const cut = name.indexOf("\u0000");
  return cut >= 0 ? name.slice(0, cut) : name;
}

/**
 * `personal._check_zip_directory`: bounds the central directory before a
 * single entry is materialized.
 */
export function checkZipDirectory(payload: Uint8Array, maxFiles: number): void {
  const end = lastEndSignature(payload, Math.max(0, payload.length - (MAX_COMMENT + END_SIZE)));
  if (end < 0 || payload.length - end < END_SIZE) {
    throw new DomainError("unsupported_zip", INVALID_DIRECTORY);
  }
  const disk = u16(payload, end + 4);
  const directoryDisk = u16(payload, end + 6);
  const countHere = u16(payload, end + 8);
  const count = u16(payload, end + 10);
  const size = u32(payload, end + 12);
  const offset = u32(payload, end + 16);
  const commentLength = u16(payload, end + 20);
  if (countHere > maxFiles || count > maxFiles) {
    throw new DomainError("too_large", TOO_MANY);
  }
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    countHere !== count ||
    end + END_SIZE + commentLength !== payload.length ||
    size > end ||
    size === MARKER_32 ||
    offset === MARKER_32
  ) {
    throw new DomainError("unsupported_zip", UNSUPPORTED);
  }
  let position = end - size;
  let seen = 0;
  while (position < end) {
    if (position + DIRECTORY_ENTRY_SIZE > end || !hasSignature(payload, position, 0x01, 0x02)) {
      throw new DomainError("unsupported_zip", INVALID_DIRECTORY);
    }
    const nameLength = u16(payload, position + 28);
    position +=
      DIRECTORY_ENTRY_SIZE + nameLength + u16(payload, position + 30) + u16(payload, position + 32);
    seen += 1;
    if (seen > maxFiles) {
      throw new DomainError("too_large", TOO_MANY);
    }
    if (nameLength > 1024 || position > end) {
      throw new DomainError("unsupported_zip", "The export ZIP member path exceeds its size limit.");
    }
  }
  if (seen !== count) {
    throw new DomainError("unsupported_zip", "The export ZIP directory entry count is invalid.");
  }
}

interface EndRecord {
  /** Offset of the end record in the payload. */
  location: number;
  size: bigint;
  offset: bigint;
  zip64: boolean;
}

/** `zipfile._EndRecData64`: a ZIP64 locator directly before the end record replaces its values. */
function applyZip64(payload: Uint8Array, record: EndRecord): EndRecord {
  const locatorAt = Math.max(0, record.location - ZIP64_LOCATOR_SIZE);
  if (locatorAt + ZIP64_LOCATOR_SIZE > payload.length || !hasSignature(payload, locatorAt, 0x06, 0x07)) {
    return record;
  }
  if (u32(payload, locatorAt + 4) !== 0 || u32(payload, locatorAt + 16) > 1) {
    return unreadable();
  }
  const recordAt = Math.max(0, record.location - ZIP64_LOCATOR_SIZE - ZIP64_RECORD_SIZE);
  if (recordAt + ZIP64_RECORD_SIZE > payload.length || !hasSignature(payload, recordAt, 0x06, 0x06)) {
    return record;
  }
  return {
    location: record.location,
    size: u64(payload, recordAt + 40),
    offset: u64(payload, recordAt + 48),
    zip64: true,
  };
}

/** `zipfile._EndRecData`. */
function readEndRecord(payload: Uint8Array): EndRecord {
  const length = payload.length;
  const tail = length - END_SIZE;
  if (
    tail >= 0 &&
    hasSignature(payload, tail, 0x05, 0x06) &&
    payload[length - 2] === 0 &&
    payload[length - 1] === 0
  ) {
    return applyZip64(payload, {
      location: tail,
      size: BigInt(u32(payload, tail + 12)),
      offset: BigInt(u32(payload, tail + 16)),
      zip64: false,
    });
  }
  const start = lastEndSignature(payload, Math.max(length - MAX_COMMENT - END_SIZE, 0));
  if (start < 0 || start + END_SIZE > length) {
    return unreadable();
  }
  return applyZip64(payload, {
    location: start,
    size: BigInt(u32(payload, start + 12)),
    offset: BigInt(u32(payload, start + 16)),
    zip64: false,
  });
}

interface DirectoryEntry {
  /** Name as decoded from the directory, before any cleanup. */
  originalName: string;
  /** Name the importer sees (`ZipInfo.filename`). */
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressSize: bigint;
  fileSize: bigint;
  externalAttributes: number;
  headerOffset: bigint;
  /** Start of the next local header, or of the central directory. */
  endOffset: bigint;
}

/** `ZipInfo._decodeExtra`: ZIP64 sizes and the Unicode path field. */
function decodeExtra(entry: DirectoryEntry, extraField: Uint8Array, nameCrc: number): void {
  let extra = extraField;
  while (extra.length >= 4) {
    const kind = u16(extra, 0);
    const length = u16(extra, 2);
    if (length + 4 > extra.length) {
      unreadable();
    }
    if (kind === 0x0001) {
      let data = extra.subarray(4, length + 4);
      const take = (): bigint => {
        if (data.length < 8) {
          unreadable();
        }
        const value = u64(data, 0);
        data = data.subarray(8);
        return value;
      };
      if (entry.fileSize === BIG_MARKER_64 || entry.fileSize === BIG_MARKER_32) {
        entry.fileSize = take();
      }
      if (entry.compressSize === BIG_MARKER_32) {
        entry.compressSize = take();
      }
      if (entry.headerOffset === BIG_MARKER_32) {
        entry.headerOffset = take();
      }
    } else if (kind === 0x7075) {
      const data = extra.subarray(4, length + 4);
      if (data.length < 5) {
        unreadable();
      }
      if (data[0] === 1 && u32(data, 1) === nameCrc) {
        const unicodeName = decodeUtf8Strict(data.subarray(5));
        if (unicodeName !== "") {
          entry.name = sanitizeName(unicodeName);
        }
      }
    }
    extra = extra.subarray(length + 4);
  }
}

/** `ZipFile._RealGetContents`. */
function readDirectory(payload: Uint8Array): DirectoryEntry[] {
  const end = readEndRecord(payload);
  let concat = BigInt(end.location) - end.size - end.offset;
  if (end.zip64) {
    concat -= BigInt(ZIP64_RECORD_SIZE + ZIP64_LOCATOR_SIZE);
  }
  const startDirectory = end.offset + concat;
  if (startDirectory < ZERO) {
    unreadable();
  }
  const length = BigInt(payload.length);
  const from = startDirectory > length ? length : startDirectory;
  const until = startDirectory + end.size > length ? length : startDirectory + end.size;
  const data = payload.subarray(Number(from), Number(until));

  const entries: DirectoryEntry[] = [];
  let at = 0;
  while (BigInt(at) < end.size) {
    if (at + DIRECTORY_ENTRY_SIZE > data.length || !hasSignature(data, at, 0x01, 0x02)) {
      unreadable();
    }
    const flags = u16(data, at + 8);
    const nameLength = u16(data, at + 28);
    const extraLength = u16(data, at + 30);
    const commentLength = u16(data, at + 32);
    const nameStart = at + DIRECTORY_ENTRY_SIZE;
    const nameBytes = data.subarray(nameStart, nameStart + nameLength);
    const originalName = flags & FLAG_UTF8 ? decodeUtf8Strict(nameBytes) : decodeCp437(nameBytes);
    const entry: DirectoryEntry = {
      originalName,
      name: sanitizeName(originalName),
      flags,
      method: u16(data, at + 10),
      crc: u32(data, at + 16),
      compressSize: BigInt(u32(data, at + 20)),
      fileSize: BigInt(u32(data, at + 24)),
      externalAttributes: u32(data, at + 38),
      headerOffset: BigInt(u32(data, at + 42)),
      endOffset: ZERO,
    };
    if (data[at + 6] > MAX_EXTRACT_VERSION) {
      unreadable();
    }
    decodeExtra(
      entry,
      data.subarray(nameStart + nameLength, nameStart + nameLength + extraLength),
      crc32(nameBytes),
    );
    entry.headerOffset += concat;
    entries.push(entry);
    at += DIRECTORY_ENTRY_SIZE + nameLength + extraLength + commentLength;
  }

  const order = entries
    .map((_, index) => index)
    .sort((left, right) => {
      const a = entries[left].headerOffset;
      const b = entries[right].headerOffset;
      return a < b ? -1 : a > b ? 1 : left - right;
    });
  let endOffset = startDirectory;
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const entry = entries[order[index]];
    entry.endOffset = endOffset;
    endOffset = entry.headerOffset;
  }
  return entries;
}

function concatenate(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    const room = length - at;
    if (room <= 0) {
      break;
    }
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}

/** `ZipExtFile.read` for a stored member, step for step. */
function readStored(
  payload: Uint8Array,
  dataStart: number,
  entry: DirectoryEntry,
  maxFileBytes: number,
): Uint8Array {
  let left = Number(entry.fileSize);
  let compressLeft = entry.compressSize;
  let wanted = maxFileBytes + 1;
  let position = dataStart;
  let checksum = 0;
  let finished = false;
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (wanted > 0 && !finished) {
    let data = payload.subarray(0, 0);
    if (compressLeft > ZERO) {
      const request = BigInt(Math.max(wanted, MIN_READ_SIZE));
      const take = Number(request < compressLeft ? request : compressLeft);
      const from = Math.min(position, payload.length);
      data = payload.subarray(from, Math.min(from + take, payload.length));
      position += data.length;
      compressLeft -= BigInt(data.length);
      if (data.length === 0) {
        unreadable();
      }
    }
    finished = compressLeft <= ZERO;
    data = data.subarray(0, left);
    left -= data.length;
    if (left <= 0) {
      finished = true;
    }
    checksum = crc32(data, checksum);
    if (finished && checksum !== entry.crc) {
      unreadable();
    }
    chunks.push(data);
    total += data.length;
    wanted -= data.length;
  }
  return concatenate(chunks, total);
}

/**
 * `ZipExtFile.read` for a deflated member, step for step (`_read1`, `_read2`).
 *
 * Each round hands zlib the input it left back plus the next compressed bytes
 * (as many as are still wanted, at least 4096, at most what the member
 * declares) and lets it write as many bytes as are still wanted, at least
 * 4096. What comes out is cut to the declared size. The CRC-32 is compared
 * once the member is finished: the stream ended, the compressed bytes ran
 * out, or the declared size was reached.
 *
 * So zlib decodes whatever it was handed, not only the declared size. A
 * broken block after the content is an error when it lies inside a read and
 * before the output limit, and is never seen otherwise.
 *
 * `decompressobj.flush()`, which Python calls on a finished member, cannot
 * change the result and is left out. When the input ran out, zlib has nothing
 * left to decode. When the output limit was reached, the bytes are cut to the
 * declared size, which is below that limit. It never raises for bad data.
 */
function readDeflated(
  payload: Uint8Array,
  dataStart: number,
  entry: DirectoryEntry,
  maxFileBytes: number,
): Uint8Array {
  const inflater = new RawInflater();
  let left = Number(entry.fileSize);
  let compressLeft = entry.compressSize;
  let wanted = maxFileBytes + 1;
  let position = Math.min(dataStart, payload.length);
  let checksum = 0;
  let finished = false;
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (wanted > 0 && !finished) {
    // `_read1`: the input zlib left back is the end of what it was handed last time.
    const held = inflater.unconsumed;
    const start = position - held;
    if (wanted > held && compressLeft > ZERO) {
      // `_read2`: reading nothing while the member declares more is an EOFError.
      const request = BigInt(Math.max(wanted - held, MIN_READ_SIZE));
      const take = Number(request < compressLeft ? request : compressLeft);
      const end = Math.min(position + take, payload.length);
      if (end === position) {
        unreadable();
      }
      compressLeft -= BigInt(end - position);
      position = end;
    }
    let data: Uint8Array;
    try {
      data = inflater.decompress(payload.subarray(start, position), Math.max(wanted, MIN_READ_SIZE));
    } catch (error) {
      if (error instanceof InflateError) {
        unreadable();
      }
      throw error;
    }
    finished = inflater.eof || (compressLeft <= ZERO && inflater.unconsumed === 0);
    data = data.subarray(0, left);
    left -= data.length;
    if (left <= 0) {
      finished = true;
    }
    checksum = crc32(data, checksum);
    if (finished && checksum !== entry.crc) {
      unreadable();
    }
    chunks.push(data);
    total += data.length;
    wanted -= data.length;
  }
  return concatenate(chunks, total);
}

/** `ZipFile.open` followed by `read(limit + 1)` for one recognized member. */
function readMember(payload: Uint8Array, entry: DirectoryEntry, maxFileBytes: number): Uint8Array {
  if (entry.headerOffset < ZERO) {
    throw new DomainError("unsupported_zip", `negative seek value ${entry.headerOffset.toString()}`);
  }
  if (entry.headerOffset + BigInt(LOCAL_HEADER_SIZE) > BigInt(payload.length)) {
    unreadable();
  }
  const header = Number(entry.headerOffset);
  if (!hasSignature(payload, header, 0x03, 0x04)) {
    unreadable();
  }
  const localFlags = u16(payload, header + 6);
  const nameStart = header + LOCAL_HEADER_SIZE;
  const nameBytes = payload.subarray(nameStart, nameStart + u16(payload, header + 26));
  const dataStart = nameStart + nameBytes.length + u16(payload, header + 28);
  if (entry.flags & FLAG_COMPRESSED_PATCH || entry.flags & FLAG_STRONG_ENCRYPTION) {
    unreadable();
  }
  const localName = localFlags & FLAG_UTF8 ? decodeUtf8Strict(nameBytes) : decodeCp437(nameBytes);
  if (localName !== entry.originalName) {
    unreadable();
  }
  if (
    BigInt(dataStart) + entry.compressSize > entry.endOffset &&
    entry.endOffset !== entry.headerOffset
  ) {
    unreadable();
  }
  return entry.method === 0
    ? readStored(payload, dataStart, entry, maxFileBytes)
    : readDeflated(payload, dataStart, entry, maxFileBytes);
}

/**
 * `personal._zip_files`: the recognized members of one archive, in central
 * directory order, each checked against the declared size and CRC-32.
 */
export function readZipMembers(payload: Uint8Array, limits: ExportLimits): ExportFile[] {
  checkZipDirectory(payload, limits.maxFiles);
  try {
    const entries = readDirectory(payload);
    if (entries.length > limits.maxFiles) {
      throw new DomainError("too_large", TOO_MANY);
    }
    const result: ExportFile[] = [];
    const seen = new Set<string>();
    let total = ZERO;
    for (const entry of entries) {
      const parts = memberPath(entry.name);
      if (seen.has(entry.name)) {
        throw new DomainError("unsupported_zip", "Duplicate archive member paths are not accepted.");
      }
      seen.add(entry.name);
      const kind = (entry.externalAttributes >>> 16) & 0xf000;
      if (kind !== 0 && kind !== 0x8000 && kind !== 0x4000) {
        throw new DomainError(
          "unsupported_zip",
          "Archive members must be regular files or directories without links.",
        );
      }
      if (entry.name.endsWith("/") || recognizeMember(parts) === null) {
        continue;
      }
      if (entry.flags & FLAG_ENCRYPTED || (entry.method !== 0 && entry.method !== 8)) {
        throw new DomainError(
          "unsupported_zip",
          "Encrypted or unsupported archive compression is not accepted.",
        );
      }
      total += entry.fileSize;
      if (entry.fileSize > BigInt(limits.maxFileBytes) || total > BigInt(limits.maxInputBytes)) {
        throw new DomainError("too_large", "The decompressed export exceeds the import size limit.");
      }
      const content = readMember(payload, entry, limits.maxFileBytes);
      if (content.length > limits.maxFileBytes || BigInt(content.length) !== entry.fileSize) {
        throw new DomainError("too_large", "The decompressed member exceeds its size limit.");
      }
      result.push({ name: parts.join("/"), bytes: content });
    }
    return result;
  } catch (error) {
    if (error instanceof Unreadable) {
      throw new DomainError("unsupported_zip", UNREADABLE);
    }
    throw error;
  }
}
