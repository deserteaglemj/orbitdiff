import { requireOnboardedUser } from "@/server/auth/guards";
import { json, route } from "@/server/http/handler";
import { getCountHistory } from "@/server/services/counts";
import { requireUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Count history of a profile of the signed-in user: counts per dated export
 * and the wording of the latest net change. It never names an account.
 * A malformed, unknown, or foreign id answers `not_found`.
 */
export const GET = route<Context>(async (request, { params }) => {
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  return json(await getCountHistory(user.id, id));
});
