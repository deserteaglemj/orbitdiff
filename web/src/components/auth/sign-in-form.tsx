"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button, FormError, Notice, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { afterSignInPath } from "@/server/auth/paths";

import { describeAuthError } from "./auth-errors";
import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "./focus-request";
import { loadPage } from "./navigate";
import { EMAIL_MAX, PASSWORD_MAX, validateEmail, VERIFY_CALLBACK_PATH } from "./sign-up-model";
import { useFocusAfterSubmit } from "./use-focus-after-submit";

type Resend = "idle" | "pending" | "done" | { failed: string };

/** Field order on the screen, used to move focus to the first field with an error. */
const FIELD_ORDER = ["email", "password"] as const;

/**
 * Whether the account has finished onboarding, as the server sees it. GET
 * /api/me reports it with the consent log taken into account. When that route
 * cannot answer, the account record itself is the fallback. Either way the
 * signed-in layout checks again on the next page.
 */
async function readOnboarded(fallback: boolean): Promise<boolean> {
  try {
    const response = await fetch("/api/me", { headers: { accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return fallback;
    const me: unknown = await response.json();
    return typeof me === "object" && me !== null && (me as { onboarded?: unknown }).onboarded === true;
  } catch {
    return fallback;
  }
}

export interface SignInFormProps {
  /** A path on this site to continue to, already checked by the server page. */
  next: string | null;
  mailCaptured: boolean;
}

export function SignInForm({ next, mailCaptured }: SignInFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resend, setResend] = useState<Resend>("idle");
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const found = {
      email: validateEmail(email),
      password: password.length === 0 ? "Enter your password." : undefined,
    };
    setErrors(found);
    setFormError(null);
    setUnverified(null);
    setResend("idle");
    const first = firstFieldWithError(FIELD_ORDER, found);
    if (first !== null) {
      // After the render that puts the message under the field, so it is read out with it.
      askFocus(fieldTarget(first));
      return;
    }
    setPending(true);
    try {
      const { data, error } = await authClient.signIn.email({ email: email.trim(), password });
      if (!error) {
        const onboarded = await readOnboarded(Boolean(data?.user?.onboardedAt));
        loadPage(afterSignInPath({ onboarded, next }));
        return;
      }
      const failure = describeAuthError(error);
      if (failure.kind === "unverified") setUnverified(failure.message);
      else setFormError(failure.message);
    } catch {
      setFormError("The request did not reach the server. Check your connection and try again.");
    }
    // The fields were disabled during the request, so focus returns to the submit button once they are enabled.
    askFocus(SUBMIT_TARGET);
    setPending(false);
  }

  async function requestNewMessage(): Promise<void> {
    if (resend === "pending") return;
    setResend("pending");
    try {
      const { error } = await authClient.sendVerificationEmail({
        email: email.trim(),
        callbackURL: VERIFY_CALLBACK_PATH,
      });
      setResend(error ? { failed: describeAuthError(error).message } : "done");
    } catch {
      setResend({ failed: "The request did not reach the server. Check your connection and try again." });
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
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
        autoComplete="current-password"
        required
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.password}
        disabled={pending}
      />
      {unverified !== null ? (
        <Notice
          tone="warning"
          title="This address is not confirmed yet."
          live
          actions={
            resend === "done" ? null : (
              <Button
                variant="secondary"
                onClick={requestNewMessage}
                loading={resend === "pending"}
                loadingLabel="Requesting a new confirmation message"
              >
                Request a new confirmation message
              </Button>
            )
          }
        >
          <p>
            Open the link from the confirmation message in this browser, then sign in here again. The link works for
            one hour, and opening it alone confirms nothing.
          </p>
          {resend === "done" ? (
            <p className="mt-2" role="status">
              A new confirmation message was requested for that address.
              {mailCaptured ? " This deployment stores it instead of sending it." : ""}
            </p>
          ) : null}
          {typeof resend === "object" ? (
            <p className="mt-2" role="alert">
              <span className="font-semibold">Error: </span>
              {resend.failed}
            </p>
          ) : null}
        </Notice>
      ) : null}
      <FormError>{formError}</FormError>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} loadingLabel="Signing you in">
        Sign in
      </Button>
    </form>
  );
}
