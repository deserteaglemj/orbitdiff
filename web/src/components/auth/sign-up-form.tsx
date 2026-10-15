"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { Button, CheckboxField, FormError, LinkButton, Notice, SelectField, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { describeAuthError } from "./auth-errors";
import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "./focus-request";
import { loadPage } from "./navigate";
import { passwordStrength } from "./password-strength";
import {
  buildSignUpRequest,
  EMAIL_MAX,
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateSignUp,
  type SignUpErrors,
  type SignUpField,
  type SignUpValues,
} from "./sign-up-model";
import { timezoneOptions } from "./timezones";
import { useBrowserTimezone } from "./use-browser-timezone";
import { useFocusAfterSubmit } from "./use-focus-after-submit";

const LEGAL_LINK = "od-link inline-block py-1";
/** Field order on the screen, used to move focus to the first field with an error. */
const FIELD_ORDER: readonly SignUpField[] = ["name", "email", "password", "timezone", "accessCode", "acceptTerms"];

export interface SignUpFormProps {
  /** The versions printed next to the agreement box. They are what a ticked box names in the request. */
  termsVersion: string;
  privacyVersion: string;
  timezones: string[];
  accessCodeRequired: boolean;
}

/**
 * The sign-up form. It sends `acceptedTermsVersion` and `acceptedPrivacyVersion`
 * only when the agreement box is ticked, each with the version this page
 * printed, `marketingOptIn` as a boolean, the timezone, and the access code as
 * a request header. It asks for nothing about an Instagram login.
 */
export function SignUpForm({ termsVersion, privacyVersion, timezones, accessCodeRequired }: SignUpFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const browserZone = useBrowserTimezone();
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The fields are disabled while a request runs, so focus moves after the render that enables them again.
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  // Preselected from the browser and editable: a choice the person made always wins.
  const timezone = chosenZone ?? browserZone ?? "UTC";
  const strength = passwordStrength(password, { email, name });

  /** Show the field errors and move focus to the first one on the screen, once the fields can take it. */
  function showFieldErrors(found: SignUpErrors): void {
    setErrors(found);
    const first = firstFieldWithError(FIELD_ORDER, found);
    askFocus(first === null ? SUBMIT_TARGET : fieldTarget(first));
  }

  /** Show a failure that belongs to no field. The fields were disabled, so focus returns to the submit button. */
  function showFormError(message: string): void {
    setFormError(message);
    askFocus(SUBMIT_TARGET);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const values: SignUpValues = { name, email, password, timezone, acceptTerms, marketing, accessCode };
    const found = validateSignUp(values, { accessCodeRequired });
    setFormError(null);
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    const request = buildSignUpRequest(values, { terms: termsVersion, privacy: privacyVersion });
    try {
      const { error } = await authClient.signUp.email(request.body, { headers: request.headers });
      if (!error) {
        loadPage("/verify-email");
        return;
      }
      const failure = describeAuthError(error);
      if (failure.kind === "closed") setClosedReason(failure.message);
      else if (failure.kind === "field") showFieldErrors({ [failure.field]: failure.message });
      else showFormError(failure.message);
    } catch {
      showFormError("The request did not reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  if (closedReason !== null) {
    return (
      <Notice
        tone="warning"
        title={closedReason}
        live
        actions={
          <LinkButton href="/sign-in" variant="secondary">
            Sign in
          </LinkButton>
        }
      >
        <p>No account was created. If you already have an account, you can still sign in.</p>
      </Notice>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
      <TextField
        label="Display name"
        name="name"
        autoComplete="name"
        required
        maxLength={NAME_MAX}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        hint="Shown inside the app so you can see which account you are signed in to."
        disabled={pending}
      />
      <TextField
        label="Email address"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={EMAIL_MAX}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
        disabled={pending}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        hint={
          <>
            At least {PASSWORD_MIN} characters. A few unrelated words work well.
            {strength.level === "empty" ? null : (
              <span className="mt-1 block text-ink">
                Strength: {strength.label}.{strength.advice ? ` ${strength.advice}` : ""}
              </span>
            )}
          </>
        }
        disabled={pending}
      />
      <SelectField
        label="Timezone"
        name="timezone"
        autoComplete="off"
        required
        value={timezone}
        onChange={(event) => setChosenZone(event.target.value)}
        options={timezoneOptions(timezones, timezone)}
        error={errors.timezone}
        hint="Preselected from this browser. It sets the local hour of the daily review."
        disabled={pending}
      />
      {accessCodeRequired ? (
        <TextField
          label="Access code"
          name="accessCode"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          error={errors.accessCode}
          hint="This preview accepts new accounts by access code only."
          disabled={pending}
        />
      ) : null}
      <div className="grid gap-1 border-t border-line pt-4">
        <CheckboxField
          name="acceptTerms"
          required
          checked={acceptTerms}
          onChange={(event) => setAcceptTerms(event.target.checked)}
          error={errors.acceptTerms}
          label={
            <>
              I agree to the{" "}
              <Link href="/legal/terms" target="_blank" rel="noopener" className={LEGAL_LINK}>
                Terms
              </Link>{" "}
              and the{" "}
              <Link href="/legal/privacy" target="_blank" rel="noopener" className={LEGAL_LINK}>
                Privacy notice
              </Link>
            </>
          }
          hint={`Terms version ${termsVersion}. Privacy notice version ${privacyVersion}. Both links open in a new tab.`}
          disabled={pending}
        />
        <CheckboxField
          name="marketing"
          checked={marketing}
          onChange={(event) => setMarketing(event.target.checked)}
          label="Send me product news by email"
          hint="Optional. This preview cannot deliver email yet, so nothing is sent for now. You can change this in Settings."
          disabled={pending}
        />
      </div>
      <FormError>{formError}</FormError>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} loadingLabel="Creating your account">
        Create account
      </Button>
    </form>
  );
}
