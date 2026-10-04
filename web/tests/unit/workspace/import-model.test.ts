import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  buildImportRequest,
  classifySelection,
  coveragePreview,
  describeReceipt,
  filesToRead,
  formatBytes,
  importQuota,
  parseSelection,
  processingMessage,
  processingOutcome,
  readCaptureInput,
  SENT_STATEMENT,
  summarizeImport,
  type SelectedFile,
} from "@/components/import/model";
import { DomainError } from "@/domain/errors";
import { validateImportPayload } from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";
import type { ImportReceiptDto, JobDto } from "@/server/services/contracts";

const NOW = new Date("2026-09-30T12:00:00Z");
const ZONE = "America/Chicago";
const MB = 1024 * 1024;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function followersFile(...handles: string[]): Uint8Array {
  return encode(
    JSON.stringify(
      handles.map((handle) => ({
        title: "",
        media_list_data: [],
        string_list_data: [{ href: `https://www.instagram.com/${handle}`, value: handle, timestamp: 1_600_000_000 }],
      })),
    ),
  );
}

function followingFile(...handles: string[]): Uint8Array {
  return encode(
    JSON.stringify({
      relationships_following: handles.map((handle) => ({
        title: handle,
        string_list_data: [{ href: `https://www.instagram.com/${handle}`, timestamp: 1_600_000_000 }],
      })),
    }),
  );
}

const file = (name: string, size = 100, relativePath = ""): SelectedFile => ({ name, size, relativePath });

describe("classifySelection", () => {
  it("asks for a selection when nothing was chosen", () => {
    const result = classifySelection([]);
    expect(result.selection.kind).toBe("empty");
    expect(result.problem).toContain("Choose");
  });

  it("recognizes the relationship files by name and reports their direction and shard number", () => {
    const result = classifySelection([file("followers_1.json", 120), file("following.json", 80)]);
    expect(result.problem).toBeNull();
    expect(result.selection).toEqual({
      kind: "files",
      recognized: [
        { index: 0, name: "followers_1.json", direction: "followers", shard: 1, size: 120 },
        { index: 1, name: "following.json", direction: "following", shard: 0, size: 80 },
      ],
      ignored: [],
    });
  });

  it("lists every other file as ignored, with the reason, and never as recognized", () => {
    const result = classifySelection([
      file("followers_1.json"),
      file("pending_follow_requests.json"),
      file("Followers_2.json"),
      file("notes.txt"),
    ]);
    if (result.selection.kind !== "files") throw new Error("expected files");
    expect(result.selection.recognized.map((entry) => entry.name)).toEqual(["followers_1.json"]);
    expect(result.selection.ignored).toEqual([
      { name: "pending_follow_requests.json", reason: "Not a followers or following file" },
      { name: "Followers_2.json", reason: "Not a followers or following file" },
      { name: "notes.txt", reason: "Not a followers or following file" },
    ]);
  });

  it("reads a chosen folder relative to that folder", () => {
    const result = classifySelection([
      file("followers_1.json", 100, "my-export/connections/followers_and_following/followers_1.json"),
      file("following.json", 100, "my-export/connections/followers_and_following/following.json"),
      file("posts_1.json", 100, "my-export/your_instagram_activity/media/posts_1.json"),
      file("followers_1.json", 100, "my-export/old/followers_1.json"),
    ]);
    if (result.selection.kind !== "files") throw new Error("expected files");
    expect(result.selection.recognized.map((entry) => entry.name)).toEqual([
      "connections/followers_and_following/followers_1.json",
      "connections/followers_and_following/following.json",
    ]);
    expect(result.selection.ignored.map((entry) => entry.name)).toEqual([
      "your_instagram_activity/media/posts_1.json",
      "old/followers_1.json",
    ]);
  });

  it("recognizes files at the top of a chosen folder", () => {
    const result = classifySelection([file("followers_1.json", 100, "picked/followers_1.json")]);
    if (result.selection.kind !== "files") throw new Error("expected files");
    expect(result.selection.recognized.map((entry) => entry.name)).toEqual(["followers_1.json"]);
  });

  it("ignores a file whose path is not accepted instead of reading it", () => {
    const result = classifySelection([
      file("followers_1.json", 100, "picked/followers_1.json"),
      file("followers_2.json", 100, "picked/.ssh/followers_2.json"),
    ]);
    if (result.selection.kind !== "files") throw new Error("expected files");
    expect(result.selection.ignored).toEqual([{ name: ".ssh/followers_2.json", reason: "Path not accepted" }]);
  });

  it("treats one ZIP as an archive", () => {
    const result = classifySelection([file("instagram-atlas_studio.zip", 4 * MB)]);
    expect(result.problem).toBeNull();
    expect(result.selection).toEqual({ kind: "zip", index: 0, name: "instagram-atlas_studio.zip", size: 4 * MB });
  });

  it("does not open a ZIP that was chosen together with other files", () => {
    const result = classifySelection([file("followers_1.json"), file("export.zip")]);
    if (result.selection.kind !== "files") throw new Error("expected files");
    expect(result.selection.ignored).toEqual([
      { name: "export.zip", reason: "A ZIP is read only when it is the one file chosen" },
    ]);
  });

  it("refuses a ZIP above the input limit before reading it", () => {
    const result = classifySelection([file("everything.zip", LIMITS.exportInputBytes + 1)]);
    expect(result.problem).toContain("32 MB");
    expect(result.problem).toContain("followers and following");
  });

  it("refuses a relationship file above the file limit and a set above the input limit before reading them", () => {
    expect(classifySelection([file("followers_1.json", LIMITS.exportFileBytes + 1)]).problem).toContain("16 MB");
    const big = [file("followers_1.json", 12 * MB), file("followers_2.json", 12 * MB), file("followers_3.json", 12 * MB)];
    expect(classifySelection(big).problem).toContain("32 MB");
  });

  it("says what to look for when nothing in the selection is a relationship file", () => {
    const result = classifySelection([file("posts_1.json"), file("notes.txt")]);
    expect(result.problem).toContain("followers_1.json");
    expect(result.problem).toContain("following.json");
  });
});

describe("filesToRead", () => {
  it("names only the recognized files of a set, by their position in the selection", () => {
    const { selection } = classifySelection([file("notes.txt"), file("followers_1.json"), file("following.json")]);
    expect(filesToRead(selection)).toEqual([1, 2]);
  });

  it("names the one archive, and nothing for an empty selection", () => {
    expect(filesToRead(classifySelection([file("export.zip")]).selection)).toEqual([0]);
    expect(filesToRead(classifySelection([]).selection)).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("writes sizes in bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(32 * MB)).toBe("32 MB");
  });
});

describe("parseSelection and summarizeImport", () => {
  const selected = [file("followers_1.json"), file("following.json"), file("notes.txt")];
  const classified = classifySelection(selected);

  it("parses the recognized files with the domain rule and reports usernames per direction", () => {
    const parsed = parseSelection(
      classified.selection,
      [followersFile("Nova_Labs", "pixel_forge"), followingFile("nova_labs", "pixel_forge", "lunar_arch")],
      "atlas_studio",
    );
    expect(parsed).toEqual({
      followers: ["nova_labs", "pixel_forge"],
      following: ["lunar_arch", "nova_labs", "pixel_forge"],
      shards: { followers: [1], following: [0] },
    });
    const summary = summarizeImport(parsed, classified.selection);
    expect(summary.followers).toEqual({
      present: true,
      count: 2,
      shards: [1],
      shardsContiguous: true,
      files: ["followers_1.json"],
      text: "2 usernames from 1 file: followers_1.json (shard 1).",
      warning: null,
    });
    expect(summary.following.text).toBe("3 usernames from 1 file: following.json (no shard number).");
    expect(summary.ignored).toEqual({
      count: 1,
      text: "1 other file was ignored and not read.",
      names: ["notes.txt"],
    });
  });

  it("says that a direction without a file stays unknown", () => {
    const only = classifySelection([file("followers_1.json")]);
    const parsed = parseSelection(only.selection, [followersFile("nova_labs")], "atlas_studio");
    const summary = summarizeImport(parsed, only.selection);
    expect(parsed.following).toBeNull();
    expect(summary.following.present).toBe(false);
    expect(summary.following.text).toBe("No file in this selection. Relationships in this direction stay unknown.");
    expect(summary.followers.text).toBe("1 username from 1 file: followers_1.json (shard 1).");
  });

  it("warns when a numbered set has a gap, because that direction cannot count as complete", () => {
    const gap = classifySelection([file("followers_1.json"), file("followers_3.json")]);
    const parsed = parseSelection(gap.selection, [followersFile("nova_labs"), followersFile("pixel_forge")], "atlas_studio");
    const summary = summarizeImport(parsed, gap.selection);
    expect(summary.followers.shardsContiguous).toBe(false);
    expect(summary.followers.text).toBe("2 usernames from 2 files: shards 1, 3.");
    expect(summary.followers.warning).toContain("cannot count as complete");
  });

  it("reads a ZIP through the same rule and says that the rest of it was not opened", () => {
    const zipped = zipSync({
      "connections/followers_and_following/followers_1.json": followersFile("nova_labs"),
      "connections/followers_and_following/following.json": followingFile("nova_labs", "pixel_forge"),
      "media/posts_1.json": encode("[]"),
    });
    const archive = classifySelection([file("export.zip", zipped.length)]);
    const parsed = parseSelection(archive.selection, [zipped], "atlas_studio");
    expect(parsed.followers).toEqual(["nova_labs"]);
    expect(parsed.following).toEqual(["nova_labs", "pixel_forge"]);
    const summary = summarizeImport(parsed, archive.selection);
    expect(summary.followers.files).toEqual(["followers_1.json"]);
    expect(summary.ignored.text).toBe("Every other entry of the ZIP was ignored and was not decompressed.");
  });

  it("lets the domain error through with its own message", () => {
    const owner = encode(JSON.stringify({ account: "nova_labs", relationships_followers: [] }));
    const one = classifySelection([file("followers_1.json")]);
    let caught: unknown;
    try {
      parseSelection(one.selection, [owner], "atlas_studio");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toBe("The export account does not match the selected account.");
  });
});

describe("readCaptureInput", () => {
  it("is no capture time when the field is empty", () => {
    expect(readCaptureInput("", ZONE, NOW)).toEqual({ ok: true, iso: null });
  });

  it("converts the local time to an ISO string with the offset of the user's timezone", () => {
    expect(readCaptureInput("2026-09-20T12:00", ZONE, NOW)).toEqual({ ok: true, iso: "2026-09-20T12:00:00-05:00" });
  });

  it("refuses a time in the future with the domain message", () => {
    const result = readCaptureInput("2026-10-02T12:00", ZONE, NOW);
    expect(result).toEqual({
      ok: false,
      message: "The capture time must be a valid, non-future timestamp with a timezone.",
    });
  });

  it("refuses text that is not a date and time", () => {
    expect(readCaptureInput("yesterday", ZONE, NOW).ok).toBe(false);
  });
});

describe("coveragePreview", () => {
  const parsed = { followers: ["nova_labs"], following: null, shards: { followers: [1], following: [] } };

  it("shows what the declarations amount to with the domain coverage rule", () => {
    expect(
      coveragePreview(parsed, { capturedAt: "2026-09-20T12:00:00-05:00", completeFollowers: true, completeFollowing: true }),
    ).toEqual({ followers: "Complete, declared by you", following: "Not supplied" });
  });

  it("shows that a declaration without a capture time does not make a direction complete", () => {
    expect(coveragePreview(parsed, { capturedAt: null, completeFollowers: true, completeFollowing: false })).toEqual({
      followers: "Partial: no capture time",
      following: "Not supplied",
    });
  });
});

describe("buildImportRequest", () => {
  const parsed = {
    followers: ["nova_labs", "pixel_forge"],
    following: ["nova_labs"],
    shards: { followers: [1], following: [0] },
  };

  it("holds only usernames, shard numbers, the capture time, and the two declarations", () => {
    const body = buildImportRequest({
      account: "atlas_studio",
      parsed,
      capturedAt: "2026-09-20T12:00:00-05:00",
      completeFollowers: true,
      completeFollowing: false,
    });
    expect(body).toEqual({
      account: "atlas_studio",
      capturedAt: "2026-09-20T12:00:00-05:00",
      completeFollowers: true,
      completeFollowing: false,
      followers: ["nova_labs", "pixel_forge"],
      following: ["nova_labs"],
      shards: { followers: [1], following: [0] },
    });
  });

  it("is accepted by the rule the server applies", () => {
    const body = buildImportRequest({
      account: "atlas_studio",
      parsed,
      capturedAt: "2026-09-20T12:00:00-05:00",
      completeFollowers: true,
      completeFollowing: true,
    });
    const normalized = validateImportPayload(body, { account: "atlas_studio", now: NOW, limits: LIMITS });
    expect(normalized.capturedAt).toBe("2026-09-20T17:00:00+00:00");
    expect(normalized.declarations).toEqual({ followers: true, following: true });
  });

  it("never declares a direction complete that is not in the import", () => {
    const body = buildImportRequest({
      account: "atlas_studio",
      parsed: { followers: ["nova_labs"], following: null, shards: { followers: [0], following: [] } },
      capturedAt: null,
      completeFollowers: true,
      completeFollowing: true,
    });
    expect(body.completeFollowing).toBe(false);
    expect(body.following).toBeNull();
    expect(body.capturedAt).toBeNull();
  });
});

describe("importQuota", () => {
  it("states how many imports are used and nothing else while some are left", () => {
    expect(importQuota(2, 10, "2026-10-01T00:00:00.000Z", ZONE)).toEqual({
      text: "Imports today: 2 of 10. An import that changes nothing does not count.",
      paused: null,
    });
  });

  it("says that imports are paused, and until when, once the daily limit is used", () => {
    expect(importQuota(10, 10, "2026-10-01T00:00:00.000Z", ZONE)).toEqual({
      text: "Imports today: 10 of 10. An import that changes nothing does not count.",
      paused: {
        title: "Imports are paused for today.",
        detail:
          "You have used all 10 imports for today. Imports start again at 30 Sep 2026, 19:00 (America/Chicago). Stored imports are unchanged.",
      },
    });
  });
});

describe("SENT_STATEMENT", () => {
  it("says what is sent and that the rest stays in the browser", () => {
    for (const part of ["usernames", "shard numbers", "capture time", "declarations", "stay in this browser"]) {
      expect(SENT_STATEMENT, part).toContain(part);
    }
  });
});

describe("describeReceipt", () => {
  const job: JobDto = {
    id: "j1",
    kind: "derive_profile",
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    runAfter: "2026-09-30T12:00:00.000Z",
    createdAt: "2026-09-30T12:00:00.000Z",
    finishedAt: null,
    lastErrorCode: null,
  };
  const receipt = (overrides: Partial<ImportReceiptDto> = {}): ImportReceiptDto => ({
    snapshotId: "s1",
    duplicate: false,
    provenanceEnriched: false,
    current: true,
    capturedAt: "2026-09-20T17:00:00+00:00",
    importedAt: "2026-09-30T12:00:00.000Z",
    job,
    ...overrides,
  });

  it("calls the first import a baseline with no differences", () => {
    const text = describeReceipt(receipt(), { firstImport: true, timeZone: ZONE });
    expect(text.kind).toBe("baseline");
    expect(text.title).toBe("Baseline stored");
    expect(text.detail).toContain("Import a later export to see differences.");
  });

  it("says that an undated first import cannot be compared until it has a capture time", () => {
    const text = describeReceipt(receipt({ capturedAt: null }), { firstImport: true, timeZone: ZONE });
    expect(text.kind).toBe("baseline");
    expect(text.title).toBe("Baseline stored without a capture time");
    expect(text.detail).toContain("cannot be compared");
    expect(text.detail).toContain("Import the same export again with its capture time");
  });

  it("says that a later import is stored and current", () => {
    const text = describeReceipt(receipt(), { firstImport: false, timeZone: ZONE });
    expect(text.kind).toBe("stored");
    expect(text.detail).toContain("current");
  });

  it("says that a duplicate changed nothing", () => {
    const text = describeReceipt(receipt({ duplicate: true, job: null }), { firstImport: false, timeZone: ZONE });
    expect(text.kind).toBe("duplicate");
    expect(text.title).toBe("Already stored");
    expect(text.detail).toContain("Nothing changed");
  });

  it("says when a duplicate updated the completeness declaration", () => {
    const text = describeReceipt(receipt({ duplicate: true }), { firstImport: false, timeZone: ZONE });
    expect(text.kind).toBe("declarations");
    expect(text.detail).toContain("declaration");
  });

  it("says when a stored export gained its capture time", () => {
    const text = describeReceipt(receipt({ provenanceEnriched: true }), { firstImport: false, timeZone: ZONE });
    expect(text.kind).toBe("enriched");
    expect(text.detail).toContain("20 Sep 2026, 12:00 (America/Chicago)");
  });

  it("says that an older export is stored but not current, and why", () => {
    const older = describeReceipt(receipt({ current: false }), { firstImport: false, timeZone: ZONE });
    expect(older.kind).toBe("older");
    expect(older.title).toBe("Stored, not current");
    expect(older.detail).toContain("later capture time");
    const undated = describeReceipt(receipt({ current: false, capturedAt: null }), { firstImport: false, timeZone: ZONE });
    expect(undated.detail).toContain("no capture time");
  });
});

describe("processingOutcome", () => {
  const queued = { status: "queued" as const, attempts: 0, lastErrorCode: null };
  const importedAt = "2026-09-30T12:00:00.000Z";

  it("is done when the derived data has caught up", () => {
    expect(processingOutcome({ processing: false, activeJob: null, lastFailureAt: null }, importedAt)).toBe("done");
  });

  it("waits while the job is queued or running", () => {
    expect(processingOutcome({ processing: true, activeJob: queued, lastFailureAt: null }, importedAt)).toBe("waiting");
    expect(
      processingOutcome({ processing: true, activeJob: { ...queued, status: "running", attempts: 1 }, lastFailureAt: null }, importedAt),
    ).toBe("waiting");
  });

  it("reports a retry that is scheduled for later", () => {
    expect(
      processingOutcome(
        { processing: true, activeJob: { status: "queued", attempts: 1, lastErrorCode: "handler_error" }, lastFailureAt: null },
        importedAt,
      ),
    ).toBe("retrying");
  });

  it("reports a failure that happened after this import and left no job", () => {
    expect(
      processingOutcome({ processing: true, activeJob: null, lastFailureAt: "2026-09-30T12:40:00.000Z" }, importedAt),
    ).toBe("failed");
  });

  it("does not blame this import for an older failure", () => {
    expect(
      processingOutcome({ processing: true, activeJob: null, lastFailureAt: "2026-09-29T09:00:00.000Z" }, importedAt),
    ).toBe("waiting");
  });
});

describe("processingMessage", () => {
  it("has a sentence for every outcome and for giving up waiting", () => {
    expect(processingMessage("done")).toBe("Processing finished. The profile now reflects this import.");
    expect(processingMessage("failed")).toContain("last successful result is unchanged");
    expect(processingMessage("retrying")).toContain("tried again");
    expect(processingMessage("waiting")).toBe("Processing import.");
    expect(processingMessage("timeout")).toContain("next scheduled run");
  });
});
