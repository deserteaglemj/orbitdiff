import { isValidTimezone } from "@/domain/schedule";

/**
 * The timezone choice of the settings screen: the list that is offered and the
 * search over it. Pure functions with no I/O. The page builds the list on the
 * server, so the zones offered are the zones the server accepts.
 */

/**
 * Common zones across every offset, offered when the runtime cannot list its
 * own (an older engine without Intl.supportedValuesOf). Each name is checked
 * against the runtime before it is offered.
 */
export const FALLBACK_TIMEZONES: readonly string[] = [
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

export interface TimezoneList {
  /** UTC first, then every other zone once, in name order. */
  zones: string[];
  /** Where the list came from. "fallback" means the runtime could not list its zones. */
  source: "runtime" | "fallback";
}

/** The part of `Intl` this module uses. Passed in so the missing case can be tested. */
export interface TimezoneRuntime {
  supportedValuesOf?: unknown;
}

/** The zones the runtime reports, or null when it cannot report any. */
function runtimeZones(intl: TimezoneRuntime): string[] | null {
  if (typeof intl.supportedValuesOf !== "function") return null;
  let reported: unknown;
  try {
    reported = (intl.supportedValuesOf as (key: string) => unknown)("timeZone");
  } catch {
    return null;
  }
  if (!Array.isArray(reported)) return null;
  const zones = reported.filter((zone): zone is string => typeof zone === "string" && zone.length > 0);
  return zones.length > 0 ? zones : null;
}

/**
 * The timezones to offer: the ones the runtime reports through
 * Intl.supportedValuesOf, or the fixed list above when it reports none. UTC is
 * always first, and the current value is always in the list when it is a
 * timezone name, so the control never shows a value it does not contain.
 */
export function buildTimezoneList(current: string, intl: TimezoneRuntime = Intl): TimezoneList {
  const reported = runtimeZones(intl);
  const base = reported ?? FALLBACK_TIMEZONES.filter((zone) => isValidTimezone(zone));
  const rest = new Set(base);
  if (isValidTimezone(current)) rest.add(current);
  rest.delete("UTC");
  return { zones: ["UTC", ...[...rest].sort()], source: reported === null ? "fallback" : "runtime" };
}

/** Lowercase, with the underscores and slashes of a zone name read as spaces. */
function searchable(text: string): string {
  return text.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The zones that match a search: every word of the search must appear in the
 * name, in any letter case, and a space stands for the underscore or the slash
 * of a name ("new york" finds America/New_York). The selected zone stays in
 * the result, first, when the search does not match it, so the select always
 * holds its own value. The search is plain text, never a pattern.
 */
export function filterTimezones(zones: readonly string[], query: string, selected: string): string[] {
  const words = searchable(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...zones];
  const matches = zones.filter((zone) => {
    const name = searchable(zone);
    return words.every((word) => name.includes(word));
  });
  if (zones.includes(selected) && !matches.includes(selected)) return [selected, ...matches];
  return matches;
}

/** A zone name as it is shown: spaces in place of underscores. */
export function timezoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}
