import { requireUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { getMe, updateMe } from "@/server/services/account";
import { SMALL_BODY_BYTES, updateMeBody } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/**
 * Who may call it: a signed-in, verified, active user, before or after
 * onboarding. It reads and changes that user's own account only; there is no
 * id in the path or the body.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request.headers);
  return json(await getMe(user.id));
});

/**
 * Accepts `name`, `timezone`, and `reviewHour`. Any other key, such as a role,
 * a status, or a verification flag, is refused with `invalid_input`.
 */
export const PATCH = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(request.headers);
  const body = await readJson(request, updateMeBody, SMALL_BODY_BYTES);
  return json(await updateMe(user.id, body));
});
