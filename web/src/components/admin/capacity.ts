import { formatBytes, formatDateTime, quotaState } from "@/components/settings/format";
import { formatCount, UNKNOWN } from "@/components/ui/format";
import type { CapacityDto, TickSummaryDto } from "@/server/services/contracts";

/**
 * The capacity report, item by item, as the admin screen shows it. Every item
 * carries its state in words, and `paused` is true whenever that item pauses
 * something, so a paused state is never shown only by colour. Pure: the clock
 * is passed in.
 */
export interface CapacityItem {
  key: "users" | "jobsToday" | "database" | "mail" | "registration" | "lastTick";
  title: string;
  /** The reading itself, for example "12 of 250 verified accounts". */
  value: string;
  /** The state in one or two words. */
  badge: string;
  tone: "ok" | "info" | "warning" | "neutral";
  /** True when this item pauses registration, scheduled reviews, imports, or mail. */
  paused: boolean;
  /** What the state means for the service. */
  detail: string;
  /** Further readings, such as the counts of the last batch run. */
  facts: Array<{ label: string; value: string }>;
}

type Cap = { badge: string; tone: CapacityItem["tone"]; paused: boolean };

/** The batch run is expected every hour. After this long without one it is shown as late. */
const TICK_LATE_MS = 2 * 60 * 60 * 1000;

/**
 * State of a count against its cap. Paused when the report says so, and also
 * whenever the count has reached the cap, so a reached cap is never shown as fine.
 */
function capState(used: number, limit: number, reportedPaused: unknown): Cap {
  const quota = quotaState(used, limit);
  if (reportedPaused === true || quota.level === "reached") return { badge: "Paused", tone: "warning", paused: true };
  if (quota.level === "near") return { badge: "Near the cap", tone: "info", paused: false };
  if (quota.level === "unknown") return { badge: UNKNOWN, tone: "neutral", paused: false };
  return { badge: "Within the cap", tone: "ok", paused: false };
}

function users(capacity: CapacityDto): CapacityItem {
  const { used, limit, paused } = capacity.users;
  const state = capState(used, limit, paused);
  return {
    key: "users",
    // Only verified accounts take a place under the cap (see countUsers).
    title: "Verified accounts",
    value: `${formatCount(used)} of ${formatCount(limit)} verified accounts`,
    ...state,
    detail: state.paused
      ? "Registration is paused: the cap on verified accounts is reached. Existing accounts are not affected."
      : "The cap is not reached, so it does not pause registration. Accounts that wait for verification do not count.",
    facts: [],
  };
}

function jobsToday(capacity: CapacityDto): CapacityItem {
  const { used, limit, paused } = capacity.jobsToday;
  const state = capState(used, limit, paused);
  return {
    key: "jobsToday",
    title: "Jobs today",
    value: `${formatCount(used)} of ${formatCount(limit)} jobs`,
    ...state,
    detail: state.paused
      ? "Scheduled reviews are paused: the daily job cap is reached. They resume on the next UTC day."
      : "The cap is not reached, so it does not pause scheduled reviews.",
    facts: [],
  };
}

function database(capacity: CapacityDto): CapacityItem {
  const { bytes, limit, paused, measuredAt } = capacity.database;
  const base = {
    key: "database" as const,
    title: "Database size",
    value: `${formatBytes(bytes)} of ${formatBytes(limit)}`,
    facts: [{ label: "Measured", value: measuredAt ? formatDateTime(measuredAt, "UTC") : "Never" }],
  };
  if (bytes === null || bytes === undefined) {
    return {
      ...base,
      badge: "Not measured",
      tone: "neutral",
      paused: false,
      detail: "The database size has not been measured yet. The batch run measures it. An unknown size pauses nothing.",
    };
  }
  const state = capState(bytes, limit, paused);
  return {
    ...base,
    ...state,
    detail: state.paused
      ? "Imports are paused: the measured database size has reached the cap. Stored data is unchanged."
      : "The cap is not reached, so it does not pause imports.",
  };
}

function mail(capacity: CapacityDto): CapacityItem {
  const captured = capacity.mail.available === true && capacity.mail.mode === "captured";
  if (captured) {
    return {
      key: "mail",
      title: "Account mail",
      value: "Captured",
      badge: "Stored, not sent",
      tone: "info",
      paused: false,
      detail: "Account messages are stored instead of sent. The operator can read them, including their links.",
      facts: [],
    };
  }
  return {
    key: "mail",
    title: "Account mail",
    value: "None",
    badge: "Paused",
    tone: "warning",
    paused: true,
    detail:
      "No account message can be stored or sent, so registration is closed and no confirmation or reset message can be requested.",
    facts: [],
  };
}

function registration(capacity: CapacityDto): CapacityItem {
  if (capacity.registration.open === true) {
    return {
      key: "registration",
      title: "Registration",
      value: "Open",
      badge: "Open",
      tone: "ok",
      paused: false,
      detail: "New accounts can be created.",
      facts: [],
    };
  }
  const reason = typeof capacity.registration.reason === "string" ? capacity.registration.reason.trim() : "";
  return {
    key: "registration",
    title: "Registration",
    value: "Not open",
    badge: reason.startsWith("Registration is paused") ? "Paused" : "Closed",
    tone: "warning",
    paused: true,
    detail: reason.length > 0 ? reason : "Registration is not open. No reason was recorded.",
    facts: [],
  };
}

function tickFacts(tick: TickSummaryDto): CapacityItem["facts"] {
  return [
    { label: "Expired leases recovered", value: formatCount(tick.recovered) },
    { label: "Daily reviews queued", value: formatCount(tick.enqueued) },
    { label: "Jobs claimed", value: formatCount(tick.claimed) },
    { label: "Succeeded", value: formatCount(tick.succeeded) },
    { label: "Failed", value: formatCount(tick.failed) },
    { label: "Retried", value: formatCount(tick.retried) },
    { label: "Cancelled", value: formatCount(tick.cancelled) },
    { label: "Still waiting", value: formatCount(tick.remaining) },
    { label: "Old rows removed", value: formatCount(tick.cleaned) },
    { label: "Duration", value: `${formatCount(tick.durationMs)} ms` },
  ];
}

function lastTick(capacity: CapacityDto, now: Date): CapacityItem {
  const base = { key: "lastTick" as const, title: "Last batch run" };
  const tick = capacity.lastTick;
  if (!tick) {
    return {
      ...base,
      value: "None recorded",
      badge: "Not run yet",
      tone: "warning",
      paused: false,
      detail: "No batch run has been recorded. The hourly workflow starts it.",
      facts: [],
    };
  }
  const at = new Date(tick.at).getTime();
  const facts = tickFacts(tick);
  if (Number.isNaN(at)) {
    return {
      ...base,
      value: UNKNOWN,
      badge: UNKNOWN,
      tone: "neutral",
      paused: false,
      detail: "The time of the last batch run could not be read.",
      facts,
    };
  }
  const value = formatDateTime(tick.at, "UTC");
  if (tick.pausedForCapacity === true) {
    return {
      ...base,
      value,
      badge: "Paused for capacity",
      tone: "warning",
      paused: true,
      detail: "That run found the daily job cap reached, so scheduled reviews were paused.",
      facts,
    };
  }
  if (now.getTime() - at > TICK_LATE_MS) {
    return {
      ...base,
      value,
      badge: "Late",
      tone: "warning",
      paused: false,
      detail: "The last batch run was more than two hours ago. It is expected every hour.",
      facts,
    };
  }
  return {
    ...base,
    value,
    badge: "On schedule",
    tone: "ok",
    paused: false,
    detail: "The batch run is expected every hour.",
    facts,
  };
}

/** The six readings of the capacity report, in the order the screen shows them. */
export function capacityItems(capacity: CapacityDto, now: Date): CapacityItem[] {
  return [
    users(capacity),
    jobsToday(capacity),
    database(capacity),
    mail(capacity),
    registration(capacity),
    lastTick(capacity, now),
  ];
}
