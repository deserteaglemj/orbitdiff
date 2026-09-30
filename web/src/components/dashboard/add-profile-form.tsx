"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { fieldTarget, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { Button, FormError, Notice, TextField } from "@/components/ui";
import { isDomainError } from "@/domain/errors";
import { parseProfileInput } from "@/domain/handles";
import type { ProfileDto } from "@/server/services/contracts";

import { describeRefusal, requestJson } from "./api";
import { ADD_PROFILE_FIELD_ID, profileQuota } from "./card-model";

/**
 * Adds a profile through POST /api/profiles. The value is a username or an
 * Instagram profile link; the same domain rule checks it here and on the
 * server. Adding a profile contacts nobody. At the quota the form is paused
 * and says why.
 */
export function AddProfileForm({
  used,
  limit,
  timeZone,
  primary,
}: {
  /** Profiles the account has. */
  used: number;
  limit: number;
  timeZone: string;
  /** True when this is the main action of the page. */
  primary: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);
  const quota = profileQuota(used, limit);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || quota.full) return;
    setFieldError(undefined);
    setFormError(null);
    setAdded(null);
    try {
      parseProfileInput(value);
    } catch (error) {
      setFieldError(isDomainError(error) ? error.message : "Enter an Instagram username or a profile link.");
      askFocus(fieldTarget("handle"));
      return;
    }
    setPending(true);
    const response = await requestJson<ProfileDto>("/api/profiles", "POST", { handle: value });
    setPending(false);
    if (!response.ok) {
      if (response.code === "invalid_input") {
        setFieldError(response.message);
        askFocus(fieldTarget("handle"));
      } else {
        setFormError(describeRefusal(response, timeZone));
        askFocus(SUBMIT_TARGET);
      }
      // A refusal can mean the list changed elsewhere (a duplicate, the quota): show the current state.
      router.refresh();
      return;
    }
    setValue("");
    setAdded(response.data.handle);
    router.refresh();
    askFocus(fieldTarget("handle"));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4">
      {quota.full ? (
        <Notice tone="info" label="Paused" title="Adding profiles is paused.">
          <p>{quota.text}</p>
        </Notice>
      ) : null}
      <TextField
        id={ADD_PROFILE_FIELD_ID}
        label="Instagram username or profile link"
        name="handle"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={600}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={fieldError}
        hint={`For example atlas_studio or https://www.instagram.com/atlas_studio/. ${quota.full ? "" : quota.text}`.trim()}
        inputClassName="font-mono"
        disabled={pending || quota.full}
      />
      <FormError>{formError}</FormError>
      <div>
        <Button
          type="submit"
          variant={primary ? "primary" : "secondary"}
          loading={pending}
          loadingLabel="Adding the profile"
          disabled={quota.full}
        >
          Add profile
        </Button>
      </div>
      <p role="status" className="min-h-6 text-sm text-ink">
        {added ? `${added} was added. Import an export from its card to store a baseline.` : ""}
      </p>
    </form>
  );
}
