import { UNKNOWN } from "@/components/ui/format";

/**
 * Times as the signed-in pages show them: in one named timezone, on a 24 hour
 * clock, and always with the name of that timezone next to the value. Nothing
 * here reads the locale or the timezone of the machine, so the server and the
 * browser produce the same text.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FALLBACK_ZONE = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  let created: Intl.DateTimeFormat | null;
  try {
    created = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    created = null;
  }
  formatters.set(timeZone, created);
  return created;
}

/** The timezone that is really used: the given one when the runtime knows it, otherwise UTC. */
export function zoneLabel(timeZone: string): string {
  return typeof timeZone === "string" && formatterFor(timeZone) !== null ? timeZone : FALLBACK_ZONE;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: number, timeZone: string): Wall {
  const formatter = formatterFor(zoneLabel(timeZone)) as Intl.DateTimeFormat;
  const fields: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour % 24,
    minute: fields.minute,
    second: fields.second,
  };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** "20 Sep 2026, 12:00" in the given timezone, or "Unknown" when there is no readable time. */
export function formatLocalDateTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return UNKNOWN;
  const instant = new Date(value).getTime();
  if (Number.isNaN(instant)) return UNKNOWN;
  const wall = wallClock(instant, timeZone);
  return `${wall.day} ${MONTHS[wall.month - 1]} ${wall.year}, ${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** "20 Sep 2026, 12:00 (America/Chicago)": the local time with its timezone made explicit. */
export function formatLocalTime(value: string | null | undefined, timeZone: string): string {
  const text = formatLocalDateTime(value, timeZone);
  return text === UNKNOWN ? UNKNOWN : `${text} (${zoneLabel(timeZone)})`;
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
/** Wider than any offset (-12:00 to +14:00) plus any clock shift. */
const WINDOW_MS = 26 * 3_600_000;

/** Local wall clock minus UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function offsetText(offset: number): string {
  const minutes = Math.round(Math.abs(offset) / 60_000);
  return `${offset < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export type LocalInputResult = { ok: true; iso: string } | { ok: false; message: string };

/**
 * The value of a date and time control ("2026-09-20T12:00"), read as a wall
 * clock in the given timezone, as an ISO string with that timezone's offset at
 * that moment ("2026-09-20T12:00:00-05:00"). A local time that happens twice
 * (clocks moved back) is its first occurrence. A local time that the clocks
 * skipped is refused, because no instant has that reading.
 */
export function localInputToIso(value: string, timeZone: string): LocalInputResult {
  const zone = zoneLabel(timeZone);
  const match = typeof value === "string" ? INPUT.exec(value) : null;
  if (match === null) {
    return { ok: false, message: "Enter the date and the time, for example 20 Sep 2026 at 12:00." };
  }
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    year < 1 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false, message: "That date or time does not exist. Check the day and the time." };
  }
  const offsets = new Set([offsetAt(wall - WINDOW_MS, zone), offsetAt(wall, zone), offsetAt(wall + WINDOW_MS, zone)]);
  let chosen: { instant: number; offset: number } | null = null;
  for (const offset of offsets) {
    const instant = wall - offset;
    if (offsetAt(instant, zone) === offset && (chosen === null || instant < chosen.instant)) {
      chosen = { instant, offset };
    }
  }
  if (chosen === null) {
    return {
      ok: false,
      message: `That local time does not exist in ${zone}: the clocks moved forward past it. Choose another time.`,
    };
  }
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return { ok: true, iso: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}${offsetText(chosen.offset)}` };
}
