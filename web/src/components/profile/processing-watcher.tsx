"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { requestJson } from "@/components/dashboard/api";
import {
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  processingMessage,
  processingOutcome,
  type ProcessingOutcome,
} from "@/components/import/model";
import { Notice, Spinner } from "@/components/ui";
import type { ProfileDto } from "@/server/services/contracts";

/**
 * Shown on a profile page while an import waits for its derived data. It asks
 * GET /api/profiles/:id every two seconds and, once processing has ended,
 * loads the page's data again and announces the result. It stops asking after
 * a bounded number of tries and says that the next scheduled run picks the
 * import up.
 */
export function ProcessingWatcher({
  profileId,
  processing,
  lastImportAt,
  detail,
}: {
  profileId: string;
  /** True while the profile has an import that is not processed yet. */
  processing: boolean;
  /** Time of the newest stored import, the one being processed. */
  lastImportAt: string | null;
  detail: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ProcessingOutcome | "timeout" | null>(null);

  useEffect(() => {
    if (!processing) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const since = lastImportAt ?? new Date(0).toISOString();

    const ask = async (): Promise<void> => {
      attempts += 1;
      const response = await requestJson<ProfileDto>(`/api/profiles/${profileId}`, "GET");
      if (cancelled) return;
      if (response.ok) {
        const outcome = processingOutcome(response.data, since);
        if (outcome !== "waiting") {
          setResult(outcome);
          if (outcome === "done") router.refresh();
          return;
        }
      } else if (response.status === 404 || response.status === 401) {
        // The profile is gone or the login ended: the page itself will say so on its next load.
        return;
      }
      if (attempts >= POLL_ATTEMPTS) {
        setResult("timeout");
        return;
      }
      timer = setTimeout(() => void ask(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void ask(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [processing, profileId, lastImportAt, router]);

  return (
    <div role="status" className={processing || result ? "mt-4" : undefined}>
      {result ? (
        <Notice
          tone={result === "failed" ? "danger" : result === "done" ? "info" : "warning"}
          title={processingMessage(result)}
        />
      ) : processing ? (
        <Notice tone="info" label="Processing" title="Processing import">
          <p>{detail}</p>
          <Spinner decorative className="mt-2 text-blue" />
        </Notice>
      ) : null}
    </div>
  );
}
