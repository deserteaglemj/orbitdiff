import { deflateSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { DomainError, type DomainErrorCode } from "@/domain/errors";
import { HOSTED_EXPORT_LIMITS, LOCAL_EXPORT_LIMITS, parseExportFiles } from "@/domain/export";
import { RawInflater } from "@/domain/export/inflate";
import { crc32, readZipMembers } from "@/domain/export/zip";
import { LIMITS } from "@/domain/limits";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function followers(...handles: string[]): Uint8Array {
  return encode(
    JSON.stringify(
      handles.map((handle) => ({
        title: "",
        media_list_data: [],
        string_list_data: [
          { href: `https://www.instagram.com/${handle}/`, value: handle, timestamp: 1_600_000_000 },
        ],
      })),
    ),
  );
}

function following(...handles: string[]): Uint8Array {
  return encode(
    JSON.stringify({
      relationships_following: handles.map((handle) => ({
        title: handle,
        string_list_data: [{ href: `https://www.instagram.com/${handle}/`, timestamp: 1_600_000_000 }],
      })),
    }),
  );
}

function manyRows(count: number, prefix: string): Uint8Array {
  const rows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(`{"string_list_data":[{"value":"${prefix}${String(index).padStart(6, "0")}"}]}`);
  }
  return encode(`[${rows.join(",")}]`);
}

function codeOf(run: () => unknown): DomainErrorCode {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
  throw new Error("expected a rejection");
}

/** A one-member archive with every size and checksum field under the test's control. */
function archive(
  name: string,
  stored: Uint8Array,
  fields: { method: number; crc: number; size: number },
): Uint8Array {
  const label = encode(name);
  const local = new Uint8Array(30 + label.length + stored.length);
  const directory = new Uint8Array(46 + label.length);
  const end = new Uint8Array(22);
  const header = (view: DataView, at: number): void => {
    view.setUint16(at, fields.method, true);
    view.setUint16(at + 4, 0x21, true);
    view.setUint32(at + 6, fields.crc, true);
    view.setUint32(at + 10, stored.length, true);
    view.setUint32(at + 14, fields.size, true);
    view.setUint16(at + 18, label.length, true);
  };
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  header(localView, 8);
  local.set(label, 30);
  local.set(stored, 30 + label.length);
  const directoryView = new DataView(directory.buffer);
  directoryView.setUint32(0, 0x02014b50, true);
  directoryView.setUint16(4, 20, true);
  directoryView.setUint16(6, 20, true);
  header(directoryView, 10);
  directory.set(label, 46);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + directory.length + end.length);
  out.set(local, 0);
  out.set(directory, local.length);
  out.set(end, local.length + directory.length);
  return out;
}

describe("hosted export bounds", () => {
  it("takes every bound from limits.ts", () => {
    expect(HOSTED_EXPORT_LIMITS).toEqual({
      maxFileBytes: LIMITS.exportFileBytes,
      maxInputBytes: LIMITS.exportInputBytes,
      maxFiles: LIMITS.exportFiles,
      maxAccounts: LIMITS.accountsPerSnapshot,
    });
    expect(HOSTED_EXPORT_LIMITS.maxFileBytes).toBe(16 * 1024 * 1024);
    expect(HOSTED_EXPORT_LIMITS.maxInputBytes).toBe(32 * 1024 * 1024);
    expect(HOSTED_EXPORT_LIMITS.maxFiles).toBe(1024);
    expect(HOSTED_EXPORT_LIMITS.maxAccounts).toBeLessThan(LOCAL_EXPORT_LIMITS.maxAccounts);
  });

  it("accepts exactly the hosted number of usernames and rejects one more row", () => {
    const limit = LIMITS.accountsPerSnapshot;
    const full = parseExportFiles([{ name: "followers_1.json", bytes: manyRows(limit, "u") }], "atlas_studio");
    expect(full.followers).toHaveLength(limit);
    expect(full.followers?.[0]).toBe("u000000");
    expect(full.following).toBeNull();
    expect(
      codeOf(() => parseExportFiles([{ name: "followers_1.json", bytes: manyRows(limit + 1, "u") }], "atlas_studio")),
    ).toBe("too_large");
  });

  it("bounds the usernames of both directions together", () => {
    const limit = LIMITS.accountsPerSnapshot;
    const files = [
      { name: "followers_1.json", bytes: manyRows(limit - 10, "a") },
      { name: "following.json", bytes: manyRows(11, "b") },
    ];
    expect(codeOf(() => parseExportFiles(files, "atlas_studio"))).toBe("too_large");
    const fits = parseExportFiles(
      [files[0], { name: "following.json", bytes: manyRows(10, "b") }],
      "atlas_studio",
    );
    expect((fits.followers?.length ?? 0) + (fits.following?.length ?? 0)).toBe(limit);
  });

  it("bounds the number of supplied files", () => {
    const files = Array.from({ length: LIMITS.exportFiles + 1 }, (_, index) => ({
      name: `notes_${index}.txt`,
      bytes: new Uint8Array(0),
    }));
    expect(codeOf(() => parseExportFiles(files, "atlas_studio"))).toBe("too_large");
    files.pop();
    expect(codeOf(() => parseExportFiles(files, "atlas_studio"))).toBe("nothing_recognized");
  });

  it("bounds the supplied bytes before anything is decoded", () => {
    const limits = { ...HOSTED_EXPORT_LIMITS, maxInputBytes: 100 };
    const files = [
      { name: "followers_1.json", bytes: followers("nova_labs") },
      { name: "photo.bin", bytes: new Uint8Array(100) },
    ];
    expect(codeOf(() => parseExportFiles(files, "atlas_studio", limits))).toBe("too_large");
  });
});

describe("parseExportFiles", () => {
  it("returns usernames and shard numbers only", () => {
    const parsed = parseExportFiles(
      [
        { name: "followers_1.json", bytes: followers("Nova_Labs", "lunar_arch") },
        { name: "following.json", bytes: following("pixel_forge", "nova_labs") },
      ],
      "atlas_studio",
    );
    expect(parsed).toEqual({
      followers: ["lunar_arch", "nova_labs"],
      following: ["nova_labs", "pixel_forge"],
      shards: { followers: [1], following: [0] },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/instagram\.com|timestamp|1600000000/);
  });

  it("reads an archive written by another ZIP writer", () => {
    const zipped = zipSync({
      "connections/followers_and_following/followers_1.json": followers("nova_labs"),
      "connections/followers_and_following/followers_2.json": followers("pixel_forge"),
      "connections/followers_and_following/following.json": following("nova_labs"),
      "messages/inbox/chat.json": encode("private text that is never read"),
    });
    expect(parseExportFiles([{ name: "export.zip", bytes: zipped }], "atlas_studio")).toEqual({
      followers: ["nova_labs", "pixel_forge"],
      following: ["nova_labs"],
      shards: { followers: [1, 2], following: [0] },
    });
  });

  it("rejects a repeated file name, which a Python dict could not hold", () => {
    const file = { name: "followers_1.json", bytes: followers("nova_labs") };
    expect(codeOf(() => parseExportFiles([file, { ...file }], "atlas_studio"))).toBe("invalid_input");
  });

  it("rejects content that is not bytes", () => {
    const files = [{ name: "followers_1.json", bytes: "[]" as unknown as Uint8Array }];
    expect(codeOf(() => parseExportFiles(files, "atlas_studio"))).toBe("invalid_input");
  });

  it.each<[string, DomainErrorCode, Array<{ name: string; bytes: Uint8Array }>]>([
    ["an unsafe name", "unsafe_path", [{ name: "../followers_1.json", bytes: followers("nova_labs") }]],
    [
      "two roots",
      "ambiguous_roots",
      [
        { name: "followers_1.json", bytes: followers("nova_labs") },
        { name: "followers_and_following/following.json", bytes: following("nova_labs") },
      ],
    ],
    [
      "overlapping shards",
      "overlapping_shards",
      [
        { name: "followers.json", bytes: followers("nova_labs") },
        { name: "followers_1.json", bytes: followers("nova_labs") },
      ],
    ],
    ["malformed JSON", "malformed_json", [{ name: "followers_1.json", bytes: encode("[") }]],
    ["a duplicate key", "malformed_json", [{ name: "followers_1.json", bytes: encode('{"a":1,"a":2}') }]],
    ["a malformed row", "malformed_row", [{ name: "followers_1.json", bytes: encode("[1]") }]],
    [
      "conflicting handles",
      "conflicting_handle",
      [
        {
          name: "followers_1.json",
          bytes: encode('[{"title":"pixel_forge","string_list_data":[{"value":"nova_labs"}]}]'),
        },
      ],
    ],
    [
      "another owner",
      "owner_mismatch",
      [{ name: "followers_1.json", bytes: encode('{"owner":"nova_labs","relationships_followers":[]}') }],
    ],
    ["nothing recognized", "nothing_recognized", [{ name: "notes.txt", bytes: encode("hello") }]],
    ["an invalid handle", "invalid_handle", [{ name: "followers_1.json", bytes: followers("bad-name") }]],
    ["a broken archive", "unsupported_zip", [{ name: "export.zip", bytes: encode("not a zip") }]],
  ])("reports %s as %s", (_label, code, files) => {
    expect(codeOf(() => parseExportFiles(files, "atlas_studio"))).toBe(code);
  });
});

describe("bounded decompression", () => {
  const limits = { ...HOSTED_EXPORT_LIMITS, maxFileBytes: 4096, maxInputBytes: 8192 };

  /**
   * A raw DEFLATE stream that never ends: one literal zero, then copies of 258
   * bytes at 13 bits each. Eight megabytes of it inflate to about 1.3 GB.
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

  it("stops a compression bomb at the output cap", () => {
    const payload = archive("followers_1.json", endlessRun(8 * 1024 * 1024), {
      method: 8,
      crc: 0,
      size: 2,
    });
    const decompress = vi.spyOn(RawInflater.prototype, "decompress");
    try {
      expect(codeOf(() => readZipMembers(payload, limits))).toBe("unsupported_zip");
      // One round, as in zipfile: 4097 compressed bytes in, at most 4097 bytes out.
      expect(decompress.mock.calls.length).toBe(1);
      expect(decompress.mock.calls[0][0].length).toBe(limits.maxFileBytes + 1);
      expect(decompress.mock.calls[0][1]).toBe(limits.maxFileBytes + 1);
      const result = decompress.mock.results[0];
      expect(result.type).toBe("return");
      expect((result.value as Uint8Array).length).toBe(limits.maxFileBytes + 1);
    } finally {
      decompress.mockRestore();
    }
  });

  it("reads a bomb with an honest checksum as its declared prefix, as zipfile does", () => {
    const payload = archive("followers_1.json", endlessRun(8 * 1024 * 1024), {
      method: 8,
      crc: crc32(new Uint8Array(2)),
      size: 2,
    });
    const members = readZipMembers(payload, limits);
    expect(Array.from(members[0].bytes)).toEqual([0, 0]);
  });

  it("rejects a member whose stored block complement is wrong although size and checksum match", () => {
    const body = encode('[{"string_list_data":[{"value":"nova_labs"}]}]');
    const block = (complement: number): Uint8Array => {
      const stream = new Uint8Array(5 + body.length);
      const view = new DataView(stream.buffer);
      stream[0] = 1;
      view.setUint16(1, body.length, true);
      view.setUint16(3, complement, true);
      stream.set(body, 5);
      return stream;
    };
    const fields = { method: 8, crc: crc32(body), size: body.length };
    const sound = readZipMembers(archive("followers.json", block(body.length ^ 0xffff), fields), limits);
    expect(sound[0].bytes).toEqual(body);
    expect(codeOf(() => readZipMembers(archive("followers.json", block(0), fields), limits))).toBe(
      "unsupported_zip",
    );
    expect(
      codeOf(() =>
        parseExportFiles(
          [{ name: "export.zip", bytes: archive("followers.json", block(0), fields) }],
          "atlas_studio",
        ),
      ),
    ).toBe("unsupported_zip");
  });

  it("refuses a member that declares more than the file limit without inflating it", () => {
    const bomb = deflateSync(new Uint8Array(1024 * 1024));
    const payload = archive("followers_1.json", bomb, { method: 8, crc: 0, size: 1024 * 1024 });
    expect(codeOf(() => readZipMembers(payload, limits))).toBe("too_large");
  });

  it("keeps the declared prefix when the checksum matches it, as zipfile does", () => {
    const body = encode("[]   trailing bytes that the declared size leaves out");
    const payload = archive("followers_1.json", deflateSync(body), {
      method: 8,
      crc: crc32(body.subarray(0, 2)),
      size: 2,
    });
    const members = readZipMembers(payload, limits);
    expect(new TextDecoder().decode(members[0].bytes)).toBe("[]");
  });

  it("computes CRC-32 like zlib", () => {
    expect(crc32(encode(""))).toBe(0);
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(encode("6789"), crc32(encode("12345")))).toBe(0xcbf43926);
  });
});
