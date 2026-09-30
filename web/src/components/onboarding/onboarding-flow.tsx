"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { loadPage } from "@/components/auth/navigate";
import { NAME_MAX } from "@/components/auth/sign-up-model";
import { timezoneOptions } from "@/components/auth/timezones";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { IDENTITY_SOURCE } from "@/components/capability-copy";
import {
  Button,
  CheckboxField,
  cx,
  formatDate,
  FormError,
  LinkButton,
  Notice,
  PageHeader,
  SelectField,
  TextField,
} from "@/components/ui";
import { isDomainError } from "@/domain/errors";
import { parseProfileInput } from "@/domain/handles";
import type { ConsentStateDto, MeDto, ProfileDto } from "@/server/services/contracts";

import { callApi } from "./api";
import {
  buildOnboardingBody,
  consentToConfirm,
  describeAgreementRefusal,
  initialStep,
  REVIEW_HOUR_OPTIONS,
  validateDetails,
  type DocumentVersions,
  type OnboardingStep,
  type RequiredDocument,
} from "./model";

export interface OnboardingAccount {
  name: string;
  timezone: string;
  reviewHour: number;
  onboarded: boolean;
  /** How many profiles the account already has. */
  profiles: number;
  consent: ConsentStateDto;
}

const STEPS: Array<{ id: Exclude<OnboardingStep, "done">; title: string }> = [
  { id: "details", title: "Your details" },
  { id: "consent", title: "Terms and privacy" },
  { id: "profile", title: "First profile" },
];

const DOCUMENTS: Record<RequiredDocument, { name: string; href: string }> = {
  terms: { name: "Terms", href: "/legal/terms" },
  privacy: { name: "Privacy notice", href: "/legal/privacy" },
};

const DASHBOARD = "/dashboard";

/** The fields of each step in the order they appear, used to move focus to the first one with an error. */
const DETAIL_FIELDS: readonly string[] = ["name", "timezone", "reviewHour"];
const DOCUMENT_FIELDS: readonly string[] = ["terms", "privacy"];
const PROFILE_FIELDS: readonly string[] = ["profile"];

function StepList({ current }: { current: OnboardingStep }) {
  const position = STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Setup steps" className="grid gap-2 sm:grid-cols-3 sm:gap-4">
      {STEPS.map((step, index) => {
        const state = index < position || current === "done" ? "Done" : index === position ? "Now" : "Next";
        return (
          <li
            key={step.id}
            aria-current={index === position ? "step" : undefined}
            className={cx(
              "flex min-w-0 items-baseline justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
              index === position ? "border-blue/50 bg-blue-tint text-ink" : "border-line text-muted",
            )}
          >
            <span className={cx("min-w-0", index === position ? "font-semibold" : undefined)}>{step.title}</span>
            <span className="shrink-0 text-xs">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ headingRef, children }: { headingRef: React.RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  );
}

/**
 * The first-run flow: confirm the account details, accept the current Terms and
 * Privacy notice where the record is missing or outdated, then name the first
 * profile. Every step calls a route of this app and shows that route's own
 * message when it refuses.
 *
 * `versions` are the versions of the Terms and the Privacy notice the server
 * held when it rendered the page. They are what the screen prints and what the
 * agreement step names in its request, so consent is only ever recorded at a
 * version this screen showed.
 */
export function OnboardingFlow({
  account,
  timezones,
  versions,
}: {
  account: OnboardingAccount;
  timezones: string[];
  versions: DocumentVersions;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const firstRender = useRef(true);
  const [step, setStep] = useState<OnboardingStep>(() => initialStep(account));
  const [consent, setConsent] = useState<ConsentStateDto>(account.consent);
  const [name, setName] = useState(account.name);
  const [timezone, setTimezone] = useState(account.timezone);
  const [reviewHour, setReviewHour] = useState(String(account.reviewHour));
  const [ticked, setTicked] = useState<Record<RequiredDocument, boolean>>({ terms: false, privacy: false });
  const [profile, setProfile] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  // When the step changes, move focus to its heading so the new content is announced and reachable.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const needed = consentToConfirm(consent, versions);

  /**
   * Show the field errors and move focus to the first one in screen order. The
   * fields are disabled while a request runs, so focus moves after the render
   * that enables them again and puts the message under the field.
   */
  function showFieldErrors(order: readonly string[], found: Record<string, string | undefined>): void {
    setErrors(found);
    const first = firstFieldWithError(order, found);
    askFocus(first === null ? SUBMIT_TARGET : fieldTarget(first));
  }

  /** Show a failure that belongs to no field. Focus returns to the submit button instead of being left on nothing. */
  function showFormError(message: string): void {
    setFormError(message);
    askFocus(SUBMIT_TARGET);
  }

  function begin(): boolean {
    if (pending) return false;
    setErrors({});
    setFormError(null);
    return true;
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!begin()) return;
    const result = validateDetails({ name, timezone, reviewHour });
    if (!result.ok) {
      showFieldErrors(DETAIL_FIELDS, result.errors);
      return;
    }
    setPending(true);
    const response = await callApi<MeDto>("/api/me", "PATCH", result.body);
    setPending(false);
    if (!response.ok) {
      const field = DETAIL_FIELDS.find((candidate) => response.fields.includes(candidate));
      if (field) showFieldErrors(DETAIL_FIELDS, { [field]: response.message });
      else showFormError(response.message);
      return;
    }
    setConsent(response.data.consent);
    setStep("consent");
  }

  async function acceptDocuments(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!begin()) return;
    const result = buildOnboardingBody({ needed, ticked, versions });
    if (!result.ok) {
      showFieldErrors(DOCUMENT_FIELDS, result.errors);
      return;
    }
    setPending(true);
    const response = await callApi<MeDto>("/api/me/onboarding", "POST", result.body);
    setPending(false);
    if (!response.ok) {
      showFormError(describeAgreementRefusal(response));
      return;
    }
    setConsent(response.data.consent);
    setStep("profile");
  }

  async function addProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!begin()) return;
    try {
      parseProfileInput(profile);
    } catch (error) {
      showFieldErrors(PROFILE_FIELDS, {
        profile: isDomainError(error) ? error.message : "Enter an Instagram username or a profile link.",
      });
      return;
    }
    setPending(true);
    const response = await callApi<ProfileDto>("/api/profiles", "POST", { handle: profile });
    if (!response.ok) {
      setPending(false);
      if (response.code === "invalid_input") showFieldErrors(PROFILE_FIELDS, { profile: response.message });
      else showFormError(response.message);
      return;
    }
    loadPage(DASHBOARD);
  }

  return (
    <>
      <PageHeader
        title="Set up OrbitDiff Web"
        description="Three short steps. Nothing here asks for your Instagram password, codes, or session."
      />
      <div className="mt-6">
        <StepList current={step} />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:gap-16">
        <div className="min-w-0">
          {step === "details" ? (
            <form ref={formRef} onSubmit={saveDetails} noValidate className="grid gap-5">
              <StepHeading headingRef={headingRef}>Your details</StepHeading>
              <TextField
                label="Display name"
                name="name"
                autoComplete="name"
                required
                maxLength={NAME_MAX}
                value={name}
                onChange={(event) => setName(event.target.value)}
                error={errors.name}
                disabled={pending}
              />
              <SelectField
                label="Timezone"
                name="timezone"
                autoComplete="off"
                required
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                options={timezoneOptions(timezones, timezone)}
                error={errors.timezone}
                disabled={pending}
              />
              <SelectField
                label="Daily review hour"
                name="reviewHour"
                autoComplete="off"
                required
                value={reviewHour}
                onChange={(event) => setReviewHour(event.target.value)}
                options={[...REVIEW_HOUR_OPTIONS]}
                error={errors.reviewHour}
                hint="The local hour of the daily review. The review records how fresh your latest import is. It never contacts Instagram."
                disabled={pending}
              />
              <FormError>{formError}</FormError>
              <div>
                <Button type="submit" variant="primary" size="lg" loading={pending} loadingLabel="Saving your details">
                  Save and continue
                </Button>
              </div>
            </form>
          ) : null}

          {step === "consent" ? (
            <form ref={formRef} onSubmit={acceptDocuments} noValidate className="grid gap-5">
              <StepHeading headingRef={headingRef}>Terms and privacy</StepHeading>
              {needed.length === 0 ? (
                <p className="text-ink">
                  You accepted the current Terms and Privacy notice when you signed up. Continuing confirms them for this
                  account.
                </p>
              ) : (
                <p className="text-ink">
                  Read the current versions, then agree to each one. Product news is a separate choice and is not part
                  of this step.
                </p>
              )}
              <ul className="grid gap-3">
                {(["terms", "privacy"] as const).map((kind) => {
                  const document = DOCUMENTS[kind];
                  const link = (
                    <Link href={document.href} target="_blank" rel="noopener" className="od-link inline-block py-1">
                      {document.name}
                    </Link>
                  );
                  return (
                    <li key={kind} className="rounded-lg border border-line px-4 py-3">
                      {needed.includes(kind) ? (
                        <CheckboxField
                          name={kind}
                          required
                          checked={ticked[kind]}
                          onChange={(event) => setTicked((before) => ({ ...before, [kind]: event.target.checked }))}
                          error={errors[kind]}
                          label={<>I agree to the {link}</>}
                          hint={`Version ${versions[kind]}. The link opens in a new tab.`}
                          disabled={pending}
                        />
                      ) : (
                        <p className="text-sm text-ink">
                          {link}: accepted on {formatDate(consent[kind]?.recordedAt)}, version {versions[kind]}.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <FormError>{formError}</FormError>
              <div>
                <Button type="submit" variant="primary" size="lg" loading={pending} loadingLabel="Recording your agreement">
                  {needed.length === 0 ? "Continue" : "Agree and continue"}
                </Button>
              </div>
            </form>
          ) : null}

          {step === "profile" ? (
            <form ref={formRef} onSubmit={addProfile} noValidate className="grid gap-5">
              <StepHeading headingRef={headingRef}>Add your first profile</StepHeading>
              <p className="text-ink">
                A profile names the Instagram account whose exports you will import. Adding a profile contacts nobody.
              </p>
              <TextField
                label="Instagram username or profile link"
                name="profile"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
                error={errors.profile}
                hint="For example atlas_studio or https://www.instagram.com/atlas_studio/. Use an account that is yours or that you are authorized to manage."
                inputClassName="font-mono"
                disabled={pending}
              />
              <FormError>{formError}</FormError>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" size="lg" loading={pending} loadingLabel="Adding the profile">
                  Add profile
                </Button>
                <LinkButton href={DASHBOARD} variant="quiet" size="lg">
                  Skip for now
                </LinkButton>
              </div>
            </form>
          ) : null}

          {step === "done" ? (
            <div className="grid gap-5">
              <StepHeading headingRef={headingRef}>You are set up</StepHeading>
              <p className="text-ink">Your account is ready. Import an export from the dashboard.</p>
              <div>
                <LinkButton href={DASHBOARD} variant="primary" size="lg">
                  Go to the dashboard
                </LinkButton>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="min-w-0 max-w-prose">
          <Notice tone="info" title="Automatic identity tracking is unavailable.">
            <p>
              {IDENTITY_SOURCE} OrbitDiff Web works from the exports you import. Your first import is a baseline and
              shows no changes. A later import shows what differs between the two exports: an observation in your
              exports, not a live follow or unfollow.
            </p>
          </Notice>
        </aside>
      </div>
    </>
  );
}
