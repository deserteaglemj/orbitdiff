import { requireUser } from "@/server/auth/guards";
import { assertSameOrigin, readJson } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { recordMarketingConsent } from "@/server/services/account";
import type { MarketingConsentRequestDto } from "@/server/services/contracts";
import { marketingConsentBody, SMALL_BODY_BYTES } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/**
 * Record a product news (marketing) consent change for the signed-in user.
 *
 * Who may call it: a signed-in, verified, active user, from this origin, for
 * their own account only; there is no id in the path or the body.
 *
 * - Grant: `{ "granted": true, "version": "2026-09-30" }`. The version is the
 *   one the page showed, and it must be the current version of the product
 *   news consent, compared in full. A grant that names no version, an empty,
 *   outdated, or unknown one, or a value that is not text is refused (422
 *   `invalid_input`, `details.fields` is `["version"]`) and nothing is
 *   recorded. The refusal never repeats what was sent and never hands out the
 *   current version.
 * - Withdrawal: `{ "granted": false }`. It needs no version and is never
 *   refused because of one, so turning product news off always works.
 *
 * Terms and privacy consent cannot be recorded or changed here.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(request.headers);
  const body = await readJson(request, marketingConsentBody, SMALL_BODY_BYTES);
  return json(await recordMarketingConsent(user.id, body as MarketingConsentRequestDto));
});
