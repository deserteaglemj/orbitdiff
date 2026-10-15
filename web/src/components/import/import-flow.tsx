"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { describeRefusal, requestJson } from "@/components/dashboard/api";
import { zoneLabel } from "@/components/dashboard/local-time";
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  FormError,
  LinkButton,
  Notice,
  Panel,
  Spinner,
  TextField,
} from "@/components/ui";
import { isDomainError } from "@/domain/errors";
import type { ParsedExport } from "@/domain/export";
import { LIMITS } from "@/domain/limits";
import type { ImportReceiptDto, ProfileDto } from "@/server/services/contracts";

import {
  buildImportRequest,
  type CaptureInput,
  classifySelection,
  coveragePreview,
  describeReceipt,
  filesToRead,
  formatBytes,
  importQuota,
  type ImportSummary,
  parseSelection,
  POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  processingMessage,
  type ProcessingOutcome,
  processingOutcome,
  readCaptureInput,
  type ReceiptText,
  SENT_STATEMENT,
  summarizeImport,
} from "./model";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "parsing"; files: number }
  | { kind: "ready"; parsed: ParsedExport; summary: ImportSummary }
  | { kind: "error"; message: string };

type Processing = ProcessingOutcome | "timeout" | "none";

interface Stored {
  receipt: ImportReceiptDto;
  text: ReceiptText;
}

/** Lets the browser paint the progress state before a long synchronous step. It also resolves in a hidden tab. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 150);
  });
}

const CAPTURE_FIELD_ID = "capture-time";
const FOLDER_ATTRIBUTES = { webkitdirectory: "", directory: "" } as Record<string, string>;

/**
 * The import of one owner export into a profile.
 *
 * The chosen files are read and parsed in this browser by the domain rule
 * `parseExportFiles` under the hosted limits. Only files that rule would
 * recognize are read at all. The request to POST /api/profiles/:id/imports
 * holds the usernames, the shard numbers, the capture time, and the two
 * completeness declarations, and nothing else. After the receipt the screen
 * asks for the profile until processing has ended and announces the result.
 */
export function ImportFlow({
  profileId,
  handle,
  timeZone,
  snapshotCount,
  importsToday,
  importsPerDay,
  importsResetAt,
}: {
  profileId: string;
  handle: string;
  /** IANA timezone of the account. The capture time is entered in it. */
  timeZone: string;
  /** Imports the profile already holds. Zero makes this import the baseline. */
  snapshotCount: number;
  importsToday: number;
  importsPerDay: number;
  /** When today's import count starts again: the first instant of the next UTC day. */
  importsResetAt: string;
}) {
  const zone = zoneLabel(timeZone);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const run = useRef(0);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [chosen, setChosen] = useState<string>("");
  const [captured, setCaptured] = useState("");
  const [capture, setCapture] = useState<CaptureInput>({ ok: true, iso: null });
  const [completeFollowers, setCompleteFollowers] = useState(false);
  const [completeFollowing, setCompleteFollowing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
  const [processing, setProcessing] = useState<Processing>("none");
  const [used, setUsed] = useState(importsToday);
  // Imports the profile holds, kept current across several imports on this page.
  const [held, setHeld] = useState(snapshotCount);

  const busy = phase.kind === "reading" || phase.kind === "parsing";
  const quota = importQuota(used, importsPerDay, importsResetAt, timeZone);

  // Parsed files and answers that were not sent yet are lost when the page is left: ask before leaving.
  const unsent = phase.kind === "ready" && stored === null;
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  // Move focus to the result of a step, so it is reached and read out without hunting for it.
  useEffect(() => {
    if (phase.kind === "ready") summaryHeading.current?.focus();
  }, [phase.kind]);
  useEffect(() => {
    if (stored) receiptHeading.current?.focus();
  }, [stored]);

  // After an import that queued work: ask for the profile until processing has ended.
  useEffect(() => {
    if (!stored || stored.receipt.job === null) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      attempts += 1;
      const response = await requestJson<ProfileDto>(`/api/profiles/${profileId}`, "GET");
      if (cancelled) return;
      if (response.ok) {
        const outcome = processingOutcome(response.data, stored.receipt.importedAt);
        if (outcome !== "waiting") {
          setProcessing(outcome);
          return;
        }
      }
      if (attempts >= POLL_ATTEMPTS) {
        setProcessing("timeout");
        return;
      }
      timer = setTimeout(() => void ask(), POLL_INTERVAL_MS);
    };
    timer = setTimeout(() => void ask(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [stored, profileId]);

  async function onFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const list = Array.from(event.target.files ?? []);
    // Clear the control, so choosing the same file again is a change.
    event.target.value = "";
    if (list.length === 0) return;
    const current = ++run.current;
    setFormError(null);
    setStored(null);
    setProcessing("none");
    const classified = classifySelection(
      list.map((file) => ({ name: file.name, relativePath: file.webkitRelativePath ?? "", size: file.size })),
    );
    setChosen(
      classified.selection.kind === "zip"
        ? `${classified.selection.name} (${formatBytes(classified.selection.size)})`
        : `${list.length} ${list.length === 1 ? "file" : "files"}`,
    );
    if (classified.problem !== null) {
      setPhase({ kind: "error", message: classified.problem });
      return;
    }
    const indexes = filesToRead(classified.selection);
    setPhase({ kind: "reading", done: 0, total: indexes.length });
    const contents: Uint8Array[] = [];
    try {
      for (const index of indexes) {
        contents.push(new Uint8Array(await list[index].arrayBuffer()));
        if (run.current !== current) return;
        setPhase({ kind: "reading", done: contents.length, total: indexes.length });
      }
    } catch {
      if (run.current === current) {
        setPhase({ kind: "error", message: "A chosen file could not be read. Choose the files again." });
      }
      return;
    }
    setPhase({ kind: "parsing", files: indexes.length });
    await nextPaint();
    if (run.current !== current) return;
    try {
      const parsed = parseSelection(classified.selection, contents, handle);
      if (parsed.followers === null) setCompleteFollowers(false);
      if (parsed.following === null) setCompleteFollowing(false);
      setPhase({ kind: "ready", parsed, summary: summarizeImport(parsed, classified.selection) });
    } catch (error) {
      setPhase({
        kind: "error",
        message: isDomainError(error) ? error.message : "The export could not be read. Choose the files again.",
      });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sending || phase.kind !== "ready") return;
    setFormError(null);
    // Read again at the moment of sending: a time that was valid when typed may now be checked against a later clock.
    const time = readCaptureInput(captured, timeZone, new Date());
    setCapture(time);
    if (!time.ok) {
      document.getElementById(CAPTURE_FIELD_ID)?.focus();
      return;
    }
    setSending(true);
    const response = await requestJson<ImportReceiptDto>(
      `/api/profiles/${profileId}/imports`,
      "POST",
      buildImportRequest({
        account: handle,
        parsed: phase.parsed,
        capturedAt: time.iso,
        completeFollowers,
        completeFollowing,
      }),
    );
    setSending(false);
    if (!response.ok) {
      setFormError(describeRefusal(response, timeZone));
      return;
    }
    const receipt = response.data;
    if (receipt.job !== null) setUsed((count) => count + 1);
    setProcessing(receipt.job === null ? "none" : "waiting");
    const appended = !receipt.duplicate && !receipt.provenanceEnriched;
    setStored({ receipt, text: describeReceipt(receipt, { firstImport: appended && held === 0, timeZone }) });
    if (appended) setHeld((count) => count + 1);
  }

  function startOver(): void {
    run.current += 1;
    setPhase({ kind: "idle" });
    setChosen("");
    setCaptured("");
    setCapture({ ok: true, iso: null });
    setCompleteFollowers(false);
    setCompleteFollowing(false);
    setFormError(null);
    setStored(null);
    setProcessing("none");
  }

  const progress =
    phase.kind === "reading"
      ? `Reading ${phase.done} of ${phase.total} ${phase.total === 1 ? "file" : "files"} in your browser.`
      : phase.kind === "parsing"
        ? `Parsing ${phase.files} ${phase.files === 1 ? "file" : "files"} in your browser. A large export can take a moment.`
        : "";
  const announcement =
    phase.kind === "ready"
      ? "The export was read. Check what was recognized, then answer the questions below."
      : phase.kind === "error"
        ? ""
        : progress;
  const preview =
    phase.kind === "ready" && capture.ok
      ? coveragePreview(phase.parsed, { capturedAt: capture.iso, completeFollowers, completeFollowing })
      : null;

  if (stored) {
    const finished = processing !== "waiting";
    return (
      <div className="grid max-w-3xl gap-5">
        <Card tone={stored.text.kind === "older" || stored.text.kind === "duplicate" ? "surface" : "blue"}>
          <Badge tone="neutral">Receipt</Badge>
          <h2 ref={receiptHeading} tabIndex={-1} className="mt-3 text-xl font-semibold tracking-tight text-ink">
            {stored.text.title}
          </h2>
          <p className="mt-2 text-ink">{stored.text.detail}</p>
        </Card>
        <div role="status" aria-live="polite" aria-atomic="true" className="min-h-6 text-sm text-ink">
          {processing === "none" ? (
            "Nothing was queued, so there is nothing to process."
          ) : processing === "waiting" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner decorative className="text-blue" />
              {processingMessage("waiting")} This page asks for the result every two seconds.
            </span>
          ) : (
            processingMessage(processing)
          )}
        </div>
        {processing === "failed" ? (
          <Notice tone="danger" title="Processing failed.">
            <p>The failure is listed under Activity next to the last successful result.</p>
          </Notice>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <LinkButton href={`/profiles/${profileId}`} variant={finished ? "primary" : "secondary"}>
            View profile
          </LinkButton>
          <LinkButton href={`/profiles/${profileId}?tab=changes#section`} variant="secondary">
            View changes
          </LinkButton>
          <Button onClick={startOver}>Import another export</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-6">
      {quota.paused ? (
        <Notice tone="info" label="Paused" title={quota.paused.title}>
          <p>{quota.paused.detail}</p>
        </Notice>
      ) : null}
      <Panel
        title="1. Choose your export"
        description={`The followers and following files of ${handle}, as Instagram exported them in JSON format.`}
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => zipInput.current?.click()} disabled={busy || sending}>
              Choose a ZIP
            </Button>
            <Button onClick={() => folderInput.current?.click()} disabled={busy || sending}>
              Choose a folder
            </Button>
            <Button onClick={() => filesInput.current?.click()} disabled={busy || sending}>
              Choose JSON files
            </Button>
          </div>
          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            data-import-input="zip"
            onChange={onFiles}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            data-import-input="folder"
            onChange={onFiles}
            {...FOLDER_ATTRIBUTES}
          />
          <input
            ref={filesInput}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            data-import-input="files"
            onChange={onFiles}
          />
          <p className="text-sm text-muted">
            Recognized names are followers.json, following.json, followers_1.json, following_1.json and further numbers,
            at the top of what you choose or inside a folder named followers_and_following. A ZIP may be up to{" "}
            {formatBytes(LIMITS.exportInputBytes)} and one file up to {formatBytes(LIMITS.exportFileBytes)}. When you
            choose a folder, your browser may ask you to confirm and may call it an upload: only the recognized files
            are read, in this browser.
          </p>
          {chosen ? <p className="text-sm text-ink">Chosen: {chosen}</p> : null}
          {busy ? (
            <p className="inline-flex items-center gap-2 text-sm text-ink">
              <Spinner decorative className="text-blue" />
              {progress}
            </p>
          ) : null}
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </p>
          {phase.kind === "error" ? <FormError>{phase.message}</FormError> : null}
        </div>
      </Panel>

      {phase.kind === "ready" ? (
        <>
          <section aria-labelledby="recognized-heading" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
            <h2
              id="recognized-heading"
              ref={summaryHeading}
              tabIndex={-1}
              className="text-base font-semibold text-ink"
            >
              2. What was recognized
            </h2>
            <dl className="mt-4 grid gap-4 text-sm">
              {(["followers", "following"] as const).map((direction) => {
                const part = phase.summary[direction];
                return (
                  <div key={direction}>
                    <dt className="font-medium text-ink">{direction === "followers" ? "Followers" : "Following"}</dt>
                    <dd className={part.present ? "mt-0.5 text-ink tabular-nums" : "mt-0.5 text-muted"}>{part.text}</dd>
                    {part.warning ? <dd className="mt-1 text-amber">Warning: {part.warning}</dd> : null}
                  </div>
                );
              })}
              <div>
                <dt className="font-medium text-ink">Ignored</dt>
                <dd className="mt-0.5 text-ink">{phase.summary.ignored.text}</dd>
                {phase.summary.ignored.names.length > 0 ? (
                  <dd translate="no" className="mt-1 font-mono text-xs break-all text-muted">
                    {phase.summary.ignored.names.join(", ")}
                    {(phase.summary.ignored.count ?? 0) > phase.summary.ignored.names.length ? ", and more" : ""}
                  </dd>
                ) : null}
              </div>
            </dl>
          </section>

          <Panel
            title="3. Capture time"
            description="When Instagram created this export. It is not the date of a file on your device and not the time of this import."
          >
            <TextField
              id={CAPTURE_FIELD_ID}
              label={`Capture time in ${zone} (optional)`}
              name="capturedAt"
              type="datetime-local"
              autoComplete="off"
              value={captured}
              onChange={(event) => {
                setCaptured(event.target.value);
                setCapture(readCaptureInput(event.target.value, timeZone, new Date()));
                setFormError(null);
              }}
              error={capture.ok ? undefined : capture.message}
              hint={`Enter it as local time in ${zone}, the timezone of your account. Without a capture time the import is stored undated: it cannot be compared with other exports and no direction can count as complete.`}
              disabled={sending}
              inputClassName="max-w-xs"
            />
            <p className="mt-3 text-sm text-ink">
              {capture.ok && capture.iso !== null ? (
                <>
                  Sent as <span className="font-mono">{capture.iso}</span>
                </>
              ) : capture.ok ? (
                "No capture time will be sent."
              ) : null}
            </p>
          </Panel>

          <Panel
            title="4. Your declarations"
            description="Two separate statements that only you can make. OrbitDiff Web records them as your declarations and cannot check them."
          >
            <div className="grid gap-2">
              <CheckboxField
                name="completeFollowers"
                checked={completeFollowers}
                onChange={(event) => setCompleteFollowers(event.target.checked)}
                disabled={sending || !phase.summary.followers.present}
                label="I declare that this export holds my complete list of followers as of its capture time."
                hint={
                  phase.summary.followers.present
                    ? "Only then is an account that is missing from the followers list read as not following you."
                    : "There is no followers file in this selection."
                }
              />
              <CheckboxField
                name="completeFollowing"
                checked={completeFollowing}
                onChange={(event) => setCompleteFollowing(event.target.checked)}
                disabled={sending || !phase.summary.following.present}
                label="I declare that this export holds my complete list of accounts I follow as of its capture time."
                hint={
                  phase.summary.following.present
                    ? "Only then is an account that is missing from the following list read as not followed by you."
                    : "There is no following file in this selection."
                }
              />
            </div>
            {preview ? (
              <p className="mt-4 text-sm text-ink">
                With these answers, followers coverage is: {preview.followers}. Following coverage is:{" "}
                {preview.following}.
              </p>
            ) : null}
          </Panel>

          <Notice tone="info" title="What is sent">
            <p>{SENT_STATEMENT}</p>
          </Notice>
          <p className="text-sm text-muted tabular-nums">{quota.text}</p>

          <FormError>{formError}</FormError>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={sending}
              loadingLabel="Sending the import"
            >
              Import to {handle}
            </Button>
            <Link href={`/profiles/${profileId}`} className="od-link inline-block py-2 text-sm">
              Cancel and go back to the profile
            </Link>
          </div>
        </>
      ) : null}
    </form>
  );
}
