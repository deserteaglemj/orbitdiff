import { DomainError } from "./errors";

/**
 * The daily review time of a user: an IANA timezone and a local hour.
 * Only `Intl` is used, so the same code runs on the server and in a browser.
 *
 * Each local date resolves to exactly one instant:
 *  - a local time that does not exist (clocks moved forward) resolves to the
 *    first valid instant after the gap;
 *  - a local time that occurs twice (clocks moved back) resolves to its first
 *    occurrence.
 * `nextReviewAt` returns the first such instant strictly after `now`. Paired
 * with the job key `daily:<profileId>:<localDateKey>`, a profile gets at most
 * one scheduled review per local date on 23, 24, and 25 hour days.
 */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
const HOUR_MS = 3_600_000;
/** Wider than any offset (-12:00 to +14:00) plus any clock shift. */
const WINDOW_MS = 26 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached !== undefined) {
    return cached;
  }
  if (typeof timezone !== "string" || !ZONE_NAME.test(timezone)) {
    throw new DomainError("invalid_timezone", "A valid IANA timezone is required.");
  }
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new DomainError("invalid_timezone", "A valid IANA timezone is required.");
  }
  formatters.set(timezone, created);
  return created;
}

/** True for a timezone name `Intl` knows. UTC offsets such as "+05:00" are not names. */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  /** The local wall clock read as if it were UTC, in milliseconds. */
  asUtc: number;
}

function wallTime(instant: number, timezone: string): WallTime {
  const fields: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") {
      fields[part.type] = Number(part.value);
    }
  }
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    asUtc: Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour % 24, fields.minute, fields.second),
  };
}

/** Local wall clock minus UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timezone: string): number {
  return wallTime(instant, timezone).asUtc - Math.floor(instant / 1000) * 1000;
}

/** The one instant a local date and hour stand for. */
function resolveLocalHour(wall: number, timezone: string): number {
  const offsets = new Set([
    offsetAt(wall - WINDOW_MS, timezone),
    offsetAt(wall, timezone),
    offsetAt(wall + WINDOW_MS, timezone),
  ]);
  let first: number | null = null;
  for (const offset of offsets) {
    const instant = wall - offset;
    if (offsetAt(instant, timezone) === offset && (first === null || instant < first)) {
      first = instant;
    }
  }
  if (first !== null) {
    return first;
  }
  // The local time was skipped. Find the first instant whose wall clock has passed it.
  let low = Math.floor((wall - WINDOW_MS) / 1000);
  let high = Math.ceil((wall + WINDOW_MS) / 1000);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (wallTime(middle * 1000, timezone).asUtc >= wall) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high * 1000;
}

function requireClock(now: Date): number {
  const time = now.getTime();
  if (Number.isNaN(time)) {
    throw new TypeError("a valid clock is required");
  }
  return time;
}

/** The local calendar date of an instant, as `YYYY-MM-DD`. */
export function localDateKey(now: Date, timezone: string): string {
  const wall = wallTime(requireClock(now), timezone);
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

/** The first review instant strictly after `now` for a local hour from 0 to 23. */
export function nextReviewAt(now: Date, timezone: string, hour: number): Date {
  const clock = requireClock(now);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new DomainError("invalid_input", "The review hour must be a whole number from 0 to 23.");
  }
  const today = wallTime(clock, timezone);
  for (let ahead = 0; ahead <= 3; ahead += 1) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + ahead, hour);
    const candidate = resolveLocalHour(wall, timezone);
    if (candidate > clock) {
      return new Date(candidate);
    }
  }
  throw new Error("no review time found within three local days");
}
