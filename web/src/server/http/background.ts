import { after } from "next/server";

import { logError } from "./log";

const pending = new Set<Promise<void>>();

/**
 * Run work without holding up the response. Used for sending mail, so response
 * time does not reveal whether an address has an account.
 *
 * Inside a Next.js request the work is handed to `after()`, which keeps a
 * serverless function alive until it finishes. Outside one (tests, scripts) it
 * simply keeps running. A failure is logged as one redacted line.
 */
export function runInBackground(task: Promise<unknown>): void {
  const settled: Promise<void> = task.then(
    () => undefined,
    (error: unknown) => logError("background", error),
  );
  pending.add(settled);
  void settled.then(() => pending.delete(settled));
  try {
    after(settled);
  } catch {
    // Not inside a Next.js request scope: nothing to extend, the promise still runs.
  }
}

/** Resolve once every queued task has finished, including work queued meanwhile. */
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all(pending);
  }
}
