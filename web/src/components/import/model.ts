import { coverageDetail } from "@/components/dashboard/card-model";
import { formatLocalTime, localInputToIso } from "@/components/dashboard/local-time";
import { formatCount } from "@/components/ui/format";
import { parseCaptureTime } from "@/domain/capture-time";
import { isDomainError } from "@/domain/errors";
import { HOSTED_EXPORT_LIMITS, parseExportFiles, type ParsedExport } from "@/domain/export";
import { type Direction, memberPath, recognizeMember } from "@/domain/export/files";
import { coverage, type ImportPayload } from "@/domain/export/snapshot";
import { LIMITS } from "@/domain/limits";
import type { ImportReceiptDto, JobDto, ProfileDto } from "@/server/services/contracts";

/**
 * The rules of the import screen, without the screen. The export is parsed in
 * the browser by the domain rule `parseExportFiles` under the hosted limits.
 * What this module adds around it:
 *
 * - choosing which of the selected files are read at all. Only files the
 *   domain rule would recognize are read; everything else is listed as
 *   ignored and its content is never loaded;
 * - the summary of what was recognized;
 * - the request body, which holds usernames, shard numbers, the capture time,
 *   and the two declarations, and nothing else;
 * - the wording of the receipt and of the processing result.
 */
export interface SelectedFile {
  /** The file name. */
  name: string;
  /** Path inside a chosen folder, starting with the folder name. Empty for files chosen one by one. */
  relativePath: string;
  size: number;
}

export interface RecognizedFile {
  /** Position in the list that was selected. */
  index: number;
  /** Name relative to the selection, as the domain rule receives it. */
  name: string;
  direction: Direction;
  /** The numeric suffix of the file name, or 0 for a file without one. */
  shard: number;
  size: number;
}

export interface IgnoredFile {
  name: string;
  reason: string;
}

export type Selection =
  | { kind: "empty" }
  | { kind: "zip"; index: number; name: string; size: number }
  | { kind: "files"; recognized: RecognizedFile[]; ignored: IgnoredFile[] };

export interface ClassifiedSelection {
  selection: Selection;
  /** Why this selection cannot be read, or null. */
  problem: string | null;
}

const KB = 1024;
const MB = 1024 * 1024;

/** "512 bytes", "2 KB", "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  const megabytes = Math.round((bytes / MB) * 10) / 10;
  return `${megabytes} MB`;
}

const isZip = (name: string): boolean => name.toLowerCase().endsWith(".zip");

/** The name of a file relative to what was chosen: a chosen folder's own name is not part of it. */
function relativeName(file: SelectedFile): string {
  const segments = file.relativePath.split("/").filter((segment) => segment.length > 0);
  return segments.length >= 2 ? segments.slice(1).join("/") : file.name;
}

const INPUT_LIMIT = formatBytes(LIMITS.exportInputBytes);
const FILE_LIMIT = formatBytes(LIMITS.exportFileBytes);
const SMALLER_EXPORT =
  "Request an export from Instagram that holds only followers and following, in JSON format.";

/**
 * Decide what a selection is before any content is read: one ZIP, or a set of
 * files of which only the recognized relationship files will be read. Sizes
 * are checked here from the file metadata, so an export of several gigabytes
 * is refused without loading it.
 */
export function classifySelection(files: readonly SelectedFile[]): ClassifiedSelection {
  if (files.length === 0) {
    return {
      selection: { kind: "empty" },
      problem: "Choose a ZIP, a folder, or the followers and following JSON files of your export.",
    };
  }
  if (files.length === 1 && isZip(files[0].name)) {
    const archive = files[0];
    return {
      selection: { kind: "zip", index: 0, name: archive.name, size: archive.size },
      problem:
        archive.size > LIMITS.exportInputBytes
          ? `This ZIP is ${formatBytes(archive.size)}. An import accepts at most ${INPUT_LIMIT}. ${SMALLER_EXPORT}`
          : null,
    };
  }

  const recognized: RecognizedFile[] = [];
  const ignored: IgnoredFile[] = [];
  files.forEach((file, index) => {
    const name = relativeName(file);
    if (isZip(name)) {
      ignored.push({ name, reason: "A ZIP is read only when it is the one file chosen" });
      return;
    }
    let parts: string[];
    try {
      parts = memberPath(name);
    } catch {
      ignored.push({ name, reason: "Path not accepted" });
      return;
    }
    const member = recognizeMember(parts);
    if (member === null) {
      ignored.push({ name, reason: "Not a followers or following file" });
      return;
    }
    recognized.push({ index, name, direction: member.direction, shard: member.shard, size: file.size });
  });

  let problem: string | null = null;
  const oversized = recognized.find((file) => file.size > LIMITS.exportFileBytes);
  const total = recognized.reduce((sum, file) => sum + file.size, 0);
  if (recognized.length === 0) {
    problem =
      "No followers or following file was found in this selection. Instagram names them followers_1.json and following.json and puts them in the folder followers_and_following.";
  } else if (recognized.length > LIMITS.exportFiles) {
    problem = `This selection holds ${formatCount(recognized.length)} relationship files. An import accepts at most ${formatCount(LIMITS.exportFiles)}.`;
  } else if (oversized) {
    problem = `${oversized.name} is ${formatBytes(oversized.size)}. One relationship file may be at most ${FILE_LIMIT}.`;
  } else if (total > LIMITS.exportInputBytes) {
    problem = `The relationship files are ${formatBytes(total)} together. An import accepts at most ${INPUT_LIMIT}.`;
  }
  return { selection: { kind: "files", recognized, ignored }, problem };
}

/** The positions, in the selected list, of the files whose content has to be read. */
export function filesToRead(selection: Selection): number[] {
  if (selection.kind === "zip") return [selection.index];
  if (selection.kind === "files") return selection.recognized.map((file) => file.index);
  return [];
}

/** The name the archive is handed to the domain rule under. Its own file name is never sent anywhere. */
const ARCHIVE_NAME = "export.zip";

/**
 * Parse what was read, entirely in memory, with the domain rule and the
 * hosted limits. `contents` holds the bytes of `filesToRead(selection)`, in
 * that order. A rejected export throws the DomainError of the rule.
 */
export function parseSelection(selection: Selection, contents: readonly Uint8Array[], account: string): ParsedExport {
  if (selection.kind === "zip") {
    return parseExportFiles([{ name: ARCHIVE_NAME, bytes: contents[0] }], account, HOSTED_EXPORT_LIMITS);
  }
  const files =
    selection.kind === "files"
      ? selection.recognized.map((file, position) => ({ name: file.name, bytes: contents[position] }))
      : [];
  return parseExportFiles(files, account, HOSTED_EXPORT_LIMITS);
}

export interface DirectionSummary {
  present: boolean;
  /** Distinct usernames. */
  count: number;
  shards: number[];
  shardsContiguous: boolean;
  /** The file names the shard numbers stand for. */
  files: string[];
  text: string;
  warning: string | null;
}

export interface ImportSummary {
  followers: DirectionSummary;
  following: DirectionSummary;
  ignored: { count: number | null; text: string; names: string[] };
}

const IGNORED_NAMES_SHOWN = 8;

const shardFile = (direction: Direction, shard: number): string =>
  shard === 0 ? `${direction}.json` : `${direction}_${shard}.json`;

function summarizeDirection(parsed: ParsedExport, direction: Direction): DirectionSummary {
  const usernames = parsed[direction];
  const shards = parsed.shards[direction];
  if (usernames === null) {
    return {
      present: false,
      count: 0,
      shards: [],
      shardsContiguous: false,
      files: [],
      text: "No file in this selection. Relationships in this direction stay unknown.",
      warning: null,
    };
  }
  const contiguous = coverage(
    { ...parsed, capturedAt: null, declarations: { followers: false, following: false } },
    direction,
  ).shardsContiguous;
  const files = shards.map((shard) => shardFile(direction, shard));
  const count = `${formatCount(usernames.length)} ${usernames.length === 1 ? "username" : "usernames"}`;
  const source =
    shards.length === 1
      ? `1 file: ${files[0]} (${shards[0] === 0 ? "no shard number" : `shard ${shards[0]}`})`
      : `${shards.length} files: shards ${shards.join(", ")}`;
  return {
    present: true,
    count: usernames.length,
    shards: [...shards],
    shardsContiguous: contiguous,
    files,
    text: `${count} from ${source}.`,
    warning: contiguous
      ? null
      : "The numbered files do not run from 1 without a gap, so this direction cannot count as complete. Add the missing files to make it complete.",
  };
}

/** What was recognized, per direction, and what was left out. */
export function summarizeImport(parsed: ParsedExport, selection: Selection): ImportSummary {
  let ignored: ImportSummary["ignored"];
  if (selection.kind === "zip") {
    ignored = { count: null, text: "Every other entry of the ZIP was ignored and was not decompressed.", names: [] };
  } else {
    const names = selection.kind === "files" ? selection.ignored.map((file) => file.name) : [];
    ignored = {
      count: names.length,
      text:
        names.length === 0
          ? "No other file was chosen."
          : `${formatCount(names.length)} other ${names.length === 1 ? "file was" : "files were"} ignored and not read.`,
      names: names.slice(0, IGNORED_NAMES_SHOWN),
    };
  }
  return {
    followers: summarizeDirection(parsed, "followers"),
    following: summarizeDirection(parsed, "following"),
    ignored,
  };
}

export type CaptureInput = { ok: true; iso: string | null } | { ok: false; message: string };

/**
 * The capture time field: empty means no capture time. Otherwise the local
 * date and time is read in the user's timezone, written as an ISO string with
 * that timezone's offset, and checked by the domain rule (not in the future).
 */
export function readCaptureInput(value: string, timeZone: string, now: Date): CaptureInput {
  if (value.trim() === "") return { ok: true, iso: null };
  const local = localInputToIso(value.trim(), timeZone);
  if (!local.ok) return local;
  try {
    parseCaptureTime(local.iso, now);
  } catch (error) {
    if (isDomainError(error)) return { ok: false, message: error.message };
    throw error;
  }
  return { ok: true, iso: local.iso };
}

export interface Declarations {
  capturedAt: string | null;
  completeFollowers: boolean;
  completeFollowing: boolean;
}

/** What the answers on the screen amount to, by the domain coverage rule. */
export function coveragePreview(parsed: ParsedExport, answers: Declarations): Record<Direction, string> {
  const snapshot = {
    ...parsed,
    capturedAt: answers.capturedAt,
    declarations: { followers: answers.completeFollowers, following: answers.completeFollowing },
  };
  return {
    followers: coverageDetail(coverage(snapshot, "followers")),
    following: coverageDetail(coverage(snapshot, "following")),
  };
}

/**
 * The body of POST /api/profiles/:id/imports. A direction that is not in the
 * import is never declared complete.
 */
export function buildImportRequest(input: { account: string; parsed: ParsedExport } & Declarations): ImportPayload {
  const { parsed } = input;
  return {
    account: input.account,
    capturedAt: input.capturedAt,
    completeFollowers: parsed.followers !== null && input.completeFollowers,
    completeFollowing: parsed.following !== null && input.completeFollowing,
    followers: parsed.followers,
    following: parsed.following,
    shards: { followers: [...parsed.shards.followers], following: [...parsed.shards.following] },
  };
}

export interface ImportQuota {
  text: string;
  /** Set once today's imports are used up: the reason imports are paused, and until when. */
  paused: { title: string; detail: string } | null;
}

/** Today's import count as the screen states it. At the limit, imports are paused until the next UTC day. */
export function importQuota(used: number, limit: number, resetsAt: string, timeZone: string): ImportQuota {
  return {
    text: `Imports today: ${used} of ${limit}. An import that changes nothing does not count.`,
    paused:
      used >= limit
        ? {
            title: "Imports are paused for today.",
            detail: `You have used all ${limit} imports for today. Imports start again at ${formatLocalTime(
              resetsAt,
              timeZone,
            )}. Stored imports are unchanged.`,
          }
        : null,
  };
}

export const SENT_STATEMENT =
  "Only the usernames in your followers and following files, the shard numbers of those files, the capture time, and your two declarations are sent to OrbitDiff Web. The files themselves, and everything else in your export, stay in this browser.";

export type ReceiptKind = "baseline" | "stored" | "older" | "enriched" | "duplicate" | "declarations";

export interface ReceiptText {
  kind: ReceiptKind;
  title: string;
  detail: string;
}

/** The receipt of an import in words. The first import is a baseline and shows no differences. */
export function describeReceipt(
  receipt: ImportReceiptDto,
  context: { firstImport: boolean; timeZone: string },
): ReceiptText {
  if (receipt.duplicate) {
    return receipt.job === null
      ? {
          kind: "duplicate",
          title: "Already stored",
          detail: "This export is already stored for this profile. Nothing changed and nothing was queued.",
        }
      : {
          kind: "declarations",
          title: "Already stored, declaration updated",
          detail:
            "This export was already stored. Your completeness declaration was added to it and the profile is being processed again.",
        };
  }
  const notCurrent =
    receipt.capturedAt === null
      ? "it has no capture time, and an export is already current"
      : "an export with a later capture time is already current";
  if (receipt.provenanceEnriched) {
    return {
      kind: "enriched",
      title: "Capture time added",
      detail: `The same export was already stored without a capture time. It now has the capture time ${formatLocalTime(
        receipt.capturedAt,
        context.timeZone,
      )} and is being processed again.${receipt.current ? "" : ` It is not the current export, because ${notCurrent}.`}`,
    };
  }
  if (!receipt.current) {
    return {
      kind: "older",
      title: "Stored, not current",
      detail: `This export was stored, but it is not the current one, because ${notCurrent}.${
        receipt.capturedAt === null ? "" : " It still takes part in the comparison of your dated exports."
      }`,
    };
  }
  if (context.firstImport && receipt.capturedAt === null) {
    return {
      kind: "baseline",
      title: "Baseline stored without a capture time",
      detail:
        "This first import was stored as the baseline. It has no capture time, so it cannot be compared with other exports and no direction counts as complete. Import the same export again with its capture time to date it.",
    };
  }
  if (context.firstImport) {
    return {
      kind: "baseline",
      title: "Baseline stored",
      detail:
        "Baseline stored. A first import has nothing to be compared with, so it shows no differences. Import a later export to see differences.",
    };
  }
  return {
    kind: "stored",
    title: "Export stored",
    detail:
      "This export is now the current one. What differs from your other dated exports is shown when processing finishes.",
  };
}

export type ProcessingOutcome = "waiting" | "done" | "retrying" | "failed";

type ProcessingView = Pick<ProfileDto, "processing" | "lastFailureAt"> & {
  activeJob: Pick<JobDto, "status" | "attempts" | "lastErrorCode"> | null;
};

/** Where the processing of an import stands, read from the profile as the API returns it. */
export function processingOutcome(profile: ProcessingView, importedAt: string): ProcessingOutcome {
  if (!profile.processing) return "done";
  const active = profile.activeJob;
  if (active === null) {
    const failedAt = profile.lastFailureAt === null ? Number.NaN : new Date(profile.lastFailureAt).getTime();
    return failedAt >= new Date(importedAt).getTime() ? "failed" : "waiting";
  }
  if (active.status === "queued" && active.attempts > 0 && active.lastErrorCode !== null) return "retrying";
  return "waiting";
}

const PROCESSING_MESSAGES: Record<ProcessingOutcome | "timeout", string> = {
  waiting: "Processing import.",
  done: "Processing finished. The profile now reflects this import.",
  retrying:
    "Processing did not finish at the first attempt and will be tried again later. The last processed result stays in place until then.",
  failed: "Processing failed. The import is stored, and the last successful result is unchanged.",
  timeout:
    "This import is still waiting to be processed. The next scheduled run picks it up, and you can leave this page.",
};

export function processingMessage(outcome: ProcessingOutcome | "timeout"): string {
  return PROCESSING_MESSAGES[outcome];
}

/** How often, and how many times, the screen asks for the profile while an import is processed. */
export const POLL_INTERVAL_MS = 2_000;
export const POLL_ATTEMPTS = 45;
