"use client";

import { useRef, useState, type FormEvent } from "react";

import { SUBMIT_TARGET } from "@/components/auth/focus-request";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { callApi } from "@/components/onboarding/api";
import { Badge, Button, CheckboxField, FormError } from "@/components/ui";
import type { ConsentStateDto } from "@/server/services/contracts";

import { buildMarketingRequest, describeMarketingRefusal, marketingSummary } from "./consent-summary";
import { useRouteRefresh } from "./refresh-context";

export interface MarketingFormProps {
  /** The newest product news record of this account, or null when there is none. */
  recorded: ConsentStateDto["marketing"];
  /** The version of the product news consent this page shows. A grant names it. */
  version: string;
  timeZone: string;
}

/**
 * The product news choice, saved through POST /api/me/consent. It is separate
 * from the Terms and the Privacy notice: this form sends only
 * `{ granted: true, version }` or `{ granted: false }`, built by
 * buildMarketingRequest, and nothing here reads or changes product consent.
 * The recorded state shown is always the one the server returned.
 */
export function MarketingForm({ recorded: initial, version, timeZone }: MarketingFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { refresh } = useRouteRefresh();
  const [recorded, setRecorded] = useState(initial);
  const summary = marketingSummary(recorded, timeZone);
  const [choice, setChoice] = useState(summary.granted);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    setSaved("");
    if (choice === summary.granted) {
      setSaved(`Nothing to save. Product news is already ${summary.granted ? "on" : "off"}.`);
      return;
    }
    const request = buildMarketingRequest(choice, version);
    if (!request.ok) {
      setFormError(request.error);
      askFocus(SUBMIT_TARGET);
      return;
    }
    setPending(true);
    const response = await callApi<ConsentStateDto>("/api/me/consent", "POST", request.body);
    setPending(false);
    if (!response.ok) {
      setFormError(describeMarketingRefusal(response));
      askFocus(SUBMIT_TARGET);
      return;
    }
    const next = response.data.marketing;
    setRecorded(next);
    setChoice(marketingSummary(next, timeZone).granted);
    setSaved(`Saved. Product news is now ${marketingSummary(next, timeZone).granted ? "on" : "off"}.`);
    // The box was disabled while the request ran, which drops focus. It returns next to the result.
    askFocus(SUBMIT_TARGET);
    refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid max-w-xl gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line px-4 py-3">
        <Badge tone={summary.tone}>{summary.badge}</Badge>
        <p className="min-w-0 text-sm text-ink">{summary.text}</p>
      </div>
      <CheckboxField
        name="marketing"
        checked={choice}
        onChange={(event) => setChoice(event.target.checked)}
        label="Send me product news by email"
        hint={`Optional. This preview cannot deliver email yet, so nothing is sent for now. Turning it on records your consent at version ${version}.`}
        disabled={pending}
      />
      <FormError>{formError}</FormError>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="secondary" loading={pending} loadingLabel="Saving your choice">
          Save choice
        </Button>
        <p role="status" className="min-w-0 text-sm text-ink">
          {saved}
        </p>
      </div>
    </form>
  );
}
