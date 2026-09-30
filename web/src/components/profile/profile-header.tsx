"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { loadPage } from "@/components/auth/navigate";
import { describeRefusal, requestJson } from "@/components/dashboard/api";
import type { StatusBadge } from "@/components/dashboard/card-model";
import { Badge, Button, ConfirmDialog, LinkButton, Notice, PageHeader } from "@/components/ui";
import { LIMITS } from "@/domain/limits";
import type { JobDto, ProfileDto, ProfileStatus } from "@/server/services/contracts";

import { removalDescription } from "./rows";

type Action = "review" | "status" | "remove";

interface Outcome {
  tone: "info" | "warning" | "danger";
  title: string;
  text: string;
}

const COOLDOWN_MINUTES = LIMITS.reviewCooldownMs / 60_000;

/**
 * The header of a profile page: the handle, where its numbers come from, its
 * status in words, and the actions. Every action calls a JSON route and shows
 * that route's own answer. A refusal (the review cooldown, the daily limit,
 * service capacity) is shown with its reason and changes nothing.
 */
export function ProfileHeader({
  profileId,
  handle,
  status,
  sourceLine,
  badges,
  snapshotCount,
  timeZone,
  importHref,
}: {
  profileId: string;
  handle: string;
  status: ProfileStatus;
  sourceLine: string;
  badges: StatusBadge[];
  snapshotCount: number;
  timeZone: string;
  importHref: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const paused = status === "paused";
  const path = `/api/profiles/${profileId}`;

  async function runReview(): Promise<void> {
    if (pending) return;
    setPending("review");
    setOutcome(null);
    const response = await requestJson<JobDto>(`${path}/review`, "POST");
    setPending(null);
    if (!response.ok) {
      setOutcome({
        tone: response.code === "network" || response.code === "unknown" ? "danger" : "warning",
        title: "The review was not queued.",
        text: describeRefusal(response, timeZone),
      });
      return;
    }
    setOutcome({
      tone: "info",
      title: "Review queued.",
      text: "It runs with the next scheduled run and then appears under Activity. It reads your stored import and never contacts Instagram.",
    });
    router.refresh();
  }

  async function setStatus(next: ProfileStatus): Promise<void> {
    if (pending) return;
    setPending("status");
    setOutcome(null);
    const response = await requestJson<ProfileDto>(path, "PATCH", { status: next });
    setPending(null);
    if (!response.ok) {
      setOutcome({
        tone: "danger",
        title: next === "paused" ? "The profile was not paused." : "The profile was not resumed.",
        text: describeRefusal(response, timeZone),
      });
      return;
    }
    setOutcome(
      next === "paused"
        ? {
            tone: "info",
            title: "Profile paused.",
            text: "Scheduled reviews stop and queued reviews were cancelled. Stored imports are unchanged.",
          }
        : { tone: "info", title: "Profile resumed.", text: "Scheduled reviews run again." },
    );
    router.refresh();
  }

  async function remove(): Promise<void> {
    if (pending) return;
    setPending("remove");
    const response = await requestJson<null>(path, "DELETE");
    if (!response.ok) {
      setPending(null);
      setConfirming(false);
      setOutcome({ tone: "danger", title: "The profile was not removed.", text: describeRefusal(response, timeZone) });
      return;
    }
    // A full load, so nothing rendered for the removed profile stays on screen.
    loadPage("/dashboard");
  }

  return (
    <>
      <PageHeader
        title={
          <span translate="no" className="font-mono break-all">
            {handle}
          </span>
        }
        description={sourceLine}
        actions={
          <>
            <LinkButton href={importHref} variant="primary">
              Import export
            </LinkButton>
            <Button
              onClick={runReview}
              loading={pending === "review"}
              loadingLabel="Queueing the review"
              disabled={paused || (pending !== null && pending !== "review")}
              aria-describedby="review-limits"
            >
              Run review now
            </Button>
            <Button
              onClick={() => setStatus(paused ? "active" : "paused")}
              loading={pending === "status"}
              loadingLabel={paused ? "Resuming the profile" : "Pausing the profile"}
              disabled={pending !== null && pending !== "status"}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={pending !== null}>
              Remove
            </Button>
          </>
        }
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {badges.map((badge) => (
          <Badge key={badge.text} tone={badge.tone}>
            {badge.text}
          </Badge>
        ))}
      </div>
      <p id="review-limits" className="mt-3 text-sm text-muted">
        {paused
          ? "Reviews are paused for this profile. Resume it to run a review."
          : `A review records how fresh and how complete your stored import is. One review per ${COOLDOWN_MINUTES} minutes and ${LIMITS.manualReviewsPerProfilePerDay} manual reviews per day.`}
      </p>
      {/* Mounted from the start, so a result that appears later is announced. */}
      <div role="status" className="mt-3">
        {outcome ? (
          <Notice tone={outcome.tone} title={outcome.title}>
            <p>{outcome.text}</p>
          </Notice>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Remove ${handle}?`}
        description={removalDescription(handle, snapshotCount)}
        confirmLabel="Remove profile"
        cancelLabel="Keep profile"
        tone="danger"
        busy={pending === "remove"}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
