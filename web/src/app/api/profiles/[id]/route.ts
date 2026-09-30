import { requireOnboardedUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { deleteProfile, getProfile, setProfileStatus } from "@/server/services/profiles";
import { profileStatusBody, SMALL_BODY_BYTES } from "@/server/services/request-input";
import { requireUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Who may call it: an onboarded user, for a profile of their own. An id that
 * is malformed, does not exist, or belongs to another user answers the same
 * `not_found`.
 */
export const GET = route<Context>(async (request, { params }) => {
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  return json(await getProfile(user.id, id));
});

/** Pause or resume: `{ "status": "paused" | "active" }`. Nothing else about a profile can be changed. */
export const PATCH = route<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  const body = await readJson(request, profileStatusBody, SMALL_BODY_BYTES);
  return json(await setProfileStatus(user.id, id, body.status));
});

/** Remove the profile with its imports, export observations, jobs, and activity. */
export const DELETE = route<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  await deleteProfile(user.id, id);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});
