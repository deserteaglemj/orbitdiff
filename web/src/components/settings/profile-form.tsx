"use client";

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { fieldTarget, firstFieldWithError, SUBMIT_TARGET } from "@/components/auth/focus-request";
import { NAME_MAX } from "@/components/auth/sign-up-model";
import { timezoneOptions } from "@/components/auth/timezones";
import { useFocusAfterSubmit } from "@/components/auth/use-focus-after-submit";
import { callApi } from "@/components/onboarding/api";
import { REVIEW_HOUR_OPTIONS, validateDetails } from "@/components/onboarding/model";
import { Badge, Button, FormError, SectionHeading, SelectField, TextField } from "@/components/ui";
import type { MeDto } from "@/server/services/contracts";

import { formatDateTime } from "./format";
import { useRouteRefresh } from "./refresh-context";
import { filterTimezones, timezoneLabel } from "./timezones";

export interface ProfileFormProps {
  account: { name: string; timezone: string; reviewHour: number };
  /** The zones the server accepts, UTC first. */
  timezones: string[];
}

/** The fields in the order they appear, used to move focus to the first one with an error. */
const FIELD_ORDER: readonly string[] = ["name", "timezone", "reviewHour"];
const SEARCH_MAX = 64;

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * Display name, timezone, and daily review hour, saved through PATCH /api/me.
 * The timezone select is searchable: the field above it narrows its options,
 * and the chosen zone always stays in the list. After a save the page is
 * rendered again by the server, so the next review times below show the
 * stored schedule.
 */
export function ProfileForm({ account, timezones }: ProfileFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { refresh } = useRouteRefresh();
  const [name, setName] = useState(account.name);
  const [timezone, setTimezone] = useState(account.timezone);
  const [reviewHour, setReviewHour] = useState(String(account.reviewHour));
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const askFocus = useFocusAfterSubmit(formRef, !pending);

  // The chosen zone is always offered, also when the list from the server lacks it.
  const offered = useMemo(() => timezoneOptions(timezones, timezone).map((option) => option.value), [timezones, timezone]);
  const matches = useMemo(() => filterTimezones(offered, search, timezone), [offered, search, timezone]);
  const onlyTheChoice = search.trim().length > 0 && matches.length === 1 && matches[0] === timezone;

  function showFieldErrors(found: Record<string, string | undefined>): void {
    setErrors(found);
    const first = firstFieldWithError(FIELD_ORDER, found);
    askFocus(first === null ? SUBMIT_TARGET : fieldTarget(first));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setErrors({});
    setFormError(null);
    setSaved("");
    const result = validateDetails({ name, timezone, reviewHour });
    if (!result.ok) {
      showFieldErrors(result.errors);
      return;
    }
    setPending(true);
    const response = await callApi<MeDto>("/api/me", "PATCH", result.body);
    setPending(false);
    if (!response.ok) {
      const field = FIELD_ORDER.find((candidate) => response.fields.includes(candidate));
      if (field) showFieldErrors({ [field]: response.message });
      else {
        setFormError(response.message);
        askFocus(SUBMIT_TARGET);
      }
      return;
    }
    setName(response.data.name);
    setSaved(
      `Saved. Daily reviews run at ${hourLabel(response.data.reviewHour)} in ${timezoneLabel(response.data.timezone)}.`,
    );
    // The fields were disabled while the request ran, which drops focus. It returns next to the result.
    askFocus(SUBMIT_TARGET);
    refresh();
  }

  /** Enter in the search field must not save the form. */
  function keepEnterFromSaving(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") event.preventDefault();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid max-w-xl gap-5">
      <TextField
        label="Display name"
        name="name"
        autoComplete="name"
        required
        maxLength={NAME_MAX}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
        hint="Shown inside the app, so you can see which OrbitDiff account you are signed in to."
        disabled={pending}
      />
      <div className="grid gap-3">
        <TextField
          label="Search timezones"
          name="timezoneSearch"
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={SEARCH_MAX}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={keepEnterFromSaving}
          hint="Type a city or a region, for example Berlin or New York. The list below narrows as you type."
          disabled={pending}
        />
        <SelectField
          label="Timezone"
          name="timezone"
          autoComplete="off"
          required
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          options={matches.map((zone) => ({ value: zone, label: timezoneLabel(zone) }))}
          error={errors.timezone}
          disabled={pending}
        />
        <p role="status" className="text-sm text-muted">
          {onlyTheChoice
            ? "No other timezone matches. Your current choice stays selected."
            : `Showing ${matches.length} of ${offered.length} timezones.`}
        </p>
      </div>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" variant="primary" loading={pending} loadingLabel="Saving your profile">
          Save profile
        </Button>
        <p role="status" className="min-w-0 text-sm text-ink">
          {saved}
        </p>
      </div>
    </form>
  );
}

export interface ScheduledProfile {
  id: string;
  handle: string;
  status: "active" | "paused";
  /** ISO time of the next daily review. Null when the profile is paused. */
  nextReviewAt: string | null;
  /**
   * Said in place of that time when it does not hold: the review is overdue, or
   * scheduled reviews are paused at the daily job capacity. Worked out by the
   * server at the time of the request.
   */
  caveat?: string | null;
}

/**
 * When the daily review of each profile runs next, as stored. The server
 * reschedules them when the timezone or the hour changes, and this list shows
 * the new times once the page has been rendered again.
 */
export function ReviewSchedule({ profiles, timeZone }: { profiles: ScheduledProfile[]; timeZone: string }) {
  const { refreshing } = useRouteRefresh();
  return (
    <div>
      <SectionHeading
        level={3}
        title="Next daily reviews"
        description="One review per profile and day, at the hour you chose."
        actions={refreshing ? <Badge tone="info">Updating</Badge> : null}
      />
      {profiles.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          You have no profiles yet, so no review is scheduled. Add a profile on the dashboard first.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 text-sm">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-line px-4 py-3"
            >
              <span className="min-w-0 font-mono break-all text-ink">{profile.handle}</span>
              <span className="text-muted tabular-nums">
                {profile.status === "paused"
                  ? "Paused. No review is scheduled."
                  : profile.caveat
                    ? profile.caveat
                    : profile.nextReviewAt
                      ? formatDateTime(profile.nextReviewAt, timeZone)
                      : "No review is scheduled."}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
