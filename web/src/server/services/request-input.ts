import { z } from "zod";

import { AppError } from "@/server/http/errors";

import { ACTIVITY_KINDS, ACTIVITY_STATUSES } from "./activity";
import { EXPORT_EVENT_TYPES } from "./events";
import { RELATIONSHIPS } from "./relationships";

/**
 * What the JSON API accepts from a request: strict body schemas and the
 * allowed values of query filters. Every body schema is a strict object, so a
 * key that is not listed is refused, never dropped: there is no field through
 * which a request could set an owner, a role, a status, or a verification flag.
 */

/** Byte cap for every JSON body except an import, which has its own larger cap. */
export const SMALL_BODY_BYTES = 16 * 1024;

export const updateMeBody = z.strictObject({
  name: z.string().max(200).optional(),
  timezone: z.string().max(64).optional(),
  reviewHour: z.number().optional(),
});

/**
 * The product news choice. `version` is only the shape here: the service
 * requires a grant to name the current version and never reads the version of a
 * withdrawal, so a withdrawal cannot be refused for what it carries there.
 */
export const marketingConsentBody = z.strictObject({ granted: z.boolean(), version: z.unknown().optional() });

/**
 * The versions of the Terms and the Privacy notice that the page showed. Both
 * must be text here; the service then requires each to be the current version
 * of its document. There is no field that accepts a document without naming it.
 */
export const onboardingBody = z.strictObject({
  termsVersion: z.string().max(64),
  privacyVersion: z.string().max(64),
});

/** A handle or an Instagram profile link. The domain rule decides whether it is acceptable. */
export const createProfileBody = z.strictObject({ handle: z.string().max(600) });

export const profileStatusBody = z.strictObject({ status: z.enum(["active", "paused"]) });

/**
 * The shape of a normalized owner export. Only the shape is checked here; the
 * service re-validates every invariant (handles, order, shards, capture time,
 * size) with the domain rule and computes the digests itself.
 */
export const importBody = z.strictObject({
  account: z.string(),
  capturedAt: z.string().nullable(),
  completeFollowers: z.boolean(),
  completeFollowing: z.boolean(),
  followers: z.array(z.string()).nullable(),
  following: z.array(z.string()).nullable(),
  shards: z.strictObject({ followers: z.array(z.number()), following: z.array(z.number()) }),
});

/** A query filter limited to known values. Absent or empty is null; anything else is `invalid_input`. */
export function queryChoice<T extends string>(
  searchParams: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | null {
  const value = searchParams.get(name);
  if (value === null || value === "") return null;
  if (!allowed.includes(value as T)) {
    throw new AppError("invalid_input", `${name} is not a known value.`, { fields: [name] });
  }
  return value as T;
}

export const QUERY_CHOICES = {
  relationship: RELATIONSHIPS,
  eventType: EXPORT_EVENT_TYPES,
  activityKind: ACTIVITY_KINDS,
  activityStatus: ACTIVITY_STATUSES,
} as const;
