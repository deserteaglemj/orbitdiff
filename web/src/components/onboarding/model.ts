import { validateName, validateTimezone, type DocumentVersions } from "@/components/auth/sign-up-model";
import { CONSENT_VERSIONS } from "@/domain/limits";
import type { ConsentStateDto, MeDto } from "@/server/services/contracts";

export type { DocumentVersions };
export type RequiredDocument = "terms" | "privacy";
export type OnboardingStep = "details" | "consent" | "profile" | "done";

const REQUIRED: readonly RequiredDocument[] = ["terms", "privacy"];

/**
 * The documents the user has to accept in this flow: every one whose newest
 * record is not granted (as the boolean true) at exactly the version the
 * screen shows (`shown`, the current versions unless the page says otherwise).
 * A missing record, a withdrawal, an empty, outdated, or unknown version, and
 * a missing state all count as not accepted. Marketing consent is not looked at.
 *
 * The server decides with the same rule (requireOnboardedUser). This only
 * chooses which boxes to show.
 */
export function consentToConfirm(
  consent: ConsentStateDto | null | undefined,
  shown: DocumentVersions = CONSENT_VERSIONS,
): RequiredDocument[] {
  return REQUIRED.filter((kind) => {
    const latest = consent?.[kind];
    return !(latest && latest.granted === true && latest.version === shown[kind]);
  });
}

export type OnboardingBody =
  | { ok: true; body: { termsVersion: string; privacyVersion: string } }
  | { ok: false; errors: Partial<Record<RequiredDocument, string>> };

const AGREE: Record<RequiredDocument, string> = {
  terms: "Agree to the Terms to continue.",
  privacy: "Agree to the Privacy notice to continue.",
};

/**
 * The body for POST /api/me/onboarding, or the boxes that still need a tick.
 *
 * The body names the version of each document the screen showed (`versions`),
 * and naming a version is the acceptance. It is built only when every document
 * that needs confirming has been ticked by the user, as the boolean true. The
 * versions are the ones the page was rendered with, never a value looked up at
 * the moment of sending: the route records consent at the versions named and
 * refuses any that is no longer current, so a page that was open while a
 * document changed cannot accept the new text unread.
 *
 * Nothing about marketing is sent: the route refuses it, and it is a separate
 * choice.
 */
export function buildOnboardingBody(input: {
  needed: readonly RequiredDocument[];
  ticked: Record<RequiredDocument, boolean>;
  versions: DocumentVersions;
}): OnboardingBody {
  const errors: Partial<Record<RequiredDocument, string>> = {};
  for (const kind of input.needed) {
    if (input.ticked[kind] !== true) errors[kind] = AGREE[kind];
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { termsVersion: input.versions.terms, privacyVersion: input.versions.privacy } };
}

/** The request field that names each document's version, as POST /api/me/onboarding reports it. */
const VERSION_FIELD: Record<string, RequiredDocument> = { termsVersion: "terms", privacyVersion: "privacy" };

const DOCUMENT_NAME: Record<RequiredDocument, string> = { terms: "Terms", privacy: "Privacy notice" };

/**
 * What to show when the agreement step is refused. The route refuses a version
 * that is not the current one, and this screen only ever names the versions it
 * was rendered with, so that refusal means a document changed while the page
 * was open. It is said in those words, without the field names of the request.
 * Every other refusal is shown with the route's own message.
 */
export function describeAgreementRefusal(failure: { code: string; fields: readonly string[]; message: string }): string {
  const onlyVersions = failure.fields.every((field) => Object.hasOwn(VERSION_FIELD, field));
  const changed = REQUIRED.filter((kind) =>
    failure.fields.some((field) => Object.hasOwn(VERSION_FIELD, field) && VERSION_FIELD[field] === kind),
  );
  if (failure.code !== "invalid_input" || changed.length === 0 || !onlyVersions) return failure.message;
  if (changed.length === 2) {
    return "The Terms and the Privacy notice changed while this page was open. Reload this page, read the current versions, and agree again.";
  }
  const name = DOCUMENT_NAME[changed[0] ?? "terms"];
  return `The ${name} changed while this page was open. Reload this page, read the current ${name}, and agree again.`;
}

/**
 * What the flow needs to know about where an account stands. Two facts that
 * are easy to mistake for one:
 *
 * - `onboarded`: onboarding is complete AND the recorded consent is current.
 *   This is what the guards require (requireOnboardedUser).
 * - `completedBefore`: onboarding was completed at some point (`onboarded_at`
 *   is set), whatever the consent log says now.
 *
 * An account with `completedBefore` true and `onboarded` false is a returning
 * user whose agreement is no longer current, typically because a document
 * changed. It is not a new account.
 */
export interface OnboardingStanding {
  onboarded: boolean;
  completedBefore: boolean;
  /** How many profiles the account already has. */
  profiles: number;
}

/** What the onboarding page hands to the flow: the standing of the account and the values the steps show. */
export interface OnboardingAccount extends OnboardingStanding {
  name: string;
  timezone: string;
  reviewHour: number;
  consent: ConsentStateDto;
}

/**
 * The account as the flow needs it, from the signed-in user's own record
 * (`getMe`) and the `onboarded_at` of the session user. The two facts stay
 * apart: `me.onboarded` also requires current consent, while `completedBefore`
 * only says that onboarding was finished at some point.
 */
export function onboardingAccount(me: MeDto, onboardedAt: Date | null | undefined): OnboardingAccount {
  return {
    name: me.name,
    timezone: me.timezone,
    reviewHour: me.reviewHour,
    onboarded: me.onboarded,
    completedBefore: onboardedAt instanceof Date && !Number.isNaN(onboardedAt.getTime()),
    profiles: me.usage.profiles,
    consent: me.consent,
  };
}

function hasProfiles(account: { profiles: number }): boolean {
  return typeof account.profiles === "number" && Number.isInteger(account.profiles) && account.profiles > 0;
}

/**
 * True for a returning user: onboarding was completed before, as the boolean
 * true, and the account is not onboarded now. Such a user is only asked to
 * agree to the current documents.
 */
export function isReturning(account: Pick<OnboardingStanding, "onboarded" | "completedBefore">): boolean {
  return account.completedBefore === true && account.onboarded !== true;
}

/**
 * Which heading the page carries on a step. A returning user sees the request
 * to agree to the current documents, without the list of setup steps, while at
 * the agreement and after it. Everyone else, and a returning user who has no
 * profile yet and reaches the first profile step, sees the setup heading with
 * its steps.
 */
export function flowHeader(
  account: Pick<OnboardingStanding, "onboarded" | "completedBefore">,
  step: OnboardingStep,
): "agreement" | "setup" {
  return isReturning(account) && step !== "profile" ? "agreement" : "setup";
}

/**
 * Where the flow starts for this account.
 *
 * - first run: the details;
 * - returning with an agreement that is no longer current: the agreement step,
 *   never the details again;
 * - onboarded without a profile: the first profile;
 * - onboarded with a profile: nothing is left to do.
 */
export function initialStep(account: OnboardingStanding): OnboardingStep {
  if (account.onboarded === true) return hasProfiles(account) ? "done" : "profile";
  return isReturning(account) ? "consent" : "details";
}

/**
 * Where the flow goes once the agreement is recorded. An account that already
 * has a profile is done: it is not asked to "add your first profile", and one
 * that holds the maximum is not led into a step that could only be refused.
 */
export function stepAfterAgreement(account: Pick<OnboardingStanding, "profiles">): OnboardingStep {
  return hasProfiles(account) ? "done" : "profile";
}

/** The 24 hours of the day on a 24 hour clock. */
export const REVIEW_HOUR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Array.from(
  { length: 24 },
  (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }),
);

export type DetailsResult =
  | { ok: true; body: { name: string; timezone: string; reviewHour: number } }
  | { ok: false; errors: Partial<Record<"name" | "timezone" | "reviewHour", string>> };

/** The body for PATCH /api/me, or the fields that are not valid. */
export function validateDetails(values: { name: string; timezone: string; reviewHour: string }): DetailsResult {
  const errors: Partial<Record<"name" | "timezone" | "reviewHour", string>> = {};
  const name = validateName(values.name);
  if (name) errors.name = name;
  const timezone = validateTimezone(values.timezone);
  if (timezone) errors.timezone = timezone;
  const hour = /^(?:[0-9]|1[0-9]|2[0-3])$/.test(values.reviewHour) ? Number(values.reviewHour) : null;
  if (hour === null) errors.reviewHour = "Choose an hour from the list.";
  if (hour === null || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { name: values.name.trim(), timezone: values.timezone, reviewHour: hour } };
}
