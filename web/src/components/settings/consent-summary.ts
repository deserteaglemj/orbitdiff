import type { ConsentStateDto } from "@/server/services/contracts";

import { formatDateTime } from "./format";

/**
 * What the settings screen says about the consent log, and what the product
 * news toggle sends. Pure functions with no I/O.
 *
 * Every reading here is strict: a record counts as granted only when `granted`
 * is the boolean true, and a version counts as current only when it equals the
 * current version in full. The server decides with the same rules; this only
 * words what the log holds.
 */
type ConsentEntry = ConsentStateDto["terms"] | undefined;

export type DocumentKind = "terms" | "privacy";

const DOCUMENT_NAME: Record<DocumentKind, string> = { terms: "Terms", privacy: "Privacy notice" };

export interface DocumentConsentSummary {
  status: "current" | "outdated" | "withdrawn" | "missing";
  /** The status in one or two words, for a badge. */
  badge: string;
  tone: "ok" | "warning";
  text: string;
}

/** The recorded acceptance of the Terms or the Privacy notice, in words. Read only: nothing here changes it. */
export function documentConsentSummary(
  kind: DocumentKind,
  entry: ConsentEntry,
  currentVersion: string,
  timeZone = "UTC",
): DocumentConsentSummary {
  const name = DOCUMENT_NAME[kind];
  if (!entry) {
    return {
      status: "missing",
      badge: "Not recorded",
      tone: "warning",
      text: `No acceptance of the ${name} is recorded for this account.`,
    };
  }
  const when = formatDateTime(entry.recordedAt, timeZone);
  if (entry.granted !== true) {
    return {
      status: "withdrawn",
      badge: "Withdrawn",
      tone: "warning",
      text: `Your acceptance of the ${name} was withdrawn on ${when}. The record names version ${entry.version}.`,
    };
  }
  if (typeof entry.version !== "string" || entry.version.length === 0) {
    return {
      status: "outdated",
      badge: "Outdated",
      tone: "warning",
      text: `An acceptance of the ${name} was recorded on ${when} without a version. The current version is ${currentVersion}.`,
    };
  }
  const accepted = `You accepted version ${entry.version} of the ${name} on ${when}.`;
  if (entry.version !== currentVersion) {
    return {
      status: "outdated",
      badge: "Outdated",
      tone: "warning",
      text: `${accepted} The current version is ${currentVersion}.`,
    };
  }
  return { status: "current", badge: "Accepted", tone: "ok", text: `${accepted} It is the current version.` };
}

export interface MarketingSummary {
  /** True only when the newest record is granted as the boolean true. */
  granted: boolean;
  badge: string;
  tone: "ok" | "neutral";
  text: string;
}

/** The recorded product news choice, in words. No record means off. */
export function marketingSummary(entry: ConsentEntry, timeZone = "UTC"): MarketingSummary {
  const granted = entry?.granted === true;
  const state = granted ? "Product news is on." : "Product news is off.";
  const recorded = entry
    ? `Recorded on ${formatDateTime(entry.recordedAt, timeZone)}, at version ${entry.version}.`
    : "No choice has been recorded.";
  return { granted, badge: granted ? "On" : "Off", tone: granted ? "ok" : "neutral", text: `${state} ${recorded}` };
}

/**
 * What to show when the product news choice is refused. The route refuses a
 * grant whose version is not the current one, and the form only ever names the
 * version it was rendered with, so that refusal means the consent text changed
 * while the page was open. It is said in those words. Every other refusal is
 * shown with the route's own message.
 */
export function describeMarketingRefusal(failure: { code: string; fields: readonly string[]; message: string }): string {
  if (failure.code === "invalid_input" && failure.fields.includes("version")) {
    return "The product news consent changed while this page was open. Reload this page, read it again, and choose again.";
  }
  return failure.message;
}

export type MarketingRequest =
  | { ok: true; body: { granted: true; version: string } | { granted: false } }
  | { ok: false; error: string };

/** The longest version the consent route accepts. */
const VERSION_MAX = 64;

/**
 * The body for POST /api/me/consent, or the reason nothing is sent.
 *
 * - The choice must be a boolean. Anything else ("true", "on", 1, a missing
 *   value) is never coerced: nothing is sent.
 * - A grant names the version of the product news consent the page showed
 *   (`shownVersion`), never a value looked up at the moment of sending. Without
 *   a usable version no grant is sent.
 * - A withdrawal is `{ granted: false }` and needs no version, so turning
 *   product news off always works.
 *
 * The body holds nothing about the Terms or the Privacy notice: product news is
 * a separate choice and changing it never touches them.
 */
export function buildMarketingRequest(choice: unknown, shownVersion: unknown): MarketingRequest {
  if (choice === false) return { ok: true, body: { granted: false } };
  if (choice !== true) return { ok: false, error: "Choose whether product news is on or off, then save." };
  if (typeof shownVersion !== "string" || shownVersion.trim().length === 0 || shownVersion.length > VERSION_MAX) {
    return {
      ok: false,
      error: "This page does not hold the version of the product news consent it showed. Reload the page and try again.",
    };
  }
  return { ok: true, body: { granted: true, version: shownVersion } };
}
