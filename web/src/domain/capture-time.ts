import { DomainError } from "./errors";
import { exceedsCodePoints } from "./text";

/**
 * Capture time: an explicit declaration by the owner, never a file date, a row
 * timestamp, or the import time.
 *
 * `personal._capture` parses with `datetime.fromisoformat`, whose grammar is
 * wide and changes between CPython versions. The hosted port accepts a fixed,
 * documented subset and agrees with Python on every string in that subset:
 *
 *   date       YYYY-MM-DD or YYYYMMDD (year 0001 to 9999)
 *   separator  "T" or one space
 *   time       HH:MM, HH:MM:SS, HH:MM:SS.f, HHMM, HHMMSS, HHMMSS.f
 *              (one or more fraction digits; digits past microseconds are dropped)
 *   offset     "Z", +HH:MM, -HH:MM, +HHMM, -HHMM (hours 00 to 23, minutes 00 to 59)
 *
 * Python also accepts week dates, an hour without minutes, any separator
 * character, a comma before the fraction, an empty fraction, offsets with
 * seconds or without minutes, and offset minutes above 59. Those are rejected
 * here. tests/parity/golden.json lists them under `capture.python_only`.
 */
export const CAPTURE_TIME_MAX_LENGTH = 40;
export const CAPTURE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const SHAPE_MESSAGE = "The capture time must be an ISO timestamp with a timezone.";
const VALUE_MESSAGE = "The capture time must be a valid, non-future timestamp with a timezone.";

const FORM =
  /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2}))[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?|(\d{2})(?:(\d{2})(?:\.(\d+))?)?)(Z|[+-]\d{2}:?\d{2})$/;

const DAY_SECONDS = 86_400;

/** Days since 1970-01-01 in the proleptic Gregorian calendar. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

const MIN_SECONDS = daysFromCivil(1, 1, 1) * DAY_SECONDS;
const MAX_SECONDS = daysFromCivil(9999, 12, 31) * DAY_SECONDS + DAY_SECONDS - 1;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatSeconds(seconds: number): string {
  const days = Math.floor(seconds / DAY_SECONDS);
  const rest = seconds - days * DAY_SECONDS;
  const [year, month, day] = civilFromDays(days);
  const hour = Math.floor(rest / 3600);
  const minute = Math.floor((rest % 3600) / 60);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(rest % 60, 2)}+00:00`;
}

interface Instant {
  /** Whole seconds since the Unix epoch, UTC. */
  seconds: number;
  /** Microseconds within that second. */
  micro: number;
}

function readInstant(text: string): Instant | null {
  const match = FORM.exec(text);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2] ?? match[4]);
  const day = Number(match[3] ?? match[5]);
  const hour = Number(match[6]);
  const minute = Number(match[7] ?? match[10]);
  const second = Number(match[8] ?? match[11] ?? 0);
  const fraction = match[9] ?? match[12] ?? "";
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  let offset = 0;
  const zone = match[13];
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(-2));
    if (offsetHour > 23 || offsetMinute > 59) {
      return null;
    }
    offset = (zone[0] === "-" ? -1 : 1) * (offsetHour * 3600 + offsetMinute * 60);
  }
  const seconds = daysFromCivil(year, month, day) * DAY_SECONDS + hour * 3600 + minute * 60 + second - offset;
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    return null;
  }
  return { seconds, micro: Number(`${fraction}000000`.slice(0, 6)) };
}

/**
 * `null` stays `null`. A string in the accepted form is returned in the
 * canonical form `YYYY-MM-DDTHH:MM:SS+00:00`. Anything else, and any time more
 * than five minutes after `now`, raises `invalid_capture_time`.
 */
export function parseCaptureTime(value: unknown, now: Date): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || exceedsCodePoints(value, CAPTURE_TIME_MAX_LENGTH)) {
    throw new DomainError("invalid_capture_time", SHAPE_MESSAGE);
  }
  const clock = now.getTime();
  if (Number.isNaN(clock)) {
    throw new TypeError("parseCaptureTime needs a valid clock");
  }
  const instant = readInstant(value);
  if (instant === null) {
    throw new DomainError("invalid_capture_time", VALUE_MESSAGE);
  }
  const limit = clock + CAPTURE_FUTURE_TOLERANCE_MS;
  const limitSeconds = Math.floor(limit / 1000);
  const limitMicro = (limit - limitSeconds * 1000) * 1000;
  if (
    instant.seconds > limitSeconds ||
    (instant.seconds === limitSeconds && instant.micro > limitMicro)
  ) {
    throw new DomainError("invalid_capture_time", VALUE_MESSAGE);
  }
  return formatSeconds(instant.seconds);
}

/** The canonical form of an instant, for values read back from storage. */
export function formatCaptureTime(instant: Date): string {
  const time = instant.getTime();
  if (Number.isNaN(time)) {
    throw new TypeError("formatCaptureTime needs a valid date");
  }
  return formatSeconds(Math.floor(time / 1000));
}

/** Milliseconds since the epoch for a canonical capture time string. */
export function captureTimeMillis(canonicalTime: string): number {
  const instant = readInstant(canonicalTime);
  if (instant === null) {
    throw new DomainError("invalid_capture_time", VALUE_MESSAGE);
  }
  return instant.seconds * 1000 + Math.floor(instant.micro / 1000);
}
