"use client";

import { useRef, useState, type FormEvent } from "react";

import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { passwordStrength } from "@/components/auth/password-strength";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/components/auth/sign-up-model";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { Button, FormError, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import {
  buildPasswordChangeRequest,
  describeSecurityError,
  PASSWORD_CHANGE_FIELDS,
  validatePasswordChange,
  type PasswordChangeErrors,
} from "./security";

const OFFLINE = "The request did not reach the server. Check your connection and try again.";

/**
 * Change the OrbitDiff password through the auth client. The current password
 * is always required, and every other device is signed out by the same
 * request. `onChanged` lets the list of devices load again afterwards.
 */
export function PasswordForm({ email, name, onChanged }: { email: string; name: string; onChanged?: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);
  const strength = passwordStrength(newPassword, { email, name });

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const values = { currentPassword, newPassword, confirmPassword };
    const found = validatePasswordChange(values);
    setErrors(found);
    setFormError(null);
    setSaved("");
    const first = firstFieldWithError(PASSWORD_CHANGE_FIELDS, found);
    if (first !== null) {
      askFocus(fieldTarget(first));
      return;
    }
    setPending(true);
    try {
      const { error } = await authClient.changePassword(buildPasswordChangeRequest(values));
      if (!error) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setSaved("Your password was changed. Every other device was signed out.");
        // The fields were disabled while the request ran, which drops focus. It returns next to the result.
        askFocus(SUBMIT_TARGET);
        onChanged?.();
      } else {
        const failure = describeSecurityError(error);
        if (failure.kind === "field") {
          setErrors({ [failure.field]: failure.message });
          askFocus(fieldTarget(failure.field));
        } else {
          setFormError(failure.message);
          askFocus(SUBMIT_TARGET);
        }
      }
    } catch {
      setFormError(OFFLINE);
      askFocus(SUBMIT_TARGET);
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid max-w-xl gap-5">
      <p className="text-sm text-muted">
        This is your OrbitDiff password. Changing your password signs you out on every other device and keeps you signed
        in here.
      </p>
      <TextField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        maxLength={PASSWORD_MAX}
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={errors.currentPassword}
        disabled={pending}
      />
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
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
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={errors.confirmPassword}
        disabled={pending}
      />
      <FormError>{formError}</FormError>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Changing your password">
          Change password
        </Button>
        <p role="status" className="min-w-0 text-sm text-ink">
          {saved}
        </p>
      </div>
    </form>
  );
}
