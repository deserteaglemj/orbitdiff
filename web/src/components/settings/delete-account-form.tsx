"use client";

import { useRef, useState, type FormEvent } from "react";

import { TEXT_LINK } from "@/components/auth/auth-parts";
import { fieldTarget, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { loadPage } from "@/components/auth/navigate";
import { PASSWORD_MAX } from "@/components/auth/sign-up-model";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { Button, ConfirmDialog, FormError, Notice, TextField } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

import { buildDeletionRequest, deleteAccount } from "./deletion";

/** The `name` of the password field. Not "password", so a password manager does not mistake the form for a sign-in. */
const PASSWORD_FIELD = "deletePassword";
/** Where the browser goes once the account is gone. */
const LANDING_PAGE = "/";

const DELETED = [
  "your email address, display name, and password",
  "your sign-in sessions on every device",
  "your consent records",
  "every profile",
  "every export you imported, with the usernames in it",
  "the differences calculated from your exports",
  "your activity, background jobs, and usage counters",
  "account messages stored for your address",
];

/**
 * The danger section. Deleting the account needs the current OrbitDiff
 * password, typed here, and a second confirmation in a dialog.
 *
 * The gate is deleteAccount() in ./deletion: it builds a request only for a
 * password that is text and not empty, and it is asked again at the moment of
 * sending, so neither the form nor the dialog can send a deletion without one.
 * The server refuses a missing or wrong password as well. On success the
 * browser loads the landing page; otherwise the server's own message is shown.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const request = buildDeletionRequest(password);
    if (!request.ok) {
      // Fails closed: without a password the confirmation does not even open.
      setFieldError(request.error);
      askFocus(fieldTarget(PASSWORD_FIELD));
      return;
    }
    setFieldError(undefined);
    setConfirming(true);
  }

  async function confirm(): Promise<void> {
    if (pending) return;
    // The dialog closes at once and the form shows the request as running. Focus is back in the
    // form long before the answer arrives, so a refusal can move it to the right control.
    setConfirming(false);
    setPending(true);
    const outcome = await deleteAccount((body) => authClient.deleteUser(body), password);
    if (outcome.kind === "deleted") {
      loadPage(LANDING_PAGE);
      return;
    }
    if (outcome.kind === "password") {
      setPassword("");
      setFieldError(outcome.message);
      askFocus(fieldTarget(PASSWORD_FIELD));
    } else {
      setFormError(outcome.message);
      askFocus(SUBMIT_TARGET);
    }
    setPending(false);
  }

  return (
    <div className="grid gap-5">
      <Notice tone="danger" title="Deleting your account removes everything stored for it. This cannot be undone.">
        <p>There is no way to restore a deleted account from inside OrbitDiff Web.</p>
      </Notice>
      <div className="max-w-[65ch] text-sm text-ink">
        <p>
          If you want to keep your data,{" "}
          <a href="#data" className={TEXT_LINK}>
            download it first
          </a>
          .
        </p>
        <p className="mt-3">Deleting the account {email} removes, for good:</p>
        <ul className="mt-2 grid list-disc gap-1 pl-5">
          {DELETED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-3 text-muted">
          A record that an account was deleted stays in the security log. It holds nothing that identifies you. Your
          Instagram account is not affected: OrbitDiff Web was never connected to it.
        </p>
      </div>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="grid max-w-xl gap-5">
        <TextField
          label="Your OrbitDiff password"
          name={PASSWORD_FIELD}
          type="password"
          autoComplete="current-password"
          required
          maxLength={PASSWORD_MAX}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError}
          hint="Type your current password to confirm that it is you."
          disabled={pending}
        />
        <FormError>{formError}</FormError>
        <div>
          <Button type="submit" variant="danger" loading={pending} loadingLabel="Deleting your account">
            Delete my account
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title="Delete your account for good?"
        description={`The account ${email}, its profiles, and every imported export will be removed. This cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Keep my account"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
