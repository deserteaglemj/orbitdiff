import { isValidTimezone } from "@/domain/schedule";

/**
 * The IANA timezone names this runtime knows, with UTC first. Computed on the
 * server and handed to the form, so the list offered is the list the server
 * will accept.
 */
export function listTimezones(): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")];
}

/**
 * Options for the timezone select. The selected zone is always present: a zone
 * the browser reports but the server list lacks is added when it is a valid
 * name, so the control never shows a value it does not contain.
 */
export function timezoneOptions(zones: readonly string[], selected: string): Array<{ value: string; label: string }> {
  const all = zones.includes(selected) || !isValidTimezone(selected) ? [...zones] : [selected, ...zones];
  return all.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}
