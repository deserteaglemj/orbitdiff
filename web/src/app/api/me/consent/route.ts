import { requireUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { recordMarketingConsent } from "@/server/services/account";
import { marketingConsentBody, SMALL_BODY_BYTES } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/**
 * Record a marketing consent change for the signed-in user: `{ "granted": true | false }`.
 * Who may call it: a signed-in, verified, active user. Terms and privacy
 * consent cannot be recorded or changed here.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(request.headers);
  const body = await readJson(request, marketingConsentBody, SMALL_BODY_BYTES);
  return json(await recordMarketingConsent(user.id, body.granted));
});
