import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getDb, type Executor } from "@/server/db/client";
import { consentRecord } from "@/server/db/schema";

import type { ConsentStateDto } from "./contracts";

/**
 * Consent state, read from the append-only `consent_record` log.
 *
 * The rule, in one place: for each kind the LATEST row decides. Product use
 * needs terms and privacy both granted at the version in `CONSENT_VERSIONS`.
 * Every other state fails closed: no row, a withdrawn row, an empty version,
 * an unknown version, an older version. Marketing consent is a separate,
 * optional choice and never counts towards product consent.
 *
 * This module imports nothing from the auth layer, so the guards can use it.
 */
export type ConsentKind = "terms" | "privacy" | "marketing";
export type ConsentSource = "signup" | "onboarding" | "settings";

const KINDS: readonly ConsentKind[] = ["terms", "privacy", "marketing"];

/** The kinds a user must have granted, at the current version, to use the product. */
export const REQUIRED_CONSENT: readonly ("terms" | "privacy")[] = ["terms", "privacy"];

/** The latest row of each kind for one user. A kind with no row is null. */
export async function getConsentState(userId: string, executor: Executor = getDb()): Promise<ConsentStateDto> {
  const rows = await executor
    .select({
      kind: consentRecord.kind,
      version: consentRecord.version,
      granted: consentRecord.granted,
      recordedAt: consentRecord.recordedAt,
    })
    .from(consentRecord)
    .where(eq(consentRecord.userId, userId))
    .orderBy(desc(consentRecord.recordedAt), desc(consentRecord.id));
  const state: ConsentStateDto = { terms: null, privacy: null, marketing: null };
  for (const kind of KINDS) {
    const latest = rows.find((row) => row.kind === kind);
    if (latest) {
      state[kind] = {
        granted: latest.granted === true,
        version: latest.version,
        recordedAt: latest.recordedAt.toISOString(),
      };
    }
  }
  return state;
}

/** Kinds of required consent that are not granted at the current version. Empty means product use is allowed. */
export function missingConsent(state: ConsentStateDto): Array<"terms" | "privacy"> {
  return REQUIRED_CONSENT.filter((kind) => {
    const latest = state[kind];
    return !(latest !== null && latest.granted === true && latest.version === CONSENT_VERSIONS[kind]);
  });
}

/** True only when terms and privacy are both granted at the current versions. */
export function consentSatisfied(state: ConsentStateDto): boolean {
  return missingConsent(state).length === 0;
}

export async function hasCurrentConsent(userId: string, executor: Executor = getDb()): Promise<boolean> {
  return consentSatisfied(await getConsentState(userId, executor));
}

/**
 * Append one row to the log of one user, at the version the caller names. The
 * version is never filled in here: a row says which text a person answered, so
 * whoever writes it has to know that. Rows are never updated or deleted. The
 * recorded time is never earlier than the latest row of that kind, so "the
 * latest row decides" has one answer.
 *
 * Like every function that writes tenant rows, it takes the user id first and
 * the executor last. Pass the caller's transaction as the executor when the
 * row has to commit together with something else.
 */
export async function appendConsent(
  userId: string,
  kind: ConsentKind,
  version: string,
  granted: boolean,
  source: ConsentSource,
  now: Date,
  executor: Executor = getDb(),
): Promise<void> {
  const [latest] = await executor
    .select({ recordedAt: consentRecord.recordedAt })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, kind)))
    .orderBy(desc(consentRecord.recordedAt))
    .limit(1);
  const recordedAt =
    latest && latest.recordedAt.getTime() >= now.getTime() ? new Date(latest.recordedAt.getTime() + 1) : now;
  await executor
    .insert(consentRecord)
    .values({ userId, kind, version, granted, source, recordedAt });
}
