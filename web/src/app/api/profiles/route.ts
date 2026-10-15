import { requireOnboardedUser } from "@/server/auth/guards";
import { assertSameOrigin, parsePagination, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { createProfile, listProfiles } from "@/server/services/profiles";
import { createProfileBody, SMALL_BODY_BYTES } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/** Who may call it: an onboarded user. Returns that user's profiles only, in the list envelope. */
export const GET = route(async (request) => {
  const user = await requireOnboardedUser(request.headers);
  const page = parsePagination(new URL(request.url).searchParams);
  return json(await listProfiles(user.id, page));
});

/**
 * Add a profile: `{ "handle": "atlas_studio" }`, where the value is a handle
 * or an Instagram profile link. The owner is always the signed-in user.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireOnboardedUser(request.headers);
  const body = await readJson(request, createProfileBody, SMALL_BODY_BYTES);
  return json(await createProfile(user.id, body.handle), { status: 201 });
});
