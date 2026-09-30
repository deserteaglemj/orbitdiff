import { UNKNOWN } from "@/components/ui/format";

/**
 * Formatting for the settings and admin screens: stored sizes, times with their
 * timezone, and where a usage stands against its quota. Pure functions with no
 * I/O, so the server render and the browser print the same text.
 */
const STEP = 1024;
const UNITS = ["KB", "MB", "GB"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const wholeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimalFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * A stored size in words: "512 bytes", "1.5 KB", "20 MB". One KB is 1,024
 * bytes, the same step the Terms use for the storage quota. A size that is
 * missing or not a usable number is "Unknown", never zero.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < STEP) {
    const whole = Math.round(bytes);
    return `${wholeFormat.format(whole)} ${whole === 1 ? "byte" : "bytes"}`;
  }
  let value = bytes / STEP;
  let unit = 0;
  // Compare the rounded value, so 1,048,575 bytes reads "1 MB" and not "1,024 KB".
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= STEP) {
    value /= STEP;
    unit += 1;
  }
  return `${oneDecimalFormat.format(value)} ${UNITS[unit]}`;
}

function zonedParts(date: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
}

/**
 * "30 Sep 2026, 14:05 (Europe/Berlin)": the date, the 24 hour time, and the
 * timezone they are in. A timezone the runtime does not know falls back to UTC
 * and the text says UTC, so the time shown is never read in the wrong zone.
 */
export function formatDateTime(value: string | null | undefined, timeZone = "UTC"): string {
  if (!value) return UNKNOWN;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN;
  let zone = timeZone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = zonedParts(date, zone);
  } catch {
    zone = "UTC";
    parts = zonedParts(date, zone);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const two = (number: number) => String(number).padStart(2, "0");
  // Some runtimes print midnight as hour 24 even with the h23 cycle.
  const hour = part("hour") % 24;
  return `${part("day")} ${MONTHS[part("month") - 1]} ${part("year")}, ${two(hour)}:${two(part("minute"))} (${zone})`;
}

export type QuotaLevel = "ok" | "near" | "reached" | "unknown";

export interface QuotaState {
  level: QuotaLevel;
  /** The level in words. A badge shows this text, so the state never depends on colour. */
  label: string;
  /** Badge tone. A reached limit is a paused state, not a failure, so it is never "danger". */
  tone: "ok" | "info" | "warning" | "neutral";
  used: number | null;
  limit: number | null;
  /** What is left before the limit, or null when the usage is unknown. */
  remaining: number | null;
}

/** From this share of a limit on, the usage is shown as near the limit. */
const NEAR_SHARE = 0.8;

function usable(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Where a usage stands against its quota. Reached at the limit and above it; a
 * limit of zero or less is reached as well, so the screen never offers what the
 * server would refuse. A usage that is not a usable number is unknown, which is
 * never shown as within the limit.
 */
export function quotaState(used: number, limit: number): QuotaState {
  if (!usable(used) || used < 0 || !usable(limit)) {
    return { level: "unknown", label: UNKNOWN, tone: "neutral", used: null, limit: null, remaining: null };
  }
  if (limit <= 0 || used >= limit) {
    return { level: "reached", label: "Limit reached", tone: "warning", used, limit, remaining: 0 };
  }
  const remaining = limit - used;
  if (used >= limit * NEAR_SHARE) {
    return { level: "near", label: "Near the limit", tone: "info", used, limit, remaining };
  }
  return { level: "ok", label: "Within the limit", tone: "ok", used, limit, remaining };
}
