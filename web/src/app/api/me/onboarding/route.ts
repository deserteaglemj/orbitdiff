import { requireUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { completeOnboarding } from "@/server/services/account";
import { onboardingBody, SMALL_BODY_BYTES } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/**
 * Finish onboarding: `{ "termsVersion": "2026-09-30", "privacyVersion": "2026-09-30" }`.
 *
 * Who may call it: a signed-in, verified, active user, from this origin.
 *
 * The body names the version of the Terms and of the Privacy notice that the
 * page showed, and naming them is the acceptance. Each must be the current
 * version of its document, compared in full. A page that was opened before a
 * document changed still holds the earlier version, so its request is refused
 * (422 `invalid_input`, `details.fields` names `termsVersion`,
 * `privacyVersion`, or both) and nothing is recorded; the person reloads and
 * reads the current text. The refusal never repeats what was sent and never
 * hands out the current version.
 *
 * Nothing else may be sent, so marketing consent can never be bundled into
 * this acceptance. The rows written carry the versions the request named.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(request.headers);
  const body = await readJson(request, onboardingBody, SMALL_BODY_BYTES);
  return json(await completeOnboarding(user.id, body));
});
