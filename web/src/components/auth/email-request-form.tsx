"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button, FormError, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { describeAuthError } from "./auth-errors";
import { fieldTarget, SUBMIT_TARGET } from "./focus-request";
import { EMAIL_MAX, validateEmail, VERIFY_CALLBACK_PATH } from "./sign-up-model";
import { useFocusAfterSubmit } from "./use-focus-after-submit";

export interface EmailRequestFormProps {
  /** `confirmation`: a new confirmation message. `reset`: a password reset message. */
  purpose: "confirmation" | "reset";
  mailCaptured: boolean;
}

const COPY = {
  confirmation: {
    button: "Request a new confirmation message",
    busy: "Requesting a new confirmation message",
    done: "If that address has an account that is not confirmed yet, a new confirmation message was created for it. Open its link in this browser, then sign in.",
  },
  reset: {
    button: "Request a reset message",
    busy: "Requesting a reset message",
    done: "If that address has an account, a reset message was created for it. Open its link to choose a new password. The link works for one hour.",
  },
} as const;

/**
 * One email field and one button, for the two requests that are answered the
 * same whether or not an account exists: a new confirmation message and a
 * password reset message. The result never says a message was delivered.
 */
export function EmailRequestForm({ purpose, mailCaptured }: EmailRequestFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);
  const copy = COPY[purpose];

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const invalid = validateEmail(email);
    setFieldError(invalid);
    setFormError(null);
    setDone(false);
    if (invalid) {
      // After the render that puts the message under the field, so it is read out with it.
      askFocus(fieldTarget("email"));
      return;
    }
    setPending(true);
    try {
      const address = email.trim();
      const { error } =
        purpose === "confirmation"
          ? await authClient.sendVerificationEmail({ email: address, callbackURL: VERIFY_CALLBACK_PATH })
          : await authClient.requestPasswordReset({ email: address, redirectTo: "/reset-password" });
      if (error) setFormError(describeAuthError(error).message);
      else setDone(true);
    } catch {
      setFormError("The request did not reach the server. Check your connection and try again.");
    }
    // The field was disabled during the request. The form stays on the screen
    // either way, so focus returns to the button once the field is enabled again.
    askFocus(SUBMIT_TARGET);
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
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
        error={fieldError}
        disabled={pending}
      />
      <FormError>{formError}</FormError>
      {/* Mounted from the start so the result is announced. It takes no room until there is one. */}
      <div role="status" className={done ? "text-sm text-ink" : "sr-only"}>
        {done ? (
          <p>
            {copy.done}
            {mailCaptured ? " This deployment stores the message instead of sending it." : ""}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant={purpose === "reset" ? "primary" : "secondary"} loading={pending} loadingLabel={copy.busy}>
        {copy.button}
      </Button>
    </form>
  );
}
