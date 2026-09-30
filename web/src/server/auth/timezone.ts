const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * True for an IANA timezone name such as "UTC" or "Europe/Berlin". The shape
 * check rejects UTC offsets like "+05:00", which the runtime would otherwise accept.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
