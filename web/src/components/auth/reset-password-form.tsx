"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button, FormError, LinkButton, Notice, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { describeAuthError } from "./auth-errors";
import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "./focus-request";
import { loadPage } from "./navigate";
import { passwordStrength } from "./password-strength";
import { PASSWORD_MAX, PASSWORD_MIN, validateNewPassword } from "./sign-up-model";
import { useFocusAfterSubmit } from "./use-focus-after-submit";

export const RESET_LINK_INVALID = "This reset link is not valid or has expired.";

/** Field order on the screen, used to move focus to the first field with an error. */
const FIELD_ORDER = ["newPassword", "confirmPassword"] as const;

/** Shown in place of the form when the link cannot be used. */
export function ResetLinkInvalid({ live = false }: { live?: boolean }) {
  return (
    <Notice
      tone="danger"
      title={RESET_LINK_INVALID}
      live={live}
      actions={
        <LinkButton href="/forgot-password" variant="primary">
          Request a new reset message
        </LinkButton>
      }
    >
      <p>A reset link works once, for one hour. Your password has not been changed.</p>
    </Notice>
  );
}

/** Choose a new password with the token from the reset link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);
  const strength = passwordStrength(password);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const found = {
      newPassword: validateNewPassword(password),
      confirmPassword: confirm === password ? undefined : "The two passwords are not the same.",
    };
    setErrors(found);
    setFormError(null);
    const first = firstFieldWithError(FIELD_ORDER, found);
    if (first !== null) {
      // After the render that puts the message under the field, so it is read out with it.
      askFocus(fieldTarget(first));
      return;
    }
    setPending(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (!error) {
        loadPage("/sign-in?reset=1");
        return;
      }
      const failure = describeAuthError(error);
      if (failure.kind === "invalid_token") setLinkInvalid(true);
      else if (failure.kind === "field" && failure.field === "password") {
        // The fields are still disabled here: focus moves once the request is over and they are enabled.
        setErrors({ newPassword: failure.message });
        askFocus(fieldTarget("newPassword"));
      } else {
        setFormError(failure.message);
        askFocus(SUBMIT_TARGET);
      }
    } catch {
      setFormError("The request did not reach the server. Check your connection and try again.");
      askFocus(SUBMIT_TARGET);
    }
    setPending(false);
  }

  if (linkInvalid) return <ResetLinkInvalid live />;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-5">
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors.newPassword}
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
      <TextField
        label="New password again"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        maxLength={PASSWORD_MAX}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={errors.confirmPassword}
        disabled={pending}
      />
      <FormError>{formError}</FormError>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} loadingLabel="Changing your password">
        Change password
      </Button>
    </form>
  );
}
