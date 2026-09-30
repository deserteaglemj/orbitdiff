import { z } from "zod";

import { requireOnboardedUser } from "@/server/auth/guards";
import { readBounded, readJson } from "@/server/http/body";
import { json, route } from "@/server/http/handler";
import { assertSameOrigin } from "@/server/http/origin";
import { requestManualReview } from "@/server/jobs/manual-review";

export const dynamic = "force-dynamic";

const BODY_MAX_BYTES = 1024;
const NoFields = z.strictObject({});

/** The request carries no data: an absent body or `{}` is accepted, anything else is refused. */
async function assertNoFields(request: Request): Promise<void> {
  const declared = request.headers.get("content-length");
  if (request.body === null || declared === "0") return;
  if (request.headers.get("content-type") === null) {
    // No declared type: tolerate an empty body only.
    if ((await readBounded(request, BODY_MAX_BYTES)).byteLength === 0) return;
  }
  await readJson(request, NoFields, BODY_MAX_BYTES);
}

/**
 * Queue a manual review of one profile.
 *
 * Who may call it: an onboarded, verified, active user, from the app's own
 * origin, for a profile of their own. A profile id that is missing, malformed,
 * or belongs to someone else is `not_found`; the three cannot be told apart.
 *
 * What it does: queues one `manual_review` job and returns it (202). The review
 * runs in the next tick, never inside this request. It answers `conflict` for a
 * paused profile, `cooldown` inside the review cooldown, `quota_exhausted` past
 * the per-profile daily limit, and `capacity_paused` when the service has used
 * its daily job capacity. A refused request queues nothing.
 */
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const owner = await requireOnboardedUser(request.headers);
  const { id } = await context.params;
  await assertNoFields(request);
  return json(await requestManualReview(owner.id, id), { status: 202 });
});
