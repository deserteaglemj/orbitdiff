import { LIMITS } from "@/domain/limits";
import { requireOnboardedUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson, runInBackground } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { readJobCapacity } from "@/server/jobs/capacity";
import { drainJobs } from "@/server/jobs/tick";
import { importExport } from "@/server/services/imports";
import { requireOwnedProfile } from "@/server/services/profiles";
import { importBody } from "@/server/services/request-input";

export const dynamic = "force-dynamic";
/** The response itself is quick; the run that follows it may process one import. */
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** Time the run after an import may take. The hourly run picks up whatever is left. */
const AFTER_IMPORT_BUDGET_MS = 20_000;

/**
 * Process the job this import queued, after the response has been sent, so
 * the user does not wait for the hourly run. It runs at most one job, only for
 * this profile, only of the kind an import queues, and only while the day's
 * job capacity allows. A review of the same profile that was queued earlier is
 * left for the hourly run, so it cannot take the place of the import. It
 * processes stored rows and contacts nothing. A failure here is logged and the
 * job stays in the queue for the next run.
 */
async function processQueuedImport(profileId: string): Promise<void> {
  const now = new Date();
  if ((await readJobCapacity(now)).paused) return;
  await drainJobs({ now, limit: 1, profileId, kinds: ["derive_profile"], budgetMs: AFTER_IMPORT_BUDGET_MS });
}

/**
 * Import a normalized owner export into a profile of the signed-in user.
 * Who may call it: an onboarded user, for a profile of their own; any other
 * id answers `not_found` before the body is read. The body is capped at
 * `LIMITS.importBodyBytes` and holds usernames, shard numbers, the declared
 * capture time, and the completeness declarations only. No file is stored.
 *
 * Answers 201 with the receipt and the queued job, or 200 with
 * `duplicate: true` and no job when the import changed nothing.
 */
export const POST = route<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const user = await requireOnboardedUser(request.headers);
  const owned = await requireOwnedProfile(user.id, (await params).id);
  const body = await readJson(request, importBody, LIMITS.importBodyBytes);
  const receipt = await importExport(user.id, owned.id, body);
  // The import transaction has committed, so the queued job is visible to the worker.
  if (receipt.job !== null) runInBackground(processQueuedImport(owned.id));
  return json(receipt, { status: receipt.job === null ? 200 : 201 });
});
