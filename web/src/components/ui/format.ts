/** The word shown for a value the evidence cannot support. Never render zero or a dash instead. */
export const UNKNOWN = "Unknown";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A count with thousands separators, or "Unknown" when there is no supported value. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return UNKNOWN;
  }
  return countFormat.format(value);
}

function dateParts(date: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).formatToParts(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).formatToParts(date);
  }
}

/**
 * "1 Sep 2026" for an ISO timestamp, in the given IANA timezone (UTC by default).
 * The output is the same on the server and in the browser because nothing depends on the runtime locale.
 */
export function formatDate(value: string | null | undefined, timeZone = "UTC"): string {
  if (!value) {
    return UNKNOWN;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return UNKNOWN;
  }
  const parts = dateParts(date, timeZone);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return `${part("day")} ${MONTHS[part("month") - 1]} ${part("year")}`;
}

/** The required wording for a difference between two owner exports. */
export function observedBetween(start: string, end: string, timeZone = "UTC"): string {
  return `observed in your export between ${formatDate(start, timeZone)} and ${formatDate(end, timeZone)}`;
}
